/**
 * Keeps an Editing-mode document at least `minRows` rows tall, padding
 * with plain empty `ParagraphNode`s at the END whenever real content
 * shrinks below that (e.g. Backspace merging away a blank line on the
 * last row) — so the editor is always clickable anywhere within its
 * minimum height instead of only wherever real content happens to reach.
 * This only ever tops rows UP to the minimum; it never removes anything,
 * so typing past the minimum grows the editor exactly as normal.
 *
 * `minRows` defaults to `DEFAULT_MIN_EDITOR_ROWS` (4, matching
 * `.ox-editing-surface`'s own default `min-height` in `oxmarkdown.css` —
 * kept in sync by hand, since CSS can't reference a JS constant
 * directly) but callers can pass any number — e.g. a `::file{...}`
 * directive's caption editor uses `1` (see `editingNodes.tsx`), since a
 * caption should start small and simply grow with its own content, not
 * reserve a whole 4-row canvas like a full card/prose editor does.
 * Anything below `0` is treated as `1` — a document always has (and
 * needs) at least one real row to be clickable at all.
 *
 * The padding is invisible to the saved markdown: `exportOxDocument`
 * always trims wholly-blank trailing paragraphs before serializing (see
 * `editingTransforms.ts`), regardless of whether they came from this
 * padding or a user's own trailing Enter presses — so this never bloats
 * a saved file with meaningless trailing blank lines.
 *
 * Implemented as a `RootNode` transform, not a keydown/update listener —
 * transforms automatically re-run whenever the root's children actually
 * change (any insert/delete), which is exactly the condition that can
 * shrink the count below the minimum. `registerNodeTransform` also marks
 * every existing node of that type dirty the moment it's registered
 * (confirmed directly in Lexical's own source, not assumed), so this
 * pads on initial load too, without needing a separate "seed" code path.
 */

import { useEffect } from "react";
import { $createParagraphNode, RootNode } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

export const DEFAULT_MIN_EDITOR_ROWS = 4;

/** Exported so `components/OxEditor.tsx` can compute the SAME clamped
 * value for `.ox-editing-surface`'s inline `--ox-min-rows` custom
 * property (`oxmarkdown.css`) — the visual `min-height` and this
 * plugin's actual padding behavior would otherwise be free to disagree. */
export function normalizeMinRows(minRows: number): number {
  return minRows < 0 ? 1 : minRows;
}

export default function MinRowsPlugin({
  minRows = DEFAULT_MIN_EDITOR_ROWS,
}: {
  minRows?: number;
}): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const target = normalizeMinRows(minRows);
    return editor.registerNodeTransform(RootNode, (root) => {
      const size = root.getChildrenSize();
      for (let i = size; i < target; i++) root.append($createParagraphNode());
    });
  }, [editor, minRows]);

  return null;
}
