/**
 * Shared Vault types.
 *
 * This file has NO server-only imports so it is safe to import from both
 * route loaders (server) and React components (client).
 */

export type FileShareType = "view" | "workable" | "editable";

export type MdVersion = {
  content: string;
  date: string; // YYYY-MM-DD
};

export type FileRef = {
  id: { tb: string; id: string };
  _id: string;
  human_id: string;
  name: string;
  s3_url: string | null;
  s3_key: string | null;
  content: string | null;
  md_versions: MdVersion[];
  content_type: string;
  folder_id: string | null;
  size: number | null;
  /** Set when the file was uploaded from the Daily Log. */
  source?: "daily_log";
  /** YYYY-MM-DD log date — only present when source === "daily_log". */
  date?: string;
  created_at: string;
  updated_at: string;
  /** How the file is shared when accessed via a shared folder. Defaults to "view". */
  shared_type?: FileShareType;
  /** Whether this card is publicly accessible without authentication. */
  is_public?: boolean;
  /** ISO timestamp set when the file is archived; null/absent when not archived. */
  archived_at?: string | null;
};

/**
 * A daily-log file is read-only once the upload date is no longer today.
 * Safe to call on both client and server — no Node-only imports.
 *
 * The file's `date` field is the user's LOCAL date (YYYY-MM-DD), while
 * Date.toISOString() always returns UTC. Users behind UTC would have their
 * "today" entry look like yesterday in UTC, causing a spurious 403.
 * We therefore allow a 1-day buffer: anything within 1 UTC day of now is
 * considered unlocked, which safely covers every UTC±14 timezone offset.
 */
export function isFileRefLocked(file: FileRef): boolean {
  if (file.source !== "daily_log") return false;
  // Prefer the explicit date field; fall back to created_at for older records.
  const logDate = file.date ?? file.created_at.slice(0, 10);
  const utcNowMs = Date.now();
  const logMs = new Date(logDate + "T00:00:00Z").getTime();
  const diffDays = (utcNowMs - logMs) / (1000 * 60 * 60 * 24);
  // Locked only when the log date is more than 2 full UTC days in the past.
  // A UTC-12 user's "today" entry sits up to 1.5 UTC days behind midnight,
  // so 2 days covers every real-world timezone offset with a safe margin.
  return diffDays > 2;
}

export type VaultFolder = {
  id: { tb: string; id: string };
  _id: string;
  human_id: string;
  name: string;
  parent_folder_id: string | null;
  shared_with: string[] | "everyone";
  created_at: string;
  updated_at: string;
};
