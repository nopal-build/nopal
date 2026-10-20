/**
 * Which `_knowledge/` sidecar belongs to which source file.
 *
 * A sidecar is named after its source with the extension dropped
 * (`IMG_1523.jpeg` -> `IMG_1523.knowledge.md`), so two files in one folder
 * that differ only by extension (`run-1.md` / `run-1.csv`, an iPhone Live
 * Photo's `IMG_1523.HEIC` / `IMG_1523.MOV`) used to share one sidecar and
 * overwrite each other's on every run: each saw the other's hash, so both
 * were described and filed again, every run (Hot box, 2026-10-20: 46 calls
 * a night for files that never changed).
 *
 * Every sidecar already records the file it was written for (`source:` in
 * its front matter), so ownership is checked, not guessed. The plain name
 * stays the first choice, so every existing sidecar keeps its name and
 * nothing is described again. A file whose plain name is held by a
 * different source uses the name that keeps its extension
 * (`run-1.csv.knowledge.md`). A sidecar with no `source:` (none should
 * exist) counts as the plain name's owner, which is what it was before.
 */
import { parse as parseYaml } from "yaml";
import { splitFrontmatter } from "./project.types";

export type SidecarSuffix = ".knowledge.md" | ".filing.md";

/** `[plain, withExtension]`: `IMG_1523.jpeg` -> `IMG_1523.knowledge.md`,
 * `IMG_1523.jpeg.knowledge.md`. A name with no extension has one name. */
export function sidecarNames(sourceName: string, suffix: SidecarSuffix): [string, string] {
  const dot = sourceName.lastIndexOf(".");
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  return [`${base}${suffix}`, `${sourceName}${suffix}`];
}

/** The `source:` file id a sidecar was written for, or null. */
export function sidecarSource(content: string | null | undefined): string | null {
  if (!content) return null;
  const { frontmatter } = splitFrontmatter(content);
  if (!frontmatter) return null;
  try {
    const data = parseYaml(frontmatter) as Record<string, unknown> | null;
    return typeof data?.source === "string" ? data.source : null;
  } catch {
    return null;
  }
}

/**
 * The sidecar name this source file owns, given what the folder already
 * holds. `contentOf` returns a sidecar's content by name, or undefined
 * when there is no file by that name (it may be async, so a caller can
 * read lazily).
 *
 * - The plain name, when it is free or already this file's.
 * - Otherwise the name that keeps the extension.
 *
 * `existing` is that name's current content, or null when the sidecar
 * still has to be written.
 */
export async function resolveSidecar(
  sourceName: string,
  sourceFileId: string,
  suffix: SidecarSuffix,
  contentOf: (name: string) => Promise<string | null | undefined> | string | null | undefined,
): Promise<{ name: string; existing: string | null }> {
  const [plain, withExtension] = sidecarNames(sourceName, suffix);
  const plainContent = await contentOf(plain);
  if (plainContent === undefined) return { name: plain, existing: null };
  const owner = sidecarSource(plainContent);
  if (owner === null || owner === sourceFileId || plain === withExtension) {
    return { name: plain, existing: plainContent };
  }
  return { name: withExtension, existing: (await contentOf(withExtension)) ?? null };
}

/** The sidecar name a READER should open for a source file: the name
 * that keeps the extension when one was written (it only ever is when a
 * sibling held the plain name), otherwise the plain name. Needs no file
 * id, so the graph and the Files view read exactly what the writer chose. */
export function sidecarNameToRead(sourceName: string, suffix: SidecarSuffix, exists: (name: string) => boolean): string {
  const [plain, withExtension] = sidecarNames(sourceName, suffix);
  return plain !== withExtension && exists(withExtension) ? withExtension : plain;
}
