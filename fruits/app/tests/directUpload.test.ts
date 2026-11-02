/**
 * Uploads go browser to storage (2026-11-01). Gerald's phone videos
 * OOM-killed the app from a daily log because the whole file went to the
 * server in one request; #130 moved the daily log onto `vaultUpload.ts`,
 * and this makes that module send bytes to storage itself. What code
 * holds here: the bytes go to presigned storage URLs and
 * never to an app route; the browser's hash is the server's old hash for a
 * file under 100 MB and absent above it; a part that drops is retried; a
 * failed upload is aborted and says why; markdown kept as text still posts;
 * the sign route only signs this person's own keys; a daily log stamp is
 * kept only on the person's own day folder for that date; and nothing new writes
 * `content_hash`, since a hash filled in later would change every
 * fingerprint built on it (photo links, sidecars, day hashes, poison keys).
 * What a person judges: a 500 MB+ `.MOV` in a daily log on staging.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../modules/auth/auth.server", () => ({
  getScopedUserFromRequest: vi.fn(async () => ({ user: { _id: "h1", role: "Member" }, syncScoped: false })),
}));
// The wake lock needs a browser document; here it just runs the upload.
vi.mock("../util/wakeLock", () => ({ withScreenAwake: <T,>(task: () => Promise<T>) => task() }));
const folders = vi.hoisted(() => new Map<string, { _id: string; name: string; human_id: string; parent_folder_id: string | null }>());
vi.mock("robustness-core/data/vault.server", () => ({
  getFolderById: vi.fn(async (id: string) => folders.get(id) ?? null),
  resolveDailyLogsFolder: vi.fn(async (humanId: string) => ({ _id: `${humanId}-daily-logs` })),
  canWriteToFolderId: vi.fn(),
  explainWriteRefusal: vi.fn(),
  isFolderUnderSyncs: vi.fn(),
}));
vi.mock("robustness-core/data/file.server", () => ({
  presignMultipartParts: vi.fn(async (_key: string, _id: string, nums: number[]) => nums.map((n) => ({ partNumber: n, url: `https://s3.test/${n}` }))),
}));

import { isInlineMarkdown, uploadFile, uploadToVaultFolder } from "../components/vaultUpload";
import { dailyLogStamp, uploadTargetFromBody } from "../modules/uploadTarget.server";
import { action as signAction } from "../routes/api.vault.multipart-sign";

const MB = 1024 * 1024;

type Call = { url: string; method: string; body: unknown };

/** A fake app and storage: records every request, answers like the routes. */
function fakeNetwork(options: { etag?: (part: number) => string | null; failPartOnce?: number } = {}) {
  const calls: Call[] = [];
  let failed = false;
  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url, method, body });
    if (url.startsWith("https://s3.test/")) {
      const part = Number(url.split("/").pop());
      if (options.failPartOnce === part && !failed) {
        failed = true;
        throw new TypeError("Failed to fetch");
      }
      const etag = options.etag ? options.etag(part) : `"etag-${part}"`;
      return new Response(null, { status: 200, headers: etag ? { ETag: etag } : {} });
    }
    if (url === "/api/vault/multipart-init") return Response.json({ uploadId: "u1", key: "vault/h1/day/1-clip.mov" });
    if (url === "/api/vault/multipart-sign") {
      const { partNumbers } = body as { partNumbers: number[] };
      return Response.json({ parts: partNumbers.map((n) => ({ partNumber: n, url: `https://s3.test/${n}` })) });
    }
    if (url === "/api/vault/multipart-complete") return Response.json({ fileRef: { _id: "f1", content_type: "video/quicktime" } }, { status: 201 });
    if (url === "/api/vault/multipart-abort") return Response.json({ success: true });
    if (url === "/api/vault/upload") return Response.json({ fileRef: { _id: "md1" } }, { status: 201 });
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function fileOf(size: number, name = "clip.mov", type = "video/quicktime"): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 4096) bytes[i] = i % 251;
  return new File([bytes], name, { type });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("uploadFile", () => {
  it("sends every part to storage, none to the app, and completes with the server's old hash", async () => {
    const calls = fakeNetwork();
    const file = fileOf(25 * MB);
    const progress: number[] = [];
    const result = await uploadFile(
      file,
      { kind: "folder", folderId: "day1" },
      { onProgress: (f) => progress.push(f), meta: { source: "daily_log", date: "2026-11-01" } },
    );

    expect(result.fileRef?._id).toBe("f1");
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.url)).toEqual(["https://s3.test/1", "https://s3.test/2", "https://s3.test/3"]);
    expect(calls.some((c) => c.url === "/api/vault/multipart-part" || c.url === "/api/daily-log/upload")).toBe(false);
    expect(progress.at(-1)).toBe(1);

    const init = calls.find((c) => c.url === "/api/vault/multipart-init")!.body as Record<string, unknown>;
    const complete = calls.find((c) => c.url === "/api/vault/multipart-complete")!.body as Record<string, unknown>;
    expect(init.target).toEqual({ kind: "folder", folderId: "day1" });
    expect(complete.target).toEqual({ kind: "folder", folderId: "day1" });
    // The stamp rides on complete only; the server checks it there.
    expect(init.source).toBeUndefined();
    expect(complete).toMatchObject({ source: "daily_log", date: "2026-11-01" });
    expect(complete.parts).toEqual([1, 2, 3].map((n) => ({ PartNumber: n, ETag: `"etag-${n}"` })));
    // The same sha256 the server computed when it held the bytes.
    const serverHash = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
    expect(complete.contentHash).toBe(serverHash);
  });

  it("sends no hash for a file of 100 MB or more, as large Vault uploads never had one", async () => {
    const calls = fakeNetwork();
    await uploadFile(fileOf(100 * MB), { kind: "folder", folderId: "folder1" });
    const complete = calls.find((c) => c.url === "/api/vault/multipart-complete")!.body as Record<string, unknown>;
    expect(complete.contentHash).toBeNull();
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(10);
  });

  it("retries a part that drops and still finishes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const calls = fakeNetwork({ failPartOnce: 2 });
    const pending = uploadFile(fileOf(15 * MB), { kind: "folder", folderId: null });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ fileRef: { _id: "f1" } });
    expect(calls.filter((c) => c.url === "https://s3.test/2")).toHaveLength(2);
  });

  it("says why and aborts when storage won't show the part's ETag (bucket settings)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const calls = fakeNetwork({ etag: () => null });
    const pending = uploadFile(fileOf(1 * MB), { kind: "folder", folderId: null });
    const outcome = expect(pending).rejects.toThrow(/allow uploads from here/);
    await vi.runAllTimersAsync();
    await outcome;
    expect(calls.some((c) => c.url === "/api/vault/multipart-abort")).toBe(true);
    expect(calls.some((c) => c.url === "/api/vault/multipart-complete")).toBe(false);
  });

  it("signs parts in batches, so a long video is not one huge request", async () => {
    const calls = fakeNetwork();
    await uploadFile(fileOf(510 * MB), { kind: "folder", folderId: null });
    const signs = calls.filter((c) => c.url === "/api/vault/multipart-sign").map((c) => (c.body as { partNumbers: number[] }).partNumbers.length);
    expect(signs).toEqual([50, 1]);
  });

  it("sends a replace as replaceFileId, not a target", async () => {
    const calls = fakeNetwork();
    await uploadFile(fileOf(6 * MB), { kind: "folder", folderId: "folder1" }, { replaceFileId: "old1" });
    const init = calls.find((c) => c.url === "/api/vault/multipart-init")!.body as Record<string, unknown>;
    expect(init.replaceFileId).toBe("old1");
    expect(init.target).toBeUndefined();
  });
});

describe("uploadToVaultFolder", () => {
  it("posts markdown the Vault keeps as text, and nothing else", async () => {
    const calls = fakeNetwork();
    const md = fileOf(1000, "notes.md", "text/markdown");
    expect(isInlineMarkdown(md)).toBe(true);
    expect(await uploadToVaultFolder(md, "folder1")).toBe("md1");
    expect(calls.map((c) => c.url)).toEqual(["/api/vault/upload"]);
  });

  it("sends a photo straight to storage", async () => {
    const calls = fakeNetwork();
    expect(await uploadToVaultFolder(fileOf(2 * MB, "IMG_1.jpg", "image/jpeg"), "folder1")).toBe("f1");
    expect(calls.some((c) => c.url === "/api/vault/upload")).toBe(false);
  });
});

describe("dailyLogStamp", () => {
  beforeEach(() => {
    folders.clear();
    folders.set("day1", { _id: "day1", name: "2026-11-01", human_id: "h1", parent_folder_id: "h1-daily-logs" });
    folders.set("project1", { _id: "project1", name: "2026-10-01", human_id: "h1", parent_folder_id: "projects" });
    folders.set("theirs", { _id: "theirs", name: "2026-11-01", human_id: "h2", parent_folder_id: "h2-daily-logs" });
  });

  it("keeps the stamp on the person's own day folder for that date", async () => {
    expect(await dailyLogStamp("h1", "day1", "daily_log", "2026-11-01")).toEqual({ source: "daily_log", date: "2026-11-01" });
  });

  it("drops a stamp that would lock a file it doesn't describe", async () => {
    // A past date on today's folder: the lock would fire at once.
    expect(await dailyLogStamp("h1", "day1", "daily_log", "2026-10-01")).toBeNull();
    // A folder named like a date that isn't under Daily Logs.
    expect(await dailyLogStamp("h1", "project1", "daily_log", "2026-10-01")).toBeNull();
    // Someone else's day folder.
    expect(await dailyLogStamp("h1", "theirs", "daily_log", "2026-11-01")).toBeNull();
    // Any other source, a bad date, or no folder.
    expect(await dailyLogStamp("h1", "day1", "daily_log_card", "2026-11-01")).toBeNull();
    expect(await dailyLogStamp("h1", "day1", "daily_log", "Nov 1")).toBeNull();
    expect(await dailyLogStamp("h1", null, "daily_log", "2026-11-01")).toBeNull();
  });
});

describe("uploadTargetFromBody", () => {
  it("reads an older caller's bare folderId (the CLI) as a folder", () => {
    expect(uploadTargetFromBody({ folderId: "folder1" })).toEqual({ kind: "folder", folderId: "folder1" });
    expect(uploadTargetFromBody({})).toEqual({ kind: "folder", folderId: null });
  });

  it("takes a seed packet by project, and refuses a kind it doesn't know", () => {
    expect(uploadTargetFromBody({ target: { kind: "seedPacket", projectFolderId: "p1" } })).toEqual({ kind: "seedPacket", projectFolderId: "p1" });
    expect(uploadTargetFromBody({ target: { kind: "elsewhere" } })).toBeNull();
  });
});

describe("POST /api/vault/multipart-sign", () => {
  const sign = (body: unknown) =>
    signAction({ request: new Request("http://app.test/api/vault/multipart-sign", { method: "POST", body: JSON.stringify(body) }) } as never);

  beforeEach(() => vi.clearAllMocks());

  it("signs this person's own key", async () => {
    const res = await sign({ uploadId: "u1", key: "vault/h1/day/1-clip.mov", partNumbers: [1, 2] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { parts: unknown[] }).parts).toHaveLength(2);
  });

  it("refuses someone else's key", async () => {
    const res = await sign({ uploadId: "u1", key: "vault/h2/day/1-clip.mov", partNumbers: [1] });
    expect(res.status).toBe(403);
  });

  it("refuses a bad part number and an oversized batch", async () => {
    expect((await sign({ uploadId: "u1", key: "vault/h1/x", partNumbers: [0] })).status).toBe(400);
    expect((await sign({ uploadId: "u1", key: "vault/h1/x", partNumbers: Array.from({ length: 51 }, (_, i) => i + 1) })).status).toBe(400);
  });
});

describe("content_hash is written only where it always was", () => {
  // Every file that sets `content_hash` on a record as of 2026-11-01. A new
  // writer, above all one that fills a missing hash in later from the
  // worker, would move every fingerprint built on it once per file:
  // photos re-linked, sidecars re-described, days re-extracted, poison
  // strikes reset. Adding a file here means checking that first.
  const WRITERS = new Set([
    "fruits/app/routes/api.daily-log.upload.tsx",
    "fruits/app/routes/api.projects.$folderId.letters.tsx",
    "fruits/app/routes/api.seed-packet.tsx",
    "fruits/app/routes/api.vault.multipart-complete.tsx",
    "fruits/app/routes/api.vault.replace.$fileId.tsx",
    "fruits/app/routes/api.vault.sync-manifest.tsx",
    "fruits/app/routes/api.vault.upload.tsx",
    "packages/robustness-core/src/data/dailyLogSync.server.ts",
    "packages/robustness-core/src/data/fileReplace.server.ts",
    "packages/robustness-core/src/data/letterSend.server.ts",
    "packages/robustness-core/src/data/letters.server.ts",
    "packages/robustness-core/src/data/letterSync.server.ts",
    "packages/robustness-core/src/data/releaseLog.server.ts",
    "packages/robustness-core/src/data/seedPackets.server.ts",
    "packages/robustness-core/src/data/seed.server.ts",
    "packages/robustness-core/src/data/sorter.server.ts",
    "packages/robustness-core/src/data/syncApi.server.ts",
    "packages/robustness-core/src/data/vault.server.ts",
  ]);
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === "tests" || name === "node_modules" ? [] : files(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }

  it("has no new writer", () => {
    const dirs = ["fruits/app", "packages/robustness-core/src", "packages/worker"].map((d) => path.join(ROOT, d));
    const writers = dirs
      .flatMap(files)
      .filter((f) => /content_hash\s*:/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(writers.filter((f) => !WRITERS.has(f))).toEqual([]);
  });
});
