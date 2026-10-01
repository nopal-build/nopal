/**
 * What each group on a project gets (Austin, 2026-09-25: "features drive
 * the UI", "clients get photos"). One list, read by the server and the
 * screen alike: `getProjectRole` hands a member their group's features,
 * and every check below it reads those, never the group's name. A view a
 * group isn't given is refused on the server, not just hidden.
 *
 * The groups are pre-made bundles. Nobody gets a hand-built set; a new
 * need is a new row here, changed by a pull request.
 *
 * Plain module (no `.server`): the screen imports the names.
 */

export const GROUPS = ["Guide", "Crafter", "Observer", "Client"] as const;
export type Group = (typeof GROUPS)[number];

export const GUIDE: Group = "Guide";
export const CLIENT: Group = "Client";

export const FEATURE_NAMES = [
  /** The Efforts page (the project README the skills write). */
  "efforts",
  /** The Photos tab, and the photos themselves, never a cost file. */
  "photos",
  /** The Files tab. */
  "files",
  /** The Costs tab, and the cost read off any file. */
  "costs",
  /** The Logbook tab: every Card written to the project. */
  "logbook",
  /** Writing a mark: a note on a passage of the page or on a file.
   * Moving a passage, filing a file and confirming a cost are `edit`. */
  "marks",
  /** Tapping your own Steep-o-meter reading. */
  "steepTap",
  /** Seeing other people's Steep readings. */
  "steepReadings",
  /** Writing a Card to the project from the Daily Log. */
  "dailyLog",
  /** Changing the project's content: upload, move, rename, GraphLog runs,
   * moving a passage to another project, filing a file, confirming a cost. */
  "edit",
  /** Running the project: its people, name, status and deletion. */
  "people",
  /** What they write (Cards, notes) goes into the project as written.
   * Without it, it waits as a suggestion for a Guide (Austin, 2026-09-28). */
  "feeds",
  /** Taking or passing what someone without `feeds` suggests. */
  "suggestions",
  /** The Budget under Costs: the estimate by line with its confidence,
   * low, high and totals, and changing a line (Austin, 2026-09-29: "only
   * visible to the guide"). A project shows it only once a budget has
   * been started on it. */
  "budget",
] as const;
export type Feature = (typeof FEATURE_NAMES)[number];

const READING: Feature[] = ["efforts", "photos", "files", "costs", "logbook"];

/** The list. Guide is what Owner reached, Crafter what Crafter reached;
 * Observer reads what a Crafter reads, writes Cards and notes, and doesn't
 * edit; what they write waits as a suggestion until a Guide takes it
 * (Austin, 2026-09-28);
 * Client gets Efforts, Photos, the pen for a note, their own tap and
 * their own log (Austin, 2026-09-28: "clients should be able to mark
 * with the annotation"; moving, filing and confirming stay `edit`). */
export const GROUP_FEATURES: Record<Group, readonly Feature[]> = {
  Guide: [...READING, "marks", "steepTap", "steepReadings", "dailyLog", "edit", "people", "feeds", "suggestions", "budget"],
  Crafter: [...READING, "marks", "steepTap", "dailyLog", "edit", "feeds"],
  Observer: [...READING, "marks", "steepTap", "dailyLog"],
  Client: ["efforts", "photos", "marks", "steepTap", "dailyLog", "feeds"],
};

/** The groups someone may give: every group for an admin; a Guide who
 * isn't one gives Client, Crafter or Observer (only an admin makes a
 * Guide, ADR-024). The server refuses the rest either way
 * (`promotionRefusal`); this keeps dead choices off the screen. */
export function assignableGroups(isAdmin: boolean): Group[] {
  return isAdmin ? [...GROUPS] : GROUPS.filter((g) => g !== GUIDE);
}

/** Old names a README may still carry. Owner folded into Guide
 * (2026-09-25); read as Guide, written as Guide on the next save. */
const ALIASES: Record<string, Group> = { Owner: "Guide" };

/** The group a stored role name means, or null for a name nobody knows. */
export function groupOf(name: string): Group | null {
  if ((GROUPS as readonly string[]).includes(name)) return name as Group;
  return ALIASES[name] ?? null;
}

/** A group's features. An unknown name gets nothing. */
export function featuresOf(name: string | null | undefined, list: Record<Group, readonly Feature[]> = GROUP_FEATURES): Feature[] {
  const group = name ? groupOf(name) : null;
  return group ? [...list[group]] : [];
}
