/**
 * The Efforts page is printed, the graph is nightly (ADR-030).
 *
 * The graph builds every night for any project that has one. The page is
 * rebuilt only when someone presses "Print an update" on it: anyone on the
 * project once the last print is a week old, a guide or Nopal staff any
 * time. A print runs the graph first and then the page, so annotations
 * made just before it are on the page it prints.
 *
 * The two rules are pure functions so they can be pinned by tests; the
 * one read here is the date the page was last printed.
 */
import type { Feature } from "./features";
import type { VaultFolder } from "./vault.types";
import { getLatestPageRebuildAt } from "./graphLogPerf.server";

/** How long a non-guide waits between prints. */
export const PRINT_INTERVAL_DAYS = 7;

export type PrintAllowance = {
  /** May press Print now. */
  may: boolean;
  /** Not held to the weekly cap: a guide on this project, or staff. */
  anytime: boolean;
  /** When a capped reader may print next; null when they may now, or
   * when they may never (no `print` feature). */
  nextAt: string | null;
};

/** Who may print, and when. `features` is the reader's role on the
 * project (`resolveRole`); an empty list (no role, e.g. a share from
 * before roles) never prints. The cap counts the last print by anyone. */
export function printAllowance(input: {
  features: readonly Feature[];
  isStaff: boolean;
  printedAt: string | null;
  now: Date;
}): PrintAllowance {
  const guiding = input.features.includes("people");
  if (input.isStaff || guiding) return { may: true, anytime: true, nextAt: null };
  if (!input.features.includes("print")) return { may: false, anytime: false, nextAt: null };
  if (!input.printedAt) return { may: true, anytime: false, nextAt: null };
  const next = new Date(new Date(input.printedAt).getTime() + PRINT_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
  return next.getTime() <= input.now.getTime()
    ? { may: true, anytime: false, nextAt: null }
    : { may: false, anytime: false, nextAt: next.toISOString() };
}

/** Whether a project builds its graph nightly: on unless staff turned it
 * off, and only once it has a graph (a first run, a seed round or a
 * guide's print, makes one). An old project that was never run does not
 * pay its whole backlog on the first night. */
export function isNightly(folder: Pick<VaultFolder, "graphlog_scheduled">, hasGraph: boolean): boolean {
  return folder.graphlog_scheduled !== false && hasGraph;
}

/** The "Printed" date: the stamp graph-project-view writes, or for a
 * project not printed since the stamp existed, the last run that wrote
 * its README. Null when the page has never been built. */
export async function getEffortsPrintedAt(
  folder: Pick<VaultFolder, "_id" | "efforts_printed_at">,
): Promise<string | null> {
  return folder.efforts_printed_at ?? (await getLatestPageRebuildAt(folder._id));
}
