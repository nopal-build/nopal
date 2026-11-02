// Every browser upload that stores bytes goes through here, and the bytes
// go straight to storage: `multipart-init` opens the upload and checks
// where it is going, `multipart-sign` hands out a presigned PUT per 10 MB
// part, the browser sends each part to storage itself, and
// `multipart-complete` checks again and writes the record. The app server
// never holds the file. Gerald's phone videos in a daily log OOM-killed the
// 1 GB app (2026-10-31): one request with the whole file in it, buffered
// twice. #130 moved the daily log onto this module; this makes the module
// itself direct, since its under-100 MB post and its 10 MB parts still
// passed every byte through the server.
//
// Text that becomes a file's content (markdown in the Vault, under 5 MB)
// still goes as a form post to `/api/vault/upload`: it is read, not stored
// as bytes. The CLI keeps its own upload path through the server
// (`crates/core/src/vault.rs`), so those routes stay.
//
// The hash: the server used to sha256 every file it held, and photo links,
// sidecars, day hashes and packet dedupe are built on that value. Under
// `HASH_LIMIT` the browser computes the same hash; at or over it there is
// none, as there already was for every large Vault upload. Nothing fills a
// missing hash in later, since a hash appearing on an existing file would
// change every fingerprint built on it.

import { withScreenAwake } from "../util/wakeLock";

const CHUNK_SIZE = 10 * 1024 * 1024;
const HASH_LIMIT = 100 * 1024 * 1024;
const MAX_INLINE_MARKDOWN_BYTES = 5 * 1024 * 1024;
/** Parts signed per `multipart-sign` request. */
const SIGN_BATCH = 50;
/** Tries per part before the upload gives up: site Wi-Fi drops. */
const PART_ATTEMPTS = 3;

/** Where an upload is going (`modules/uploadTarget.server.ts`). */
export type UploadTarget =
  | { kind: "folder"; folderId: string | null }
  | { kind: "seedPacket"; projectFolderId: string };

/** Daily Log/Card attachments pass this through so the created `file_ref`
 * carries the `source`/`date` locking convention (`isFileRefLocked`).
 * The server keeps it only when the folder is the person's own day
 * folder for that date (`dailyLogStamp`). */
export type VaultUploadMeta = { source?: "daily_log"; date?: string };

/** What `multipart-complete` answers: a file_ref for a folder or a day,
 * a packet row for a seed packet. */
export type UploadResult = {
  fileRef?: { _id: string; content_type: string };
  id?: string;
  name?: string;
  outcome?: "added" | "already";
};

type UploadOptions = {
  /** 0 to 1, as parts land. */
  onProgress?: (fraction: number) => void;
  /** New bytes for an existing file (`fileReplace.server.ts`). */
  replaceFileId?: string;
  /** Sent with `multipart-complete`; see `VaultUploadMeta`. */
  meta?: VaultUploadMeta;
};

async function errorOf(res: Response, fallback: string): Promise<Error> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(data?.error ?? fallback);
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** sha256 hex of the file, or null at or over `HASH_LIMIT`. */
async function hashOf(file: File): Promise<string | null> {
  if (file.size >= HASH_LIMIT || !globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One part to its presigned URL, tried `PART_ATTEMPTS` times. Returns the
 * ETag storage gave it, which the bucket must expose to this origin. */
async function putPart(url: string, chunk: Blob, partNumber: number): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { method: "PUT", body: chunk });
      if (!res.ok) throw new Error(`Part ${partNumber} was refused by storage (${res.status}).`);
      const etag = res.headers.get("ETag");
      if (!etag) throw new Error("Storage didn't say it got the file. Its settings may not allow uploads from here yet.");
      return etag;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < PART_ATTEMPTS) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError ?? new Error(`Part ${partNumber} didn't upload.`);
}

/** Stores the file at the target, straight to storage, and returns what
 * `multipart-complete` answered. Holds a screen wake lock for the
 * duration (`wakeLock.ts`): on iPhone Safari a screen lock mid-upload
 * stalls or kills the in-flight request. */
export function uploadFile(file: File, target: UploadTarget, options: UploadOptions = {}): Promise<UploadResult> {
  return withScreenAwake(() => uploadFileAwake(file, target, options));
}

async function uploadFileAwake(file: File, target: UploadTarget, options: UploadOptions): Promise<UploadResult> {
  const { onProgress = () => {}, replaceFileId, meta = {} } = options;
  const contentType = file.type || "application/octet-stream";
  const where = replaceFileId ? { replaceFileId } : { target };

  // Hashing a large file takes a moment; it runs while the upload opens.
  const hashing = hashOf(file);
  const init = await postJson("/api/vault/multipart-init", {
    filename: file.name,
    contentType,
    originalName: file.name,
    size: file.size,
    ...where,
  });
  if (!init.ok) throw await errorOf(init, `The upload didn't start (${init.status}).`);
  const { uploadId, key } = (await init.json()) as { uploadId: string; key: string };

  try {
    const count = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    const parts: { PartNumber: number; ETag: string }[] = [];
    for (let first = 1; first <= count; first += SIGN_BATCH) {
      const partNumbers = Array.from({ length: Math.min(SIGN_BATCH, count - first + 1) }, (_, i) => first + i);
      const signed = await postJson("/api/vault/multipart-sign", { uploadId, key, partNumbers });
      if (!signed.ok) throw await errorOf(signed, `The upload couldn't continue (${signed.status}).`);
      const { parts: urls } = (await signed.json()) as { parts: { partNumber: number; url: string }[] };
      for (const { partNumber, url } of urls) {
        const chunk = file.slice((partNumber - 1) * CHUNK_SIZE, Math.min(partNumber * CHUNK_SIZE, file.size));
        parts.push({ PartNumber: partNumber, ETag: await putPart(url, chunk, partNumber) });
        onProgress(partNumber / count);
      }
    }

    const done = await postJson("/api/vault/multipart-complete", {
      uploadId,
      key,
      parts,
      name: file.name,
      contentType,
      size: file.size,
      contentHash: await hashing,
      ...where,
      ...meta,
    });
    if (!done.ok) throw await errorOf(done, `The upload didn't finish (${done.status}).`);
    return ((await done.json().catch(() => null)) ?? {}) as UploadResult;
  } catch (err) {
    // Best effort, so storage never keeps half an upload. The worker's
    // sweep aborts whatever this misses (a closed tab).
    postJson("/api/vault/multipart-abort", { uploadId, key }).catch(() => {});
    throw err;
  }
}

/** Markdown the Vault keeps as text rather than bytes (`api.vault.upload.tsx`). */
export function isInlineMarkdown(file: File): boolean {
  return (file.type === "text/markdown" || file.name.toLowerCase().endsWith(".md")) && file.size <= MAX_INLINE_MARKDOWN_BYTES;
}

/** Stores the file in a Vault folder and returns its file id. Markdown
 * under 5 MB is posted as text; everything else goes straight to storage.
 * `onProgress` gets 0 to 1. */
export async function uploadToVaultFolder(
  file: File,
  folderId: string | null,
  onProgress: (fraction: number) => void = () => {},
  meta: VaultUploadMeta = {},
): Promise<string> {
  if (isInlineMarkdown(file)) return withScreenAwake(() => postInlineMarkdown(file, folderId, onProgress, meta));
  const result = await uploadFile(file, { kind: "folder", folderId }, { onProgress, meta });
  if (!result.fileRef?._id) throw new Error("The upload didn't come back with a file.");
  return result.fileRef._id;
}

async function postInlineMarkdown(
  file: File,
  folderId: string | null,
  onProgress: (fraction: number) => void,
  meta: VaultUploadMeta,
): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  if (folderId) form.append("folderId", folderId);
  if (meta.source) form.append("source", meta.source);
  if (meta.date) form.append("date", meta.date);
  const res = await fetch("/api/vault/upload", { method: "POST", body: form });
  if (!res.ok) throw await errorOf(res, `The upload failed (${res.status}).`);
  const data = (await res.json().catch(() => null)) as { fileRef?: { _id?: string } } | null;
  if (!data?.fileRef?._id) throw new Error("The upload didn't come back with a file.");
  onProgress(1);
  return data.fileRef._id;
}
