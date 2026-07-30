// webapp/scripts/pull-daily-logs.ts
//
// Pulls YOUR OWN daily-logs history down from a real deployment (production
// by default) and seeds it into local dev, so PhyLog can be built/tested
// against real content instead of fixtures.
//
// Usage (from webapp/):
//   npx vite-node scripts/pull-daily-logs.ts --token=<bearer-token> --email=you@example.com [--host=https://nopal.build] [--name="Your Name"]
//
// Where to get --token: whatever bearer token your CLI is already using
// against that host (`~/.config/nopal/credentials.json`, or your OS
// keychain entry under service "nopal" if the CLI couldn't write the file
// fallback) — the same token `nopal vault ls` etc. already send as
// `Authorization: Bearer ...`. --email should be the SAME account's email;
// it's used only to create/update a matching local `humans` row so logging
// into LOCAL DEV as that address surfaces this seeded data as yours.
//
// What this does NOT do (by design, kept small and honest about it):
//   - Does NOT pull `projects/` — only `daily-logs/`. A Card file's own
//     `project_folder_id` is preserved verbatim, so it'll point at a
//     project id that doesn't exist locally; `getDailyLogCards` already
//     degrades that to "Unknown project" rather than erroring, and the
//     Card's own text/task/attachment content is still fully intact.
//   - Does NOT copy S3 bytes for non-text attachments (images, PDFs, ...)
//     — only their `s3_key`/`s3_url` pointer is carried over verbatim. If
//     local dev's S3 env vars point at the SAME bucket/region production
//     uses, they'll just work; otherwise they'll 404 when viewed locally,
//     while every markdown file's real TEXT content is fully preserved
//     either way (the part that actually matters for feeding real content
//     into PhyLog).
//
// Idempotent: re-running skips any date/file that already exists locally
// (matched by name within its folder), so it's safe to re-run to pick up
// newer production days without duplicating anything.

import { RecordId } from "surrealdb";
import { getDb } from "../app/data/db.server";
import {
  createFileRef,
  getFileRefsByFolderIds,
  getOrCreateVaultFolder,
} from "../app/data/vault.server";
import type { VaultFolder } from "../app/data/vault.types";

type Args = {
  host: string;
  token: string;
  email: string;
  name: string;
};

function parseArgs(): Args {
  const flags = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) flags.set(match[1], match[2]);
  }
  const token = flags.get("token");
  const email = flags.get("email");
  if (!token || !email) {
    throw new Error(
      "Usage: vite-node scripts/pull-daily-logs.ts --token=<bearer-token> --email=you@example.com [--host=https://nopal.build] [--name=\"Your Name\"]",
    );
  }
  return {
    host: flags.get("host") ?? "https://nopal.build",
    token,
    email: email.trim().toLowerCase(),
    name: flags.get("name") ?? email,
  };
}

// ─── Remote read (production, over HTTP) ───────────────────────────────

type RemoteFileListing = {
  _id: string;
  name: string;
  content_type: string;
  size: number | null;
  source?: "daily_log" | "daily_log_card";
  date?: string;
  project_folder_id?: string | null;
};

type RemoteFullFile = RemoteFileListing & {
  content: string | null;
  s3_key: string | null;
  s3_url: string | null;
};

async function remoteJson<T>(host: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${host}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as T;
}

async function remoteChildren(
  host: string,
  token: string,
  folderId: string,
): Promise<{ folders: VaultFolder[]; files: RemoteFileListing[] }> {
  return remoteJson(host, token, `/api/vault/folders/${folderId}/children`);
}

async function remoteFile(host: string, token: string, fileId: string): Promise<RemoteFullFile> {
  const { file } = await remoteJson<{ file: RemoteFullFile }>(host, token, `/api/vault/${fileId}`);
  return file;
}

// ─── Local write (direct DB, same pattern scripts/seed/index.ts uses) ─────

async function ensureLocalHuman(id: string, email: string, name: string): Promise<void> {
  const db = await getDb();
  try {
    await db.upsert(new RecordId("humans", id), {
      email,
      name,
      role: "Human",
    });
  } finally {
    await db.close();
  }
}

async function main() {
  const { host, token, email, name } = parseArgs();

  console.log(`Reading daily-logs from ${host} ...`);
  const root = await remoteChildren(host, token, "root");
  const dailyLogsRoot = root.folders.find((f) => f.vault_root_key === "daily-logs");
  if (!dailyLogsRoot) {
    throw new Error("No daily-logs root found for this token — is it valid?");
  }
  const humanId = dailyLogsRoot.human_id;
  console.log(`Found daily-logs for human ${humanId}.`);

  await ensureLocalHuman(humanId, email, name);
  console.log(`Upserted local humans:${humanId} (${email}).`);

  const localRoot = await getOrCreateVaultFolder(humanId, "daily-logs", null);

  const { folders: dateFolders } = await remoteChildren(host, token, dailyLogsRoot._id);
  console.log(`Found ${dateFolders.length} day(s) remotely.`);

  let daysCreated = 0;
  let filesCreated = 0;
  let filesSkipped = 0;

  for (let i = 0; i < dateFolders.length; i++) {
    const dateFolder = dateFolders[i];
    const localDateFolder = await getOrCreateVaultFolder(humanId, dateFolder.name, localRoot._id);
    daysCreated++;

    const { files } = await remoteChildren(host, token, dateFolder._id);
    const existing = await getFileRefsByFolderIds([localDateFolder._id]);
    const existingNames = new Set(existing.map((f) => f.name));

    for (const listing of files) {
      if (existingNames.has(listing.name)) {
        filesSkipped++;
        continue;
      }

      const isText = listing.content_type.startsWith("text/");
      const full = isText
        ? await remoteFile(host, token, listing._id)
        : await remoteFile(host, token, listing._id).catch(() => null);

      await createFileRef({
        human_id: humanId,
        name: listing.name,
        content: full?.content ?? null,
        content_type: listing.content_type,
        s3_url: full?.s3_url ?? null,
        s3_key: full?.s3_key ?? null,
        size: listing.size,
        folder_id: localDateFolder._id,
        source: listing.source,
        date: listing.date,
        project_folder_id: listing.project_folder_id ?? null,
      });
      filesCreated++;
    }

    if (i % 20 === 0) {
      console.log(`  ... ${i + 1}/${dateFolders.length} days processed`);
    }
  }

  console.log(
    `\nDone. ${daysCreated} day folder(s) ensured locally, ${filesCreated} file(s) created, ${filesSkipped} already present (skipped).`,
  );
  console.log(
    `Log into local dev as ${email} to see this data (projects/ were NOT pulled — see this script's own header comment).`,
  );
}

main().catch((err) => {
  console.error("Pull failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
