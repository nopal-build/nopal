/**
 * What counts as "the page" for a mark.
 *
 * A mark is written on a passage of the README, and the page it was
 * written on has to be identifiable: the API refuses a mark aimed at a
 * page that has since been rewritten, and a mark whose page has moved on
 * says it is waiting (see `graphLogMarks.server.ts`).
 *
 * The page is the README body as a reader saw it, minus what code puts on
 * and takes off around the model's words: front matter (sharing and
 * status live there and change for reasons that are not the page), the
 * incomplete-build banner, and change tags. Hashing anything else would
 * orphan every mark on the page the moment the banner toggled.
 *
 * ONLY THE LATEST PAGE EXISTS (Austin, 2026-09-21). An earlier build
 * kept every version a run replaced and rendered its marks, which meant a
 * second page to read and two answers to "what does this project say".
 * The margin now holds what the system has not read yet; once a run reads
 * a mark, the page speaks for it (see `graphLogMarks.server.ts`).
 */

import { createHash } from "node:crypto";
import { splitFrontmatter, stripIncompleteBanner } from "./project.types";
import { stripChangeTags } from "./effortReadings.server";

/** The page as a reader saw it, without what code wraps around it. */
export function pageBody(rawReadme: string): string {
  return stripChangeTags(stripIncompleteBanner(splitFrontmatter(rawReadme).body)).trim();
}

/** Identifies one version of a page. A mark carries the one it was
 * written on. */
export function pageHash(rawReadme: string): string {
  return createHash("sha256").update(pageBody(rawReadme)).digest("hex").slice(0, 16);
}
