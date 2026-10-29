// One file into a vault folder from a component that isn't the Vault's
// own upload queue (`VaultV2Page`'s `startUpload`, which this follows):
// a plain POST to `/api/vault/upload` under the multipart threshold, the
// multipart routes at or over it. The same server checks either way.
// Used by the letter's recording, which can pass 100 MB.

const CHUNK_SIZE = 10 * 1024 * 1024;
const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

async function errorOf(res: Response, fallback: string): Promise<Error> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(data?.error ?? fallback);
}

/** Stores the file in the folder and returns its file id. `onProgress`
 * gets 0 to 1. */
export async function uploadToVaultFolder(file: File, folderId: string, onProgress: (fraction: number) => void = () => {}): Promise<string> {
  const contentType = file.type || "application/octet-stream";
  if (file.size < MULTIPART_THRESHOLD) {
    const form = new FormData();
    form.append("file", file);
    form.append("folderId", folderId);
    const res = await fetch("/api/vault/upload", { method: "POST", body: form });
    if (!res.ok) throw await errorOf(res, `The upload failed (${res.status}).`);
    const data = (await res.json().catch(() => null)) as { fileRef?: { _id?: string } } | null;
    if (!data?.fileRef?._id) throw new Error("The upload didn't come back with a file.");
    onProgress(1);
    return data.fileRef._id;
  }

  const init = await fetch("/api/vault/multipart-init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType, folderId, originalName: file.name, size: file.size }),
  });
  if (!init.ok) throw await errorOf(init, `The upload didn't start (${init.status}).`);
  const { uploadId, key } = (await init.json()) as { uploadId: string; key: string };
  try {
    const parts: { PartNumber: number; ETag: string }[] = [];
    const count = Math.ceil(file.size / CHUNK_SIZE);
    for (let i = 0; i < count; i++) {
      const form = new FormData();
      form.append("uploadId", uploadId);
      form.append("key", key);
      form.append("partNumber", String(i + 1));
      form.append("chunk", file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size)));
      const res = await fetch("/api/vault/multipart-part", { method: "POST", body: form });
      if (!res.ok) throw await errorOf(res, `Part ${i + 1} failed (${res.status}).`);
      const { ETag } = (await res.json()) as { ETag: string };
      parts.push({ PartNumber: i + 1, ETag });
      onProgress((i + 1) / count);
    }
    const done = await fetch("/api/vault/multipart-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId, key, parts, name: file.name, folderId, contentType, size: file.size }),
    });
    if (!done.ok) throw await errorOf(done, `The upload didn't finish (${done.status}).`);
    const data = (await done.json().catch(() => null)) as { fileRef?: { _id?: string } } | null;
    if (!data?.fileRef?._id) throw new Error("The upload didn't come back with a file.");
    return data.fileRef._id;
  } catch (err) {
    // Best effort, so storage never keeps half an upload.
    fetch("/api/vault/multipart-abort", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, key }) }).catch(() => {});
    throw err;
  }
}
