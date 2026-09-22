/**
 * Markable units — the smallest things a reader can put a mark on.
 *
 * Built for GraphLog annotations: a person points at a thought on a
 * rendered page and writes about it. A thought is one of four things, and
 * nothing smaller:
 *
 * - a `##` or `###` heading (a `###` on the Efforts page is one effort)
 * - a list item (one bullet, its nested bullets being their own units)
 * - a sentence of a paragraph (the opening read, Regroup, Look-ahead)
 * - a photo or video inside a `:::gallery{}` block
 *
 * No character ranges and no drag selection, on purpose: the page is
 * rewritten every run, and the smallest thing a person can mark is the
 * smallest thing the page asserts.
 *
 * A unit's `key` only has to be stable within one frozen page body. Marks
 * live on the version they were written on and never carry forward (see
 * the annotations guide, 2026-09-18), so the key never has to survive a
 * rewrite. The server recomputes keys from the stored body to validate a
 * mark, and the renderer recomputes them from the same body to place it,
 * which is why this lives in `oxmarkdown-core` rather than on either side,
 * and why sentence splitting is a fixed regex rather than
 * `Intl.Segmenter` (whose ICU data differs between Node and browsers, so
 * the two sides could disagree about where a sentence ends).
 *
 * No React import here, same reason as `document.ts`.
 */

import type { PhrasingContent, RootContent } from "mdast";
import { parseOxDocument, type OxDocument, type DirectiveNode } from "./document";
import { isRefDirective, parseRefAttrs } from "./refDirective";

/** `file` is a unit that is not on any page: an attached file itself, by
 * its original id, so a person's act on a file ("file this as a receipt",
 * "confirmed correct") is a mark like any other. Never produced by
 * `computeMarkUnits`; built server-side by the file-marks route. */
export type MarkUnitKind = "heading" | "bullet" | "sentence" | "photo" | "file";

/** A citation carried by a unit: one person's synced day, never a node.
 * `fileId` is the synced copy's id, read from the ref's `location`. */
export interface MarkUnitRef {
  name: string;
  humanId: string | null;
  /** `YYYY-MM-DD`, from the ref's datetime. */
  date: string;
  fileId: string | null;
}

export interface MarkUnit {
  key: string;
  kind: MarkUnitKind;
  /** Nearest `##` heading above the unit, "" for the opening. A `##`
   * heading's own section is itself. */
  section: string;
  /** Nearest `###` heading above the unit within its section, "" when
   * none. A `###` heading's own effort is itself. */
  effort: string;
  /** The unit's plain text, citations left out, whitespace collapsed. For
   * a photo, its caption (or "" when it has none). */
  text: string;
  refs: MarkUnitRef[];
  /** A gallery photo's vault file id, from `/api/vault/view/<id>`. */
  attachmentId: string | null;
  /** Start offset of the mdast node the unit belongs to. For a sentence,
   * the paragraph's offset; `sentence` then says which one. */
  offset: number;
  sentence: number | null;
}

export interface MarkUnitOptions {
  /** A paragraph whose plain text this returns true for is not markable
   * (GraphLog passes its incomplete-build banner, which is a system
   * warning, not a thought on the page). */
  skipParagraph?: (text: string) => boolean;
}

// ── Sentences ────────────────────────────────────────────────────────────────

/** Where a sentence ends inside a run of text: terminal punctuation, any
 * closing quotes or brackets, then whitespace. The whitespace goes with the
 * sentence that ends, so the next sentence starts on its first word. */
const SENTENCE_END = /[.!?]["'”’)\]]*\s+/g;

/** Splits a paragraph's phrasing children into sentences.
 *
 * Only top-level `text` nodes are split. Anything nested (bold, a
 * highlight, a link) is treated as one piece, so a quotation in `==...==`
 * never gets cut in half. A piece holding no words of its own (a `:ref`
 * that trails its sentence, or the whitespace around it) joins the
 * sentence before it, which is how `...occupancy." :ref{...}` keeps its
 * citation. */
export function splitSentences(children: readonly PhrasingContent[]): PhrasingContent[][] {
  const sentences: PhrasingContent[][] = [];
  let current: PhrasingContent[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const prev = sentences[sentences.length - 1];
    if (prev && !hasWords(current)) prev.push(...current);
    else sentences.push(current);
    current = [];
  };
  for (const child of children) {
    if (child.type !== "text") {
      current.push(child);
      continue;
    }
    const value = child.value;
    let start = 0;
    SENTENCE_END.lastIndex = 0;
    for (let m = SENTENCE_END.exec(value); m; m = SENTENCE_END.exec(value)) {
      const end = m.index + m[0].length;
      current.push({ type: "text", value: value.slice(start, end) });
      flush();
      start = end;
    }
    if (start < value.length) current.push({ type: "text", value: value.slice(start) });
  }
  flush();
  return sentences;
}

function hasWords(nodes: readonly PhrasingContent[]): boolean {
  return /[\p{L}\p{N}]/u.test(plainText(nodes));
}

// ── Plain text and citations ────────────────────────────────────────────────

/** Visible words only: citations and other directives are left out. */
export function plainText(nodes: readonly unknown[]): string {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; value?: unknown; alt?: unknown; children?: unknown[] };
    if (n.type === "textDirective" || n.type === "leafDirective") return;
    if ((n.type === "text" || n.type === "inlineCode") && typeof n.value === "string") parts.push(n.value);
    if (n.type === "image" && typeof n.alt === "string") parts.push(n.alt);
    if (n.type === "break") parts.push(" ");
    if (Array.isArray(n.children)) n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return collapse(parts.join(""));
}

/** Whitespace collapsed, and no space left before punctuation where a
 * citation used to sit ("eaves on :ref{...}." reads "eaves on."). */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").replace(/ ([.,;:!?])/g, "$1").trim();
}

/** The synced file id a `:ref` points at. `location` has been written as
 * both `/vault?file=<id>` and `/fruits/vault?file=<id>`, so read the query
 * parameter rather than matching a prefix. */
export function refFileId(location: string): string | null {
  const q = location.indexOf("?");
  if (q === -1) return null;
  const params = new URLSearchParams(location.slice(q + 1));
  return params.get("file") || null;
}

function collectRefs(nodes: readonly unknown[], skipLists: boolean): MarkUnitRef[] {
  const refs: MarkUnitRef[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; name?: string; children?: unknown[] };
    if (skipLists && n.type === "list") return;
    if (isRefDirective(n as { type: string; name?: string })) {
      const attrs = parseRefAttrs(node as DirectiveNode);
      if (attrs) {
        const ref: MarkUnitRef = {
          name: attrs.name,
          humanId: attrs.humanId ?? null,
          date: attrs.datetime.slice(0, 10),
          fileId: refFileId(attrs.location),
        };
        const id = `${ref.humanId ?? ref.name}|${ref.date}|${ref.fileId ?? ""}`;
        if (!seen.has(id)) {
          seen.add(id);
          refs.push(ref);
        }
      }
      return;
    }
    if (Array.isArray(n.children)) n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return refs;
}

const VIEW_PATH = /\/api\/vault\/view\/([A-Za-z0-9]+)/;

// ── Keys ─────────────────────────────────────────────────────────────────────

/** 32-bit FNV-1a, hex. Only needs to tell units apart within one page. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ── Units ────────────────────────────────────────────────────────────────────

type Draft = Omit<MarkUnit, "key">;

export function computeMarkUnits(doc: OxDocument, options: MarkUnitOptions = {}): MarkUnit[] {
  const drafts: Draft[] = [];
  let section = "";
  let effort = "";
  // The `###` heading currently open, so the refs of everything under it
  // can be gathered onto it once its block ends.
  let openEffort: { draft: Draft; body: unknown[] } | null = null;
  const closeEffort = () => {
    if (openEffort) openEffort.draft.refs = collectRefs(openEffort.body, false);
    openEffort = null;
  };

  const offsetOf = (node: { position?: { start: { offset?: number } } }): number =>
    node.position?.start.offset ?? -1;

  const visitBlocks = (nodes: readonly RootContent[], inGallery: boolean, top: boolean): void => {
    for (const node of nodes) {
      if (top && openEffort && node.type !== "heading") openEffort.body.push(node);
      switch (node.type) {
        case "heading": {
          const text = plainText(node.children);
          if (node.depth <= 3) closeEffort();
          if (node.depth === 2) {
            section = text;
            effort = "";
            drafts.push(unit("heading", section, "", text, [], null, offsetOf(node), null));
          } else if (node.depth === 3) {
            effort = text;
            const draft = unit("heading", section, effort, text, [], null, offsetOf(node), null);
            drafts.push(draft);
            openEffort = { draft, body: [] };
          } else if (top && openEffort) {
            openEffort.body.push(node);
          }
          break;
        }
        case "paragraph": {
          if (inGallery) {
            visitGalleryMedia(node.children);
            break;
          }
          const whole = plainText(node.children);
          if (!whole || options.skipParagraph?.(whole)) break;
          splitSentences(node.children).forEach((pieces, i) => {
            const text = plainText(pieces);
            if (!text) return;
            drafts.push(unit("sentence", section, effort, text, collectRefs(pieces, false), null, offsetOf(node), i));
          });
          break;
        }
        case "list":
          visitList(node);
          break;
        case "blockquote":
          visitBlocks(node.children as RootContent[], inGallery, false);
          break;
        case "containerDirective":
          if ((node as unknown as DirectiveNode).name === "gallery") {
            visitBlocks((node as unknown as DirectiveNode).children as RootContent[], true, false);
          }
          break;
        default:
          break;
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visitList = (list: any): void => {
    for (const item of list.children ?? []) {
      const own = (item.children ?? []).filter((c: { type: string }) => c.type !== "list");
      const text = plainText(own);
      if (text) {
        drafts.push(unit("bullet", section, effort, text, collectRefs(own, true), null, offsetOf(item), null));
      }
      for (const child of item.children ?? []) {
        if (child.type === "list") visitList(child);
      }
    }
  };

  const visitGalleryMedia = (nodes: readonly unknown[]): void => {
    for (const node of nodes) {
      const n = node as { type?: string; url?: string; alt?: string | null; children?: unknown[] };
      const isMedia = n.type === "image" || (n.type === "link" && (n.url ?? "").includes("type=video"));
      if (isMedia) {
        const id = VIEW_PATH.exec(n.url ?? "")?.[1] ?? null;
        const caption = n.type === "image" ? collapse(n.alt ?? "") : plainText(n.children ?? []);
        drafts.push(unit("photo", section, effort, caption, [], id, offsetOf(n as never), null));
        continue;
      }
      if (Array.isArray(n.children)) visitGalleryMedia(n.children);
    }
  };

  visitBlocks(doc.children, false, true);
  closeEffort();

  const seen = new Map<string, number>();
  return drafts.map((d) => {
    // A photo is keyed by its file, not its caption: two photos with the
    // same caption (or none) are still two different photos.
    const identity = d.kind === "photo" ? d.attachmentId ?? d.text : d.text;
    const base = `${d.kind}:${fnv1a(`${d.section}␟${d.effort}␟${identity}`)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...d, key: `${base}:${n}` };
  });
}

function unit(
  kind: MarkUnitKind,
  section: string,
  effort: string,
  text: string,
  refs: MarkUnitRef[],
  attachmentId: string | null,
  offset: number,
  sentence: number | null,
): Draft {
  return { kind, section, effort, text, refs, attachmentId, offset, sentence };
}

export function computeMarkUnitsFromMarkdown(markdown: string, options?: MarkUnitOptions): MarkUnit[] {
  return computeMarkUnits(parseOxDocument(markdown), options);
}

/** Where the renderer looks a unit up: by the offset of the node it is
 * rendering, plus the sentence index for a paragraph. */
export function markUnitLocator(offset: number, sentence: number | null): string {
  return sentence == null ? `${offset}` : `${offset}.${sentence}`;
}
