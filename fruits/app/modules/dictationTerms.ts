/**
 * The terms sent to Soniox with each recording (record-in-daily-log seed):
 * until `trusted-terms` exists, what O.No already knows about the project,
 * its name and the names of the people on it. There is no structured
 * address anywhere yet, so the seed's "address" waits for trusted-terms.
 *
 * Soniox's context holds 8000 tokens. The budget here is counted in
 * characters at a conservative three per token, and the projects are taken
 * in the order given, so the Card's own project always goes in first.
 */
export const CONTEXT_CHAR_BUDGET = 8000 * 3;

export type TermsProject = { name: string; people: string[] };

export type SonioxContext = { text: string; terms: string[] };

export function buildDictationContext(projects: TermsProject[], budget = CONTEXT_CHAR_BUDGET): SonioxContext {
  const text = "A construction site daily log, dictated in English or Spanish.";
  const terms: string[] = [];
  const seen = new Set<string>();
  let used = text.length;
  for (const project of projects) {
    for (const term of [project.name, ...project.people]) {
      const t = term.trim();
      const key = t.toLowerCase();
      if (!t || seen.has(key)) continue;
      // +4 for the JSON quotes and comma around each term.
      if (used + t.length + 4 > budget) return { text, terms };
      seen.add(key);
      terms.push(t);
      used += t.length + 4;
    }
  }
  return { text, terms };
}
