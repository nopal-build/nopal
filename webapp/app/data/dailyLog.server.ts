import { RecordId } from "surrealdb";
import { Data, query, formatRecord, upsert, remove } from "./generic.server";
import {
  upsertDailyLogReadme,
  updateFileRef,
  createFileRef,
  getFolderById,
  getOrCreateVaultFolder,
  ensureVaultRootFolders,
} from "./vault.server";
import type { FileRef } from "./vault.types";

export type DailyLog = Data & {
  humanId: string;
  date: string; // YYYY-MM-DD local date string from user's device
  content: string;
  createdAt: string;
  updatedAt: string;
};

// Stable record ID: "daily_logs:${humanId}_${date}"
function logRecordId(humanId: string, date: string): RecordId {
  return new RecordId("daily_logs", `${humanId}_${date}`);
}

// ─── Reads (from cache) ───────────────────────────────────────────────────────

// Get a single entry by humanId + date
export async function getDailyLogByDate(
  humanId: string,
  date: string,
): Promise<DailyLog | undefined> {
  const result = await query<[DailyLog[]]>(
    `SELECT * FROM daily_logs WHERE humanId = $humanId AND date = $date LIMIT 1;`,
    { humanId, date },
  );
  const record = result?.[0]?.[0];
  return record ? formatRecord(record) : undefined;
}

// Get paginated entries (newest first). Pass `before` (YYYY-MM-DD) to page backwards.
export async function getDailyLogs(
  humanId: string,
  { before, limit = 10 }: { before?: string; limit?: number } = {},
): Promise<{ entries: DailyLog[]; hasMore: boolean }> {
  const queryStr = before
    ? `SELECT * FROM daily_logs WHERE humanId = $humanId AND date < $before ORDER BY date DESC LIMIT $limit;`
    : `SELECT * FROM daily_logs WHERE humanId = $humanId ORDER BY date DESC LIMIT $limit;`;

  const result = await query<[DailyLog[]]>(queryStr, {
    humanId,
    ...(before ? { before } : {}),
    limit: limit + 1, // request one extra to determine hasMore
  });

  const rows = result?.[0] ?? [];
  const hasMore = rows.length > limit;
  return {
    entries: hasMore
      ? rows.slice(0, limit).map(formatRecord)
      : rows.map(formatRecord),
    hasMore,
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/**
 * Primary write entry point — vault is the source of truth.
 * Writes to the vault first, then updates the daily_logs cache.
 */
export async function saveDailyLog(
  humanId: string,
  date: string,
  content: string,
): Promise<DailyLog | undefined> {
  await upsertDailyLogReadme(humanId, date, content);
  return cacheDailyLog(humanId, date, content);
}

/**
 * Lightweight save for workable-mode edits (task check-offs, minor tweaks).
 *
 * Unlike saveDailyLog, this updates the vault file content in-place WITHOUT
 * creating an md_version snapshot — keeping the version history clean for
 * intentional, significant content revisions rather than task state changes.
 *
 * Falls back to a full saveDailyLog when the vault record doesn't exist yet
 * (e.g. the user accesses a day that pre-dates the vault migration).
 */
export async function workableSaveDailyLog(
  humanId: string,
  date: string,
  content: string,
): Promise<DailyLog | undefined> {
  try {
    const rootFolder = await getOrCreateVaultFolder(
      humanId,
      "daily-logs",
      null,
    );
    const dateFolder = await getOrCreateVaultFolder(
      humanId,
      date,
      rootFolder._id,
    );
    const result = await query<[FileRef[]]>(
      `SELECT * FROM file_refs
       WHERE human_id = $humanId
         AND folder_id = $folderId
         AND name = 'readme.md'
       LIMIT 1`,
      { humanId, folderId: dateFolder._id },
    );
    const existing = result?.[0]?.[0]
      ? formatRecord(result[0][0] as unknown as FileRef)
      : null;

    if (existing) {
      // Direct content patch — skips computeMdUpdate so no md_version snapshot
      await updateFileRef(existing._id, { content });
    } else {
      // Vault record missing (e.g. pre-vault entry) — create it properly
      await upsertDailyLogReadme(humanId, date, content);
    }
  } catch (err) {
    console.error("workableSaveDailyLog vault update failed:", err);
    // Non-fatal — cache update proceeds even if vault write fails
  }
  return cacheDailyLog(humanId, date, content);
}

/**
 * Cache-only upsert — updates the daily_logs record without touching the vault.
 * Use this from the vault PATCH handler after the file_ref has already been updated.
 */
export async function cacheDailyLog(
  humanId: string,
  date: string,
  content: string,
): Promise<DailyLog | undefined> {
  const id = logRecordId(humanId, date);
  const now = new Date().toISOString();
  const existing = await getDailyLogByDate(humanId, date);

  const result = await upsert(id, {
    humanId,
    date,
    content,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  const record = Array.isArray(result) ? result[0] : result;
  return record ? formatRecord(record as unknown as DailyLog) : undefined;
}

/**
 * Cache-only delete — removes the daily_logs record without touching the vault.
 * Use this from the vault DELETE handler after the file_ref has been deleted.
 */
export async function deleteDailyLogCache(
  humanId: string,
  date: string,
): Promise<void> {
  await remove("daily_logs", `${humanId}_${date}`);
}

// ─── Cards (`::card{file="..."}`) ──────────────────────────────────────────
// A Card's OWN markdown file lives alongside that day's `readme.md`
// (`daily-logs/YYYY-MM-DD/`), marked `source: "daily_log_card"` (same
// locking convention as the day's own readme — see `isFileRefLocked`) and
// `project_folder_id` (which project it's for). The day's `readme.md` is
// the source of truth for WHICH cards exist/their order (each one gets a
// `::card{file="..."}` leaf directive inserted into it) — these helpers
// only resolve WHERE a card's own content lives, for SSR-friendly loading
// (`getDailyLogCards`) and for creating one (`createDailyLogCard`).

export type DailyLogCard = {
  fileId: string;
  fileName: string;
  projectFolderId: string;
  /** Resolved fresh from the project folder's CURRENT name every time —
   * never cached on the card itself, so a later project rename is
   * reflected immediately without touching every past card. */
  projectName: string;
  content: string;
};

/** Deterministic from the project's folder id (not its name) — so
 * re-clicking the same project's "Add a card" chip twice reliably reuses
 * the SAME file (see `createDailyLogCard`'s idempotency below) and two
 * differently-named projects can never collide onto the same filename
 * via slug sanitization. */
function cardFileName(projectFolderId: string): string {
  return `card-${projectFolderId}.md`;
}

/**
 * Every Card that already exists for `date` — for the daily-log loader to
 * pass down as SSR-ready content (so opening the day never shows an empty
 * flash before a client-side fetch resolves). Only ever READS; the day's
 * folder is expected to already exist (every date passed here comes from
 * an already-saved day, which means `upsertDailyLogReadme` already ran).
 */
export async function getDailyLogCards(
  humanId: string,
  date: string,
): Promise<DailyLogCard[]> {
  const rootFolder = await getOrCreateVaultFolder(humanId, "daily-logs", null);
  const dateFolder = await getOrCreateVaultFolder(humanId, date, rootFolder._id);
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs
     WHERE human_id = $humanId
       AND folder_id = $folderId
       AND source = 'daily_log_card'
     ORDER BY created_at ASC`,
    { humanId, folderId: dateFolder._id },
  );
  const files = (result?.[0] ?? []).map((r) => formatRecord(r as unknown as FileRef));

  const cards: DailyLogCard[] = [];
  for (const file of files) {
    if (!file.project_folder_id) continue;
    const projectFolder = await getFolderById(file.project_folder_id);
    cards.push({
      fileId: file._id,
      fileName: file.name,
      projectFolderId: file.project_folder_id,
      projectName: projectFolder?.name ?? "Unknown project",
      content: file.content ?? "",
    });
  }
  return cards;
}

/**
 * Creates (or, if one already exists for this project/date, reuses) that
 * project's Card for `date` — idempotent BY DESIGN: re-clicking the same
 * project's "Add a card" chip twice, or re-adding a `::card{...}` directive
 * a human previously removed from the readme, always resolves back to the
 * SAME underlying file/content rather than creating a duplicate. This is
 * what makes one-card-per-project-per-day a property of the FILE layer,
 * not just a client-side UI filter (see `AddCardSection` in the route).
 */
export async function createDailyLogCard(
  humanId: string,
  date: string,
  projectFolderId: string,
): Promise<DailyLogCard> {
  const rootFolder = await getOrCreateVaultFolder(humanId, "daily-logs", null);
  const dateFolder = await getOrCreateVaultFolder(humanId, date, rootFolder._id);
  const fileName = cardFileName(projectFolderId);

  const projectFolder = await getFolderById(projectFolderId);
  const projectName = projectFolder?.name ?? "Unknown project";

  const existingResult = await query<[FileRef[]]>(
    `SELECT * FROM file_refs
     WHERE human_id = $humanId AND folder_id = $folderId AND name = $fileName
     LIMIT 1`,
    { humanId, folderId: dateFolder._id, fileName },
  );
  const existing = existingResult?.[0]?.[0]
    ? formatRecord(existingResult[0][0] as unknown as FileRef)
    : null;

  if (existing) {
    return {
      fileId: existing._id,
      fileName: existing.name,
      projectFolderId,
      projectName,
      content: existing.content ?? "",
    };
  }

  const created = await createFileRef({
    human_id: humanId,
    name: fileName,
    content: "",
    content_type: "text/markdown",
    folder_id: dateFolder._id,
    source: "daily_log_card",
    date,
    project_folder_id: projectFolderId,
  });
  if (!created) throw new Error("Failed to create daily log card");

  return {
    fileId: created._id,
    fileName: created.name,
    projectFolderId,
    projectName,
    content: created.content ?? "",
  };
}

/** Plain content update — a Card's content doesn't need `readme.md`'s own
 * md_version snapshotting; it's a much smaller, single-project scope, and
 * per-day granularity already gives it a natural history via the day
 * itself. */
export async function saveDailyLogCard(fileId: string, content: string): Promise<void> {
  await updateFileRef(fileId, { content });
}

const SAMPLE_LOG_MARKDOWN = `# Welcome to your Daily Log

This is a sample entry so you can see all the markdown you can use. Delete it whenever — your real entries will live right alongside it.

---

## Headings

# H1
## H2
### H3
#### H4

---

## Text Formatting

**Bold**, *italic*, and ***bold italic***.

~~Strikethrough~~ and \`inline code\`.

> Blockquote: a thought, a quote, something worth remembering.

---

## Lists

**Unordered:**
- Item one
- Item two
  - Nested item
  - Another nested item
- Item three

**Ordered:**
1. First
2. Second
3. Third

**Task list:**
- [x] Something already done
- [ ] Something still to do
- [ ] Another task

---

## Code

Inline: \`const greeting = "hello world"\`

Block:
\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

---

## Table

| Name      | Value | Notes       |
|-----------|-------|-------------|
| Example A | 42    | First row   |
| Example B | 7     | Second row  |

---

## Links

[Visit nopal](https://nopal.build)

---

Happy logging! ✨
`;

/**
 * Call once after a new Human record is created.
 * Writes the sample entry through the full vault-first path (vault + cache),
 * so the daily-log route shows the entry on first visit.
 */
export async function provisionNewUserVault(humanId: string): Promise<void> {
  try {
    // Locked Vault Root Folders (daily-logs, projects, personal, …)
    await ensureVaultRootFolders(humanId);
    // "Yesterday" in local wall-clock time — one day before account creation.
    // Deliberately avoids UTC methods: the seed runs on the host machine and
    // toISOString() always outputs UTC, so late-evening runs in US timezones
    // would compute UTC "yesterday" = local today.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = [
      yesterday.getFullYear(),
      String(yesterday.getMonth() + 1).padStart(2, "0"),
      String(yesterday.getDate()).padStart(2, "0"),
    ].join("-");

    await saveDailyLog(humanId, dateStr, SAMPLE_LOG_MARKDOWN);
  } catch (err) {
    // Non-fatal: log but don't break user creation
    console.error("provisionNewUserVault failed:", err);
  }
}
