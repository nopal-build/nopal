/**
 * Clears this editor's OWN recorded selection whenever native focus moves
 * from this editor's root into a DOM DESCENDANT of that root belonging to
 * a DIFFERENT Lexical instance — which, in practice, only ever means a
 * nested `<OxEditor>` mounted inside one of this editor's own decorators
 * (a `::file{...}` caption, a `::card{...}`'s content). Mounted
 * unconditionally on every Editing-mode `OxEditor`, alongside
 * `InteractablesPlugin`/`MinRowsPlugin`.
 *
 * Generalizes a fix `FileDirectiveArrowPlugin.tsx`/`FileCaptionArrowPlugin.tsx`
 * (and their Card equivalents, `CardDirectiveArrowPlugin.tsx`/
 * `CardEditorArrowPlugin.tsx`) already apply for their OWN specific
 * keyboard-driven handoffs (ArrowUp/Down, Backspace, Enter): each clears
 * ITS OWN selection with `$setSelection(null)` right before programmatically
 * focusing the other side. Confirmed by direct testing (see those files'
 * headers) that without this, the very next keystroke typed into whichever
 * editor just gained focus bounces straight back — that editor's own
 * `onChange` round-trips into an update on the OTHER (stale-selection-
 * holding) editor, whose reconciliation re-asserts its now-wrong selection
 * into the DOM, stealing focus back, since the two editors' root elements
 * are DOM ancestor/descendant, not siblings.
 *
 * That existing fix only covers focus changes routed through those
 * specific plugins. A plain MOUSE CLICK directly into a caption/card — by
 * far the most common way to get there once a document has more than one
 * file/card, since you're clicking around between them rather than
 * arrowing sequentially through — never goes through any of them, so the
 * outer editor's selection is never cleared and the exact same bounce-back
 * reproduces on the very first keystroke typed anywhere in ANY nested
 * editor. This plugin closes that gap generically, for any focus handoff
 * to a nested editor however it happened, instead of needing every future
 * nested-editor entry point (mouse, future keyboard shortcuts, ...) to
 * remember to clear selection by hand.
 *
 * Deliberately checks `document.activeElement` a frame AFTER `BLUR_COMMAND`
 * fires, rather than trusting the blur `FocusEvent`'s own `relatedTarget` —
 * `relatedTarget` support for plain `focus`/`blur` (as opposed to
 * `focusin`/`focusout`) has historically been inconsistent across engines,
 * and this codebase already leans on the same "poll a frame later" pattern
 * elsewhere (`fileDirective.ts`'s `focusFileCaptionOnceMounted`) for
 * similar reasons — by the next frame, the browser's own focus handoff has
 * fully settled, so `document.activeElement` is unambiguous.
 */

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $setSelection, BLUR_COMMAND, COMMAND_PRIORITY_LOW } from "lexical";

export default function NestedEditorBlurPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      BLUR_COMMAND,
      () => {
        const root = editor.getRootElement();
        if (!root) return false;
        requestAnimationFrame(() => {
          const active = document.activeElement;
          // Only clear when focus landed INSIDE this editor's own root
          // (a nested editor inside one of this editor's own decorators)
          // — losing focus entirely (clicking outside the page, a
          // popover, another sibling editor entirely) should leave this
          // editor's selection alone, matching Lexical's own default
          // behavior for those cases.
          if (active && active !== root && root.contains(active)) {
            editor.update(() => $setSelection(null));
          }
        });
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  return null;
}
