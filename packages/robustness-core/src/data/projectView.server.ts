/**
 * The project view's tabs (`/newspaper/:id`). Which tabs a member sees,
 * and which files they're sent, is their group's features (`features.ts`),
 * refused on the server, not just hidden.
 *
 * Efforts is the page the skills write and comes first. The Logbook is
 * every Card written to the project: anyone on it can get there, and it goes
 * last, because the outputs are what surface and the log is where you
 * trace one back to what somebody said (Austin, 2026-09-24).
 */

import type { FileFolder, ProjectFileRow } from "./fileFolders.server";
import type { Feature } from "./features";

export type ProjectTab = "efforts" | "photos" | "files" | "costs" | "logbook" | "suggestions";

export const PROJECT_TAB_LABELS: Record<ProjectTab, string> = {
  efforts: "Efforts",
  photos: "Photos",
  files: "Files",
  costs: "Costs",
  logbook: "Logbook",
  suggestions: "Suggestions",
};

/** Which file folders each file tab shows. */
export const TAB_FOLDERS: Partial<Record<ProjectTab, FileFolder[]>> = {
  photos: ["gallery"],
  files: ["documents", "unsorted"],
  costs: ["costs"],
};

/** The tabs, in order. Each is a feature of the same name on the
 * features list (`features.ts`): a group sees the tabs it is given.
 * Suggestions is the one exception (`seesSuggestions`). */
export const PROJECT_TABS: ProjectTab[] = ["efforts", "photos", "files", "costs", "logbook", "suggestions"];

/** The tabs a member with these features sees, in order. */
export function tabsFor(features: readonly Feature[]): ProjectTab[] {
  return PROJECT_TABS.filter((t) => (t === "suggestions" ? seesSuggestions(features) : features.includes(t)));
}

/** The Suggestions tab: a Guide, to take or pass them, and someone whose
 * writing waits there (no `feeds`), to see their own. */
export function seesSuggestions(features: readonly Feature[]): boolean {
  return (
    features.includes("suggestions") ||
    (!features.includes("feeds") && (features.includes("dailyLog") || features.includes("marks")))
  );
}

/** The tab to open: the one asked for when it is given, and the first
 * given one when none (or no real tab) was asked for. Null, a 404, when a
 * real tab is asked for that this member isn't given. */
export function resolveProjectTab(requested: string | null, allowed: readonly ProjectTab[] = PROJECT_TABS): ProjectTab | null {
  if (!PROJECT_TABS.includes(requested as ProjectTab)) return allowed[0] ?? null;
  return allowed.includes(requested as ProjectTab) ? (requested as ProjectTab) : null;
}

/** The file rows a member with these features is sent: only rows that
 * sit in a tab they're given; without `costs`, no cost file at all (a
 * photo of a receipt is a cost file) and no cost read off anything;
 * without `logbook`, not the log's words around an attachment. */
export function rowsForReader(rows: readonly ProjectFileRow[], features: readonly Feature[]): ProjectFileRow[] {
  const folders = new Set(tabsFor(features).flatMap((t) => TAB_FOLDERS[t] ?? []));
  const costs = features.includes("costs");
  const logbook = features.includes("logbook");
  return rows
    .filter((r) => r.folders.some((f) => folders.has(f)))
    .filter((r) => costs || !r.folders.includes("costs"))
    .map((r) => (costs && logbook ? r : { ...r, cost: costs ? r.cost : null, context: logbook ? r.context : "" }));
}

/** Whether a member with these features may open this file as a photo:
 * the Photos rule, the same one the tab shows. */
export function isReachablePhoto(row: Pick<ProjectFileRow, "folders">, features: readonly Feature[]): boolean {
  return features.includes("photos") && row.folders.includes("gallery") && !row.folders.includes("costs");
}
