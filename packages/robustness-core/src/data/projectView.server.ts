/**
 * The project view's tabs (`/newspaper/:id`). Who reaches the page at all
 * is the role's (ADR-023), refused on the server by `canViewFolder`.
 *
 * Efforts is the page the skills write and comes first. The Logbook is
 * every Card written to the project: anyone on it can get there, and it goes
 * last, because the outputs are what surface and the log is where you
 * trace one back to what somebody said (Austin, 2026-09-24).
 */

import type { FileFolder } from "./fileFolders.server";

export type ProjectTab = "efforts" | "photos" | "files" | "costs" | "logbook";

export const PROJECT_TAB_LABELS: Record<ProjectTab, string> = {
  efforts: "Efforts",
  photos: "Photos",
  files: "Files",
  costs: "Costs",
  logbook: "Logbook",
};

/** Which file folders each file tab shows. */
export const TAB_FOLDERS: Partial<Record<ProjectTab, FileFolder[]>> = {
  photos: ["gallery"],
  files: ["documents", "unsorted"],
  costs: ["costs"],
};

/** The tabs, in order. Only a role that reaches the project's work opens
 * the page at all (everyone but a Client, refused by `canViewFolder`), and
 * each of those gets every tab. */
export const PROJECT_TABS: ProjectTab[] = ["efforts", "photos", "files", "costs", "logbook"];

/** The requested tab when it exists, else Efforts. */
export function resolveProjectTab(requested: string | null): ProjectTab {
  return PROJECT_TABS.includes(requested as ProjectTab) ? (requested as ProjectTab) : "efforts";
}
