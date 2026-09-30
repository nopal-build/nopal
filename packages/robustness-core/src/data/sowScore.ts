/**
 * Scoring a sow run against a hand-built seed (the week grid, Austin,
 * 2026-09-30): the hand-built Campbell week is an answer key, and the
 * count picks the stage's model. Pure; the grid script reads the files.
 *
 * What counts, per line:
 *
 *   +1    a key line recovered verbatim under the right heading
 *   -2    a key line under the wrong name (words in someone's mouth: the
 *         one outcome the seed must never have, so it costs double)
 *   -1    a key line held back as a question (unsure speaker or date)
 *         that the hand-built seed placed confidently
 *   -1    a line the key left out as chatter or AI framing, put back in
 *   +0.5  a key Noted fact present as Noted (matched loosely: Noted
 *         lines are written, not copied)
 *    0    a line on the excused list (the uploader's own take-backs,
 *         which the stage is not asked to make) or outside the window
 *
 * A key line missing altogether scores nothing: the recovered count
 * already carries it.
 */

export type ScoreLine = { date: string; heading: string; text: string };

export type SowCandidate = {
  /** Lines placed under a person. */
  lines: ScoreLine[];
  /** Noted facts; `heading` is ignored. */
  noted: { date: string; text: string }[];
  /** Lines held back for a guide: an unsure speaker or an unsure date. */
  held: { date: string; text: string }[];
};

export type SowKey = {
  lines: ScoreLine[];
  noted: { date: string; text: string }[];
};

export type SowScore = {
  score: number;
  recovered: number;
  wrongName: number;
  heldBack: number;
  extra: number;
  notedHit: number;
  /** Noted lines the key does not have. Reported, never scored: a fact
   * is not a wrong fact for being extra, but a run that writes many is
   * the "page cites facts instead of people" drift, and a reader should
   * see the number. */
  notedExtra: number;
  keyLines: number;
  keyNoted: number;
  excused: number;
  /** Candidate lines that are the remainder of a key line written as two. */
  split: number;
  /** What the count is made of, for the person who reads the diff. */
  detail: {
    missing: ScoreLine[];
    wrongName: { key: ScoreLine; as: string }[];
    heldBack: ScoreLine[];
    extra: ScoreLine[];
    notedMissing: { date: string; text: string }[];
  };
};

// `extra` is counted and shown but weighs nothing: sow's job is the shape
// of a daily log, not the choice of what matters, and the graph stage
// drops what carries nothing. It was -1 while the skill was asked to
// select, and Austin's read of the week grid (2026-09-30) said the key
// was too aggressive about chatter.
export const SOW_WEIGHTS = { recovered: 1, wrongName: -2, heldBack: -1, extra: 0, noted: 0.5 } as const;

/** The form two copies of a person's words are compared in: whitespace
 * collapsed, quote marks and list markers aside, case kept. */
export function scoreFlat(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/^[ \t]*[-*][ \t]+/gm, " ")
    .replace(/\s+/g, " ")
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

/** The same person under two spellings: first names compared. */
function sameName(a: string, b: string): boolean {
  const first = (n: string) => n.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return first(a) === first(b);
}

const STOP = new Set(["the", "and", "that", "with", "for", "from", "was", "were", "are", "has", "have", "had", "but", "not", "this", "their", "they", "his", "her", "its", "into", "out", "who", "what", "when", "will", "would", "could", "should", "been", "than", "then", "them", "there", "about", "also", "only"]);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9$%./-]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d[\d,./–-]*\d|\d/g) ?? []).map((n) => n.replace(/,/g, "")));
}

/** Whether a written Noted line states the key's fact: every number in
 * the key's line, and enough of its content words: half when the fact
 * has no number to anchor it, three in ten when every number matched
 * (the key's own Noted lines sometimes carry a quote or an aside the
 * fact does not need). Loose on purpose. */
export function notedMatches(key: string, candidate: string): boolean {
  const keyNumbers = numbersIn(key);
  const candNumbers = numbersIn(candidate);
  for (const n of keyNumbers) if (!candNumbers.has(n)) return false;
  const keyWords = contentWords(key);
  if (keyWords.size === 0) return keyNumbers.size > 0;
  const candWords = contentWords(candidate);
  let shared = 0;
  for (const w of keyWords) if (candWords.has(w)) shared += 1;
  return shared / keyWords.size >= (keyNumbers.size > 0 ? 0.3 : 0.5);
}

/** The same day, or the day before or after. */
function nearDate(a: string, b: string): boolean {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) <= 86_400_000;
}

/** One side's line contains the other's: a key line that is part of a
 * longer quote, or a quote the key kept only part of. */
function sameWords(a: string, b: string): boolean {
  const x = scoreFlat(a);
  const y = scoreFlat(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 24 && long.includes(short);
}

export function scoreSow(input: {
  key: SowKey;
  candidate: SowCandidate;
  /** Dates that count, inclusive. */
  window: { from: string; to: string };
  /** Substrings of lines that score nothing either way. */
  excused?: readonly string[];
}): SowScore {
  const inWindow = (d: string) => d >= input.window.from && d <= input.window.to;
  const isExcused = (text: string) => (input.excused ?? []).some((s) => scoreFlat(text).includes(scoreFlat(s)));

  const keyLines = input.key.lines.filter((l) => inWindow(l.date));
  const keyNoted = input.key.noted.filter((l) => inWindow(l.date));
  // A candidate line is judged when it falls in the window, or a day past
  // its end (so a key line dated the window's last day can still find it).
  const candLines = input.candidate.lines.filter((l) => inWindow(l.date));
  const candNoted = input.candidate.noted.filter((l) => inWindow(l.date));
  const candHeld = input.candidate.held;

  const usedCand = new Set<number>();
  const detail: SowScore["detail"] = { missing: [], wrongName: [], heldBack: [], extra: [], notedMissing: [] };
  let recovered = 0;
  let wrongName = 0;
  let heldBack = 0;

  for (const k of keyLines) {
    // The same words on the same day, whoever they were put under. A day
    // either side counts too: the hand-built key files two adjacent days
    // of one thread together (7/24 holds a 7/25 line), and a run that
    // dates the line by the day it was said should not lose for it.
    const idx = candLines.findIndex((c, i) => !usedCand.has(i) && nearDate(c.date, k.date) && sameWords(c.text, k.text));
    if (idx !== -1) {
      usedCand.add(idx);
      if (sameName(candLines[idx].heading, k.heading)) recovered += 1;
      else {
        wrongName += 1;
        detail.wrongName.push({ key: k, as: candLines[idx].heading });
      }
      continue;
    }
    if (candHeld.some((h) => sameWords(h.text, k.text))) {
      heldBack += 1;
      detail.heldBack.push(k);
      continue;
    }
    detail.missing.push(k);
  }

  let extra = 0;
  let excused = 0;
  let split = 0;
  candLines.forEach((c, i) => {
    if (usedCand.has(i)) return;
    // The same words on another day are a dating miss, not chatter: the
    // key line is already counted missing, and the extra stands.
    if (isExcused(c.text)) {
      excused += 1;
      return;
    }
    // A key line the run wrote as two: the rest of a quote whose first
    // part already matched. The words are the key's own, so it is not
    // something put back in, and it scores nothing.
    const flat = scoreFlat(c.text);
    if (keyLines.some((k) => nearDate(k.date, c.date) && scoreFlat(k.text).includes(flat))) {
      split += 1;
      return;
    }
    extra += 1;
    detail.extra.push(c);
  });

  let notedHit = 0;
  const usedNoted = new Set<number>();
  for (const k of keyNoted) {
    const idx = candNoted.findIndex((c, i) => !usedNoted.has(i) && c.date === k.date && notedMatches(k.text, c.text));
    if (idx !== -1) {
      usedNoted.add(idx);
      notedHit += 1;
    } else detail.notedMissing.push(k);
  }

  const score =
    recovered * SOW_WEIGHTS.recovered +
    wrongName * SOW_WEIGHTS.wrongName +
    heldBack * SOW_WEIGHTS.heldBack +
    extra * SOW_WEIGHTS.extra +
    notedHit * SOW_WEIGHTS.noted;

  const notedExtra = candNoted.filter((c, i) => !usedNoted.has(i) && !isExcused(c.text)).length;
  return { score, recovered, wrongName, heldBack, extra, notedHit, notedExtra, keyLines: keyLines.length, keyNoted: keyNoted.length, excused, split, detail };
}
