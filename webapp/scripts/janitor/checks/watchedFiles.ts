import type { Check, Finding } from "../types";

/**
 * The files whose text is the product surface or an agent's briefing, as
 * they stood at the merge base and as they stand now. `null` means the
 * file did not exist on that side.
 */
export interface WatchedFile {
  subject: string;
  before: string | null;
  after: string | null;
}

/** The constant each seeded GraphLog skill lives in, and the file people know it as. */
export const RUNTIME_SKILL_FILE_NAMES: Record<string, string> = {
  DEFAULT_KNOWLEDGE_SKILL: "KNOWLEDGE.md",
  DEFAULT_FILING_SKILL: "FILING.md",
  DEFAULT_GRAPH_SKILL: "GRAPH.md",
  DEFAULT_GRAPH_STRUCTURE_SKILL: "GRAPH_STRUCTURE.md",
  DEFAULT_PROJECT_VIEW_SKILL: "EFFORTS.md",
  DEFAULT_VOICE_SKILL: "VOICE.md",
};

/**
 * The seeded skills are template literals in one TypeScript file, not
 * files of their own, so comparing them across two commits means reading
 * each body out of that file's text. Escapes are left as written: both
 * sides are read the same way, and only the comparison matters.
 */
export function extractRuntimeSkills(source: string): Map<string, string> {
  const skills = new Map<string, string>();
  const re = /export const (DEFAULT_\w+_SKILL) = `((?:\\.|[^`\\])*)`;/g;
  for (const match of source.matchAll(re)) {
    skills.set(RUNTIME_SKILL_FILE_NAMES[match[1]] ?? match[1], match[2]);
  }
  return skills;
}

function size(text: string): { lines: number; words: number } {
  const trimmed = text.trim();
  if (!trimmed) return { lines: 0, words: 0 };
  return { lines: trimmed.split("\n").length, words: trimmed.split(/\s+/).length };
}

/**
 * One line per watched file that changed, with its size on both sides.
 * The size is shown and never judged: no threshold, because a threshold
 * would encode a claim about length that nothing here has measured
 * (ADR-017). PR #52 would have read `graphlog/SKILL.md: 1575 -> 714 lines`.
 */
export const watchedFilesChanged: Check<WatchedFile[]> = (files) =>
  files
    .filter((file) => file.before !== file.after)
    .map((file): Finding => {
      if (file.before === null) {
        const now = size(file.after ?? "");
        return { direction: "vouching", subject: file.subject, message: `new, ${now.lines} lines, ${now.words} words` };
      }
      if (file.after === null) {
        const was = size(file.before);
        return { direction: "vouching", subject: file.subject, message: `removed, was ${was.lines} lines, ${was.words} words` };
      }
      const was = size(file.before);
      const now = size(file.after);
      return {
        direction: "vouching",
        subject: file.subject,
        message: `${was.lines} -> ${now.lines} lines, ${was.words} -> ${now.words} words`,
      };
    });
