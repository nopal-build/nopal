import { RecordId } from "surrealdb";
import { Data, query, formatRecord, upsert, remove } from "./generic.server";
import { upsertDailyLogReadme } from "./vault.server";

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

// ─── New-user provisioning ────────────────────────────────────────────────────

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
