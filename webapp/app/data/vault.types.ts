/**
 * Shared Vault types.
 *
 * This file has NO server-only imports so it is safe to import from both
 * route loaders (server) and React components (client).
 */

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
};

/**
 * A daily-log file is read-only once the upload date is no longer today.
 * Safe to call on both client and server — no Node-only imports.
 */
export function isFileRefLocked(file: FileRef): boolean {
  if (file.source !== "daily_log") return false;
  const today = new Date().toISOString().slice(0, 10);
  // Prefer the explicit date field; fall back to created_at for older records.
  const logDate = file.date ?? file.created_at.slice(0, 10);
  return logDate !== today;
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
