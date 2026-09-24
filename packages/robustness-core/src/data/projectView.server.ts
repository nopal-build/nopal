/**
 * The project view's tabs (`/newspaper/:id`), and what each seat may see
 * in them. Decided here on the server; the page only draws what the
 * loader returns (ADR-022).
 *
 * Efforts is the page the skills write and comes first. The Logbook is
 * every Card written to the project: anyone on it can get there, and it goes
 * last, because the outputs are what surface and the log is where you
 * trace one back to what somebody said (Austin, 2026-09-24).
 */

import type { FileFolder, ProjectFileRow } from "./fileFolders.server";
import type { ProjectSeat } from "./project.types";

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

/** The tabs a seat gets, in order. Costs are the guides' until the
 * client-facing budget exists (built later from confirmed costs). */
export function projectTabsFor(seat: ProjectSeat): ProjectTab[] {
  return seat === "client"
    ? ["efforts", "photos", "files", "logbook"]
    : ["efforts", "photos", "files", "costs", "logbook"];
}

/** The requested tab when this seat has it, else Efforts. */
export function resolveProjectTab(requested: string | null, seat: ProjectSeat): ProjectTab {
  const tabs = projectTabsFor(seat);
  return tabs.includes(requested as ProjectTab) ? (requested as ProjectTab) : "efforts";
}

/** File rows a seat may see. A client gets nothing filed as a cost, in
 * any folder: a receipt photo is in Gallery and Costs both, and it is
 * the Costs half that decides. */
export function filesForSeat(rows: ProjectFileRow[], seat: ProjectSeat): ProjectFileRow[] {
  if (seat !== "client") return rows;
  return rows.filter((r) => !r.folders.includes("costs"));
}
