// A project's `Syncs/Daily Logs/` copies are named `<date>-<humanId>.md`
// (`syncedCardFileName`), and that name is the key sync-graph, the
// Logbook and Moves read the writer back out of, so it stays. A listing
// shows who wrote each one beside the name instead (Austin, 2026-10-05:
// Erica's empty THH Card sat in the folder as an id nobody recognised).
import { getHumansById } from "./humans.server";
import { displayName } from "./humanNames";
import {
  DAILY_LOGS_SYNC_FOLDER_NAME,
  parseSyncedAttachmentFileName,
  parseSyncedCardFileName,
} from "./dailyLogSync.server";
import type { FileRefListing, VaultFolder } from "./vault.types";

export type ListedFile = FileRefListing & {
  /** Who wrote the Card this synced copy came from. Only set inside a
   * `Daily Logs` sync folder, and only when the writer still exists. */
  author_name?: string;
};

/** The writer's id a synced copy's name carries, Card parser first (its
 * own doc says to). Pure. */
export function syncedAuthorId(fileName: string): string | null {
  return (parseSyncedCardFileName(fileName) ?? parseSyncedAttachmentFileName(fileName))?.humanId ?? null;
}

/** `files` with `author_name` set from `names` (humanId → name). Pure. */
export function withAuthorNames(
  files: readonly FileRefListing[],
  names: ReadonlyMap<string, string>,
): ListedFile[] {
  return files.map((f) => {
    const id = syncedAuthorId(f.name);
    const name = id ? names.get(id) : undefined;
    return name ? { ...f, author_name: name } : f;
  });
}

/** Adds `author_name` to a `Daily Logs` sync folder's files; any other
 * folder's files come back as they are. */
export async function nameSyncedAuthors(
  folder: Pick<VaultFolder, "name">,
  files: FileRefListing[],
): Promise<ListedFile[]> {
  if (folder.name !== DAILY_LOGS_SYNC_FOLDER_NAME) return files;
  const ids = [...new Set(files.map((f) => syncedAuthorId(f.name)).filter((id): id is string => !!id))];
  if (!ids.length) return files;
  const names = new Map((await getHumansById(ids)).map((h) => [h._id, displayName(h)]));
  return withAuthorNames(files, names);
}
