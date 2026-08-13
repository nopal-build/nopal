// =============================================================================
// One-off migration: dedupe daily-log "readme.md" mirrors
//
// Run via: npx vite-node scripts/migrate-dedupe-daily-log-readmes.ts
//          npx vite-node scripts/migrate-dedupe-daily-log-readmes.ts --dry-run
//
// Run this AFTER `migrate-merge-duplicate-vault-folders.ts` — merging
// duplicate date folders can leave more than one `readme.md` file_ref in
// the same (now-canonical) folder, one per duplicate folder instance that
// used to exist. `readme.md` is always a plain write-through MIRROR of the
// real source of truth (the `daily_logs` table — see
// `upsertDailyLogReadme`/`saveDailyLog` in `vault.server.ts`/
// `dailyLog.server.ts`) — nobody edits it directly, so it's always safe to
// keep whichever copy matches the current `daily_logs` content for that
// date and delete the rest.
//
// (Unlike a Card's own content, which IS independently authored and can
// genuinely collide with a duplicate — e.g. two different real card files
// ending up with the same deterministic name after a folder merge. That
// case needs a human decision and is deliberately NOT handled by this
// script; check for it manually, e.g. by grouping `file_refs` by
// `(folder_id, name)` and looking for `source = 'daily_log_card'` groups
// with more than one row.)
//
// Idempotent — safe to re-run.
// =============================================================================

import { getDb } from "robustness-core/data/db.server";
import { query, formatRecord, remove } from "robustness-core/data/generic.server";
import type { FileRef } from "robustness-core/data/vault.types";
import type { Human } from "robustness-core/data/humans.server";

const DRY_RUN = process.argv.includes("--dry-run");

async function allHumans(): Promise<Human[]> {
  const result = await query<[Human[]]>(`SELECT * FROM humans`);
  return (result?.[0] ?? []).map(formatRecord);
}

async function readmesForHuman(humanId: string): Promise<FileRef[]> {
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs WHERE human_id = $humanId AND name = 'readme.md' AND source = 'daily_log'`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

async function dailyLogContent(humanId: string, date: string): Promise<string | undefined> {
  const result = await query<[{ content: string }[]]>(
    `SELECT content FROM type::record("daily_logs", $id)`,
    { id: `${humanId}_${date}` },
  );
  return result?.[0]?.[0]?.content;
}

async function dedupeHuman(human: Human): Promise<void> {
  const readmes = await readmesForHuman(human._id);
  const byFolder = new Map<string, FileRef[]>();
  for (const readme of readmes) {
    if (!readme.folder_id) continue;
    const group = byFolder.get(readme.folder_id) ?? [];
    group.push(readme);
    byFolder.set(readme.folder_id, group);
  }

  for (const [folderId, group] of byFolder) {
    if (group.length <= 1) continue;
    const date = group[0].date;
    if (!date) continue;
    const trueContent = await dailyLogContent(human._id, date);
    if (trueContent === undefined) {
      console.log(
        `  ${human._id} folder ${folderId} (date ${date}): no daily_logs record found — skipping, needs manual review`,
      );
      continue;
    }

    let canonical = group.find((r) => r.content === trueContent);
    if (!canonical) {
      canonical = [...group].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      console.log(
        `  ${human._id} folder ${folderId} (date ${date}): no exact content match — falling back to newest (${canonical._id})`,
      );
    } else {
      console.log(
        `  ${human._id} folder ${folderId} (date ${date}): keeping ${canonical._id} (matches daily_logs content)`,
      );
    }

    for (const readme of group) {
      if (readme._id === canonical._id) continue;
      console.log(`    delete stale readme.md ${readme._id}`);
      if (!DRY_RUN) await remove("file_refs", readme._id);
    }
  }
}

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Could not connect to SurrealDB — aborting.");
    process.exit(1);
  }
  await db.close();

  if (DRY_RUN) console.log("DRY RUN — no changes will be written.\n");

  const humans = await allHumans();
  console.log(`Checking ${humans.length} human(s) for duplicate readme.md mirrors…`);
  for (const human of humans) {
    await dedupeHuman(human);
  }
  console.log("\n✓ Done.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
