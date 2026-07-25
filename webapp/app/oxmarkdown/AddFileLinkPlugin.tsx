/**
 * The persistent "add file" trigger — always its own line below the
 * editor (rendered as a sibling AFTER `RichTextPlugin`'s wrapper, inside
 * the same `<LexicalComposer>` so it can reach `editor`), a second way to
 * reach the exact same action the `/files` slash command triggers (see
 * `oxmarkdown/fileDirective.ts`) — always appends at the END of the
 * document, regardless of where the caret currently is.
 *
 * Styled as a themed link (accent color + underline via `--ox-color-*`
 * tokens, `oxmarkdown.css`), but a real `<button>`, not an `<a href="#">`
 * — it triggers an action, not navigation, so a button is the correct
 * element even though it LOOKS like a link.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { pickFilesAndAppend } from "./fileDirective";

/** The exact SVG the design gave, with one adaptation: `stroke="currentColor"`
 * instead of the original hardcoded `#7F5B8B` (which is `--purple-light`'s
 * own light-mode hex value) — so the icon re-colors along with the
 * surrounding text in dark mode instead of needing a second, hand-kept-
 * in-sync dark variant. */
function AddFileIcon() {
  return (
    <svg width="13" height="26" viewBox="0 0 13 26" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4.49961 4.21338L4.49961 18.4803C4.49961 19.4744 5.3055 20.2803 6.29961 20.2803C7.29372 20.2803 8.09961 19.4744 8.09961 18.4803L8.09961 4.55C8.09961 2.58939 6.51022 0.999999 4.54961 0.999999C2.589 0.999999 0.999608 2.58939 0.999608 4.55L0.999609 19.7C0.99961 22.6271 3.3725 25 6.29961 25C9.22672 25 11.5996 22.6271 11.5996 19.7L11.5996 8.21338"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

export default function AddFileLinkPlugin() {
  const [editor] = useLexicalComposerContext();
  return (
    <button
      type="button"
      className="ox-add-file-link"
      onClick={() => pickFilesAndAppend(editor)}
    >
      <AddFileIcon />
      add file
    </button>
  );
}
