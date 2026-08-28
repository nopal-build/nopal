/**
 * Routes ALL paste — plain-text OR rich (HTML) — through the REAL
 * OxMarkdown pipeline (`parseOxDocument` + `importOxDocument`, the same one
 * `MarkdownSyncPlugin` uses for whole-document loads) instead of ever
 * inserting a source's own formatting.
 *
 * REVISED from the original version of this plugin, which deliberately let
 * `text/html` paste through untouched (Lexical's own default HTML-to-node
 * conversion) — reversed directly, not refined: pasting is now always
 * "paste without formatting," full stop. Copying a paragraph from a web
 * page, a Google Doc, Slack, or another OxEditor selection should land as
 * plain OxMarkdown-interpreted text, matching whatever bold/italic/lists/
 * links the CLIPBOARD'S OWN PLAIN-TEXT REPRESENTATION happens to spell out
 * in real markdown syntax — never the source's own fonts, colors, inline
 * styles, or heading levels riding along as literal rich formatting. This
 * is a deliberate, opinionated product decision (an explicit ask, not a
 * bug fix): a markdown editor's paste should never let arbitrary external
 * styling leak into a document whose only real saved format IS markdown.
 *
 * Mechanics, in order:
 *   1. Extract text — `text/plain` from the clipboard when present (the
 *      overwhelming common case), else a `text/html` fallback (some
 *      sources, e.g. copying a rendered table from certain apps, omit
 *      `text/plain` entirely). The HTML fallback is parsed via `DOMParser`
 *      (never `innerHTML` — no script execution, nothing rendered) and
 *      reduced to `.textContent`, converting block-tag boundaries to
 *      newlines FIRST so it doesn't collapse into one run-on line;
 *      non-breaking spaces (`&nbsp;` → U+00A0) are normalized to plain
 *      spaces, since `.textContent` preserves them literally and they'd
 *      otherwise ride along as invisible, non-collapsing whitespace in
 *      saved markdown.
 *   2. Normalize line breaks (`normalizePastedLines`) — inserts a blank
 *      line ONLY between two adjacent lines that are BOTH plain (neither
 *      already a real CommonMark block-starter: a heading, list item,
 *      blockquote, thematic break, or code fence). Real CommonMark block
 *      starters already end/begin a block on their own, single `\n`, no
 *      blank line needed — an ATX heading or list item CAN interrupt a
 *      paragraph per spec, so `"# title\nplain text"` already parses as
 *      two separate blocks with zero modification, and forcing an
 *      unneeded blank line there would just add a visible empty row in
 *      Editing mode (blank lines are real rows there, not CSS margin —
 *      see the `oxmarkdown` skill's "Design language" section) for no
 *      reason. The ONE case that genuinely needs help: two plain lines
 *      with no special syntax on either side, which real CommonMark syntax
 *      has no way to keep as two separate blocks without a blank line
 *      between them — that's the literal, spec-defined difference between
 *      "two paragraphs" and "one paragraph, soft-wrapped across two
 *      lines." Left over from a checklist/list pasted from an external
 *      source (Apple Notes, Google Docs, Figma text layers, ...) with no
 *      markdown syntax of its own: those lines would otherwise silently
 *      fuse into one block/item (confirmed with a real repro: converting
 *      the first of two such fused lines to a heading pulled the second
 *      line into the same heading). REVISED from a first attempt that
 *      unconditionally doubled every newline everywhere — wrong, since it
 *      forced pointless blank-row gaps even where CommonMark's own
 *      heading/list/blockquote interrupt rules already worked correctly.
 *      Skipped entirely when the text contains a code fence (`` ``` ``) or
 *      looks like a markdown table (`|`-rows), since those depend on their
 *      own internal lines staying adjacent.
 *   3. Otherwise, if there's no usable clipboard text at all, defer
 *      entirely to Lexical's own default paste handling (return `false`)
 *      — covers the rare non-`ClipboardEvent` paste path (some mobile/IME
 *      paste fires `PASTE_COMMAND` with an `InputEvent`/`KeyboardEvent`
 *      instead — see `PasteCommandType`) where there's no `clipboardData`
 *      to strip formatting from in the first place.
 *
 * Registered at `COMMAND_PRIORITY_HIGH`, ABOVE `@lexical/rich-text`'s own
 * default `PASTE_COMMAND` handler (confirmed directly, reading
 * `LexicalRichText.dev.mjs` — it registers at the lowest priority,
 * `COMMAND_PRIORITY_EDITOR`), so this plugin gets first look at every
 * paste and — now that it no longer bails out on `text/html` — is the
 * ONLY thing that ever handles a real `ClipboardEvent` paste.
 */

import { useEffect } from "react";
import { $insertNodes, COMMAND_PRIORITY_HIGH, PASTE_COMMAND } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { parseOxDocument } from "oxmarkdown-core";
import { importOxDocument } from "./editingTransforms";

/** Reduces an HTML clipboard payload to plain text, without ever letting
 * the browser execute or render it — `DOMParser` builds a detached
 * document that's never attached to the page (so, unlike `.innerText`,
 * `.textContent` works on it at all — but `.textContent` alone collapses
 * every block-level boundary to nothing, e.g. `<p>A</p><p>B</p>` → `"AB"`
 * with no break between them, since it's oblivious to layout). Inserting
 * real newlines at block-tag boundaries FIRST keeps a source with real
 * block structure from collapsing into one run-on line. */
function plainTextFromHtml(html: string): string {
  const withBreaks = html
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n\n</$1>")
    .replace(/<br\s*\/?>/gi, "\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CODE_FENCE_RE = /^```/m;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/m;

/** Matches a line that's already a real CommonMark block-starter on its
 * own — a heading, list item, blockquote, or thematic break/code fence —
 * none of which need a blank line before/after them to form their own
 * block (see the file-level doc comment). Allows up to 3 leading spaces
 * before the marker, matching CommonMark's own leniency (a heading/list/
 * blockquote indented by 1-3 spaces is still a real block-starter; only
 * 4+ triggers an indented code block instead) — confirmed as a real gap:
 * without this, an indented `"  # heading"` line (e.g. from a source that
 * indents continuation lines) looked "plain" to this check and got an
 * unwanted blank line forced in front of it. */
const BLOCK_STARTER_LINE_RE =
  /^ {0,3}(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|~~~|(-{3,}|\*{3,}|_{3,})\s*$)/;

/** Inserts a blank line only between two adjacent PLAIN lines (neither is
 * a real block-starter) — see the file-level doc comment for why this
 * replaced unconditionally doubling every newline. */
function normalizePastedLines(text: string): string {
  if (CODE_FENCE_RE.test(text) || TABLE_ROW_RE.test(text)) return text;

  const lines = text.split("\n");
  const out: string[] = lines.slice(0, 1);
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];
    const alreadySeparated = prev.trim() === "" || curr.trim() === "";
    const eitherIsStarter =
      BLOCK_STARTER_LINE_RE.test(prev) || BLOCK_STARTER_LINE_RE.test(curr);
    if (!alreadySeparated && !eitherIsStarter) out.push("");
    out.push(curr);
  }
  return out.join("\n");
}

export default function MarkdownPastePlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;

        const rawText =
          event.clipboardData.getData("text/plain") ||
          plainTextFromHtml(event.clipboardData.getData("text/html"));
        if (!rawText) return false;

        event.preventDefault();
        const text = normalizePastedLines(rawText);
        const doc = parseOxDocument(text);
        const { lexicalNodes } = importOxDocument(doc);
        if (lexicalNodes.length > 0) $insertNodes(lexicalNodes);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}
