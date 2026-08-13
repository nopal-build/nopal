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
 * Mechanics, in order of preference:
 *   1. `text/plain` from the clipboard, when present — the overwhelming
 *      common case; every mainstream browser/OS always populates this
 *      alongside `text/html` for a copy that includes formatted text.
 *   2. A `text/html` fallback, ONLY when `text/plain` is missing/empty —
 *      some sources (e.g. copying a rendered table from certain apps) omit
 *      a `text/plain` entry entirely. Parsed via `DOMParser` (never
 *      `innerHTML` — no script execution, nothing rendered) and reduced to
 *      `.textContent`, so even this fallback still degrades to plain text,
 *      never HTML-derived rich formatting.
 *   3. Otherwise, defer entirely to Lexical's own default paste handling
 *      (return `false`) — covers the rare non-`ClipboardEvent` paste path
 *      (some mobile/IME paste fires `PASTE_COMMAND` with an `InputEvent`/
 *      `KeyboardEvent` instead — see `PasteCommandType`) where there's no
 *      `clipboardData` to strip formatting from in the first place.
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
 * real newlines at block-tag boundaries FIRST keeps a rare source that
 * omits `text/plain` (this fallback's only caller) from collapsing into
 * one run-on line. */
function plainTextFromHtml(html: string): string {
  const withBreaks = html
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n\n</$1>")
    .replace(/<br\s*\/?>/gi, "\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export default function MarkdownPastePlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;

        const text =
          event.clipboardData.getData("text/plain") ||
          plainTextFromHtml(event.clipboardData.getData("text/html"));
        if (!text) return false;

        event.preventDefault();
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
