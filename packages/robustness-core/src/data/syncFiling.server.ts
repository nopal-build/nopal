/**
 * The filing record: what kind of document an attached file is, and for
 * a cost document, what it says. One small file per attachment,
 * `_knowledge/<base>.filing.md`, beside the description sidecar and
 * DELIBERATELY not inside it.
 *
 * Why a second file. Each day's graph hashes its description sidecars
 * (`syncGraph.server.ts`, the day's `sourceHash`), so a kind written into
 * `<base>.knowledge.md` would re-extract that day, renumber its nodes and
 * rewrite the page, on every project, once. The filing file is read by
 * the files view and by nothing in the pipeline, so filing every
 * attachment a project already has changes no day and no page.
 *
 * Who decides what (the guide's split): the model reads the file and
 * says the kind, with a one-line reason, and for a cost document reads
 * out vendor, amount, date and the lines each came from. Code decides
 * whether that answer is well formed (`validateFiling`) and never lets a
 * malformed one through: the file stays unfiled and is asked again next
 * run. A person confirms a cost (round 3); nothing here is a confirmation.
 *
 * The model writes YAML; code parses it. Counts (how many read-from
 * lines) are computed at read time, never written by the model.
 */

import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitFrontmatter } from "./project.types";

/** Every kind a file can be filed as. `video` is assigned by code from
 * the content type and never asked of the model. The prose list in
 * `FILING.md` states the other eleven; the Janitor holds the two equal. */
export const FILING_KINDS = [
  "photo",
  "problem-photo",
  "video",
  "drawing",
  "spec",
  "permit",
  "contract",
  "receipt",
  "invoice",
  "estimate",
  "bid",
  "other",
] as const;
export type FilingKind = (typeof FILING_KINDS)[number];

/** The kinds that carry money and land in Costs. */
export const COST_KINDS = ["receipt", "invoice", "estimate", "bid"] as const;
export type CostKind = (typeof COST_KINDS)[number];

export function isFilingKind(value: unknown): value is FilingKind {
  return typeof value === "string" && (FILING_KINDS as readonly string[]).includes(value);
}
export function isCostKind(value: unknown): value is CostKind {
  return typeof value === "string" && (COST_KINDS as readonly string[]).includes(value);
}

export type FilingCost = {
  vendor: string;
  /** Two decimals, no sign: "412.18". */
  amount: string;
  /** Three letters: "USD". */
  currency: string;
  /** `YYYY-MM-DD`, or null when the document prints none. */
  date: string | null;
  /** The document's own lines the values were read from, quoted. */
  readFrom: string[];
};

export type Filing = {
  kind: FilingKind;
  reason: string;
  cost: FilingCost | null;
};

export type FilingSource = "image" | "pdf" | "text" | "video-code";

/** The stage's own framing, in front of the project's `FILING.md`. Code
 * owns this part: it says what the answer's shape is, so a project
 * owner rewriting the skill cannot accidentally break the parser. */
export const FILING_FRAMING = `You are filing one file that was attached to a project's daily-log Card: what kind of document it is, and, for a cost document, what it says. The instructions below say how to judge that. Answer with exactly one fenced \`\`\`yaml block and nothing outside it.`;

const REASON_LIMIT = 300;
const VENDOR_LIMIT = 120;
const READ_FROM_LIMIT = 200;
const READ_FROM_MAX = 10;

/** `IMG_1523.jpeg` -> `IMG_1523.filing.md`. The same base rule as
 * `knowledgeFileName` in `syncKnowledge.server.ts`, so the two sit side
 * by side in `_knowledge/` and never share a name. */
export function filingFileName(sourceName: string): string {
  const dot = sourceName.lastIndexOf(".");
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  return `${base}.filing.md`;
}

/** The YAML the model answered with: the first fenced block if there is
 * one, else the whole text. `null` when nothing parses. */
export function parseFilingYaml(text: string): unknown {
  const fenced = /```(?:yaml|yml)?\s*\n([\s\S]*?)\n```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  try {
    return parseYaml(candidate);
  } catch {
    return null;
  }
}

export type FilingValidation = { ok: true; filing: Filing } | { ok: false; reason: string };

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/** "412.18" from a string or a number. YAML reads an unquoted `412.10` as
 * the number 412.1, so one decimal is accepted and normalised. A
 * thousands separator and a leading currency sign are formatting habits
 * the document itself has ("$1,866.83"), so they are stripped rather than
 * rejected: a rejection is asked again next run, for the same answer, at
 * the same price. A negative, a word, or three decimals is rejected. */
function normaliseAmount(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return value.toFixed(2);
  }
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^[$€£]\s*/, "").replace(/,(?=\d{3}\b)/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  return `${m[1]}.${(m[2] ?? "").padEnd(2, "0")}`;
}

function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** `YYYY-MM-DD` from a string, or from a Date should a YAML schema hand
 * one over. */
function normaliseDate(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const s = asTrimmedString(value);
  if (!s || !isRealDate(s)) return "invalid";
  return s;
}

/**
 * The rules the skill tells the model code checks. A failure names its
 * reason so the log can say why a file stayed unfiled.
 */
export function validateFiling(raw: unknown): FilingValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not a YAML mapping" };
  const r = raw as Record<string, unknown>;
  const kind = asTrimmedString(r.kind)?.toLowerCase();
  if (!isFilingKind(kind)) return { ok: false, reason: `kind "${String(r.kind ?? "")}" is not one of ${FILING_KINDS.join(", ")}` };
  const reason = asTrimmedString(r.reason);
  if (!reason) return { ok: false, reason: "no reason" };
  if (reason.length > REASON_LIMIT) return { ok: false, reason: `reason longer than ${REASON_LIMIT} characters` };

  const hasCostField = ["vendor", "amount", "currency", "date", "readFrom"].some(
    (k) => r[k] !== undefined && r[k] !== null && r[k] !== "",
  );
  if (!isCostKind(kind)) {
    if (hasCostField) return { ok: false, reason: `a ${kind} carries no cost fields` };
    return { ok: true, filing: { kind, reason, cost: null } };
  }

  const vendor = asTrimmedString(r.vendor);
  if (!vendor) return { ok: false, reason: `a ${kind} needs a vendor` };
  if (vendor.length > VENDOR_LIMIT) return { ok: false, reason: `vendor longer than ${VENDOR_LIMIT} characters` };
  const amount = normaliseAmount(r.amount);
  if (!amount) return { ok: false, reason: `amount "${String(r.amount ?? "")}" is not a plain number with two decimals` };
  const currencyRaw = asTrimmedString(r.currency)?.toUpperCase() ?? "USD";
  if (!/^[A-Z]{3}$/.test(currencyRaw)) return { ok: false, reason: `currency "${currencyRaw}" is not a three-letter code` };
  const date = normaliseDate(r.date);
  if (date === "invalid") return { ok: false, reason: `date "${String(r.date)}" is not a real YYYY-MM-DD date` };
  let readFrom: string[] = [];
  if (r.readFrom !== undefined && r.readFrom !== null) {
    if (!Array.isArray(r.readFrom)) return { ok: false, reason: "readFrom is not a list" };
    readFrom = r.readFrom.map((line) => (typeof line === "string" ? line.trim() : String(line))).filter((line) => line.length > 0);
    if (readFrom.length > READ_FROM_MAX) return { ok: false, reason: `more than ${READ_FROM_MAX} readFrom lines` };
    if (readFrom.some((line) => line.length > READ_FROM_LIMIT)) return { ok: false, reason: `a readFrom line is longer than ${READ_FROM_LIMIT} characters` };
  }
  return { ok: true, filing: { kind, reason, cost: { vendor, amount, currency: currencyRaw, date, readFrom } } };
}

/** What a person's confirmation names: the values, not the file. A
 * re-read that changes any value returns the cost to unconfirmed; a
 * re-read with the same values (reset-knowledge, a reworded reason)
 * keeps the confirmation. */
export function filingValuesHash(filing: Filing): string {
  const c = filing.cost;
  const basis = [filing.kind, c?.vendor ?? "", c?.amount ?? "", c?.currency ?? "", c?.date ?? ""].join("|");
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export type FilingRecord = {
  sourceHash: string;
  skillFingerprint: string | null;
  describedFrom: FilingSource | null;
  filing: Filing;
};

/** The file's content: front matter carries everything, the body is one
 * line saying what the file is, the shape `efforts.md` uses. */
export function buildFilingContent(input: {
  sourceFileId: string;
  hash: string;
  skillFingerprint: string;
  describedFrom: FilingSource;
  filing: Filing;
}): string {
  const { filing } = input;
  const frontmatter = stringifyYaml({
    source: input.sourceFileId,
    sourceHash: input.hash,
    generatedAt: new Date().toISOString(),
    skillFingerprint: input.skillFingerprint,
    describedFrom: input.describedFrom,
    kind: filing.kind,
    reason: filing.reason,
    ...(filing.cost
      ? {
          vendor: filing.cost.vendor,
          amount: filing.cost.amount,
          currency: filing.cost.currency,
          ...(filing.cost.date ? { date: filing.cost.date } : {}),
          readFrom: filing.cost.readFrom,
        }
      : {}),
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n*Filed by the model from the file itself. The kind and any cost values are its reading, held here until a person confirms them; nothing in the graph cites this file.*\n`;
}

/** Reads a filing file back, validating it again on the way (an old or
 * hand-edited record that fails is treated as absent, so the file is
 * filed again next run). */
export function readFilingRecord(content: string | null | undefined): FilingRecord | null {
  if (!content) return null;
  const { frontmatter } = splitFrontmatter(content);
  if (!frontmatter) return null;
  let data: Record<string, unknown> | null;
  try {
    data = parseYaml(frontmatter) as Record<string, unknown> | null;
  } catch {
    return null;
  }
  if (!data || typeof data.sourceHash !== "string") return null;
  const validated = validateFiling(data);
  if (!validated.ok) return null;
  const describedFrom = data.describedFrom;
  return {
    sourceHash: data.sourceHash,
    skillFingerprint: typeof data.skillFingerprint === "string" ? data.skillFingerprint : null,
    describedFrom:
      describedFrom === "image" || describedFrom === "pdf" || describedFrom === "text" || describedFrom === "video-code"
        ? describedFrom
        : null,
    filing: validated.filing,
  };
}
