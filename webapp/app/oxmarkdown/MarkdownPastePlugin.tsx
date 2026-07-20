/**
 * Routes plain-text paste through the REAL OxMarkdown pipeline
 * (`parseOxDocument` + `importOxDocument` — the same one `MarkdownSyncPlugin`
 * uses for whole-document loads) instead of Lexical's default plain-text
 * paste, which would otherwise insert the clipboard text as literal
 * characters with none of our syntax recognized — a pasted `- [ ] task` or
 * `::badge{label="x"}` would land as inert text, not a real checkbox/
 * directive.
 *
 * Deliberately narrow scope, on purpose, not an oversight:
 *   - Only intercepts when the clipboard offers NO `text/html` — i.e. real
 *     plain-text paste. Rich (HTML) paste — copying from a web page, a
 *     word processor, another OxEditor selection, ... — keeps Lexical's own
 *     default HTML-to-node conversion entirely; this plugin never touches
 *     that path at all.
 *   - Only handles a real `ClipboardEvent` (has `.clipboardData`) — a
 *     `PASTE_COMMAND` can also fire for an `InputEvent`/`KeyboardEvent` on
 *     some mobile/IME paths (see `PasteCommandType`); those fall through to
 *     Lexical's default handling unchanged, same as any other paste this
 *     plugin doesn't recognize.
 *   - This is the ONE mechanism (not the live-typing shortcuts in
 *     `checklistTransformer.ts`/`DirectiveShortcutPlugin.tsx`) that gets
 *     full fidelity for anything requiring the real multi-line parser —
 *     container directives, tables, `- [ ] ` WITH its dash — since it
 *     re-parses the whole pasted text at once rather than matching
 *     keystroke-by-keystroke.
 *
 * Registered at `COMMAND_PRIORITY_HIGH`, ABOVE `@lexical/rich-text`'s own
 * default `PASTE_COMMAND` handler (confirmed directly, reading
 * `LexicalRichText.dev.mjs` — it registers at the lowest priority,
 * `COMMAND_PRIORITY_EDITOR`), so this plugin gets first look at every
 * paste; returning `false` for anything out of scope above defers to that
 * default handler exactly as if this plugin didn't exist.
 */

import { useEffect } from "react";
import { $insertNodes, COMMAND_PRIORITY_HIGH, PASTE_COMMAND } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { parseOxDocument } from "./document";
import { importOxDocument } from "./editingTransforms";

export default function MarkdownPastePlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
        if (event.clipboardData.types.includes("text/html")) return false;
        const text = event.clipboardData.getData("text/plain");
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
