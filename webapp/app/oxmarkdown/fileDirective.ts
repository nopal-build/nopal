/**
 * Shared insertion logic for the `::file{...}` interactable — the file
 * picker itself, plus the two ways a picked batch of files can land in
 * the document: at the current cursor (the `/files` slash command) or
 * always at the very end (the persistent "add file" link below the
 * editor, `AddFileLinkPlugin.tsx`). Pure Lexical-tree logic, no React —
 * mirrors `SlashCommandPlugin.tsx`'s own `runOnBlock`-style helpers, just
 * split across two separate `editor.update()` calls instead of one,
 * because opening a native file dialog is asynchronous (the user can take
 * any amount of time, or cancel) — a Lexical node REFERENCE can't safely
 * cross that gap, so the block is looked up again by KEY once files are
 * actually picked.
 *
 * No server upload happens here — see the `vault` skill / the daily-log
 * handoff notes: real file storage into the vault is a tracked, separate
 * gap. This only ever writes each file's own `name` into the directive;
 * the bytes never leave the browser. `::file{name="..."}` is deliberately
 * just a leaf directive (own row, no children) — the same "mount point,
 * not nested markdown" shape already planned for `::card{file=...}` (see
 * the `oxmarkdown` skill) — its caption lives in its OWN `caption`
 * attribute rather than a second file, since a caption is short enough
 * not to need one.
 *
 * After inserting, the FIRST newly-added file's caption editor gets
 * focus (`focusFileCaptionOnceMounted`) — so a human can start typing a
 * caption immediately instead of needing an extra click.
 */

import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { $createOxDirectiveNode } from "./editingNodes";
import { getFileCaptionMember } from "./fileCaptionFlow";
import { getTopLevelBlock } from "./SlashCommandPlugin";

function createFileDirectiveNode(file: File) {
  return $createOxDirectiveNode({
    type: "leafDirective",
    name: "file",
    attributes: { name: file.name },
    children: [],
  });
}

/** Focuses a just-inserted file directive's caption editor — but that
 * caption's `<OxEditor>` (and its `FileCaptionArrowPlugin` registration)
 * hasn't necessarily MOUNTED yet the instant `editor.update()` returns:
 * Lexical's own DOM reconciliation and React's rendering of the new
 * decorator's content are two separate, only loosely-synchronized steps.
 * Polling across a few animation frames (bounded, so a genuine failure
 * can't spin forever) is the simplest reliable way to wait for that
 * cross-framework gap to close, confirmed directly to work rather than
 * assumed to be unnecessary. */
function focusFileCaptionOnceMounted(
  outerEditor: LexicalEditor,
  nodeKey: string,
  attemptsLeft = 30,
): void {
  const member = getFileCaptionMember(outerEditor, nodeKey);
  if (member) {
    member.focusStart();
    return;
  }
  if (attemptsLeft <= 0) return;
  requestAnimationFrame(() => focusFileCaptionOnceMounted(outerEditor, nodeKey, attemptsLeft - 1));
}

/** Opens the browser's native multi-file picker. `onPicked` runs only if
 * at least one file was actually chosen — canceling the dialog is a
 * no-op, not an empty insert. */
function pickFiles(onPicked: (files: File[]) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.style.display = "none";
  document.body.appendChild(input);

  function cleanup() {
    if (input.parentNode) document.body.removeChild(input);
  }

  input.addEventListener(
    "change",
    () => {
      const files = input.files ? Array.from(input.files) : [];
      cleanup();
      if (files.length > 0) onPicked(files);
    },
    { once: true },
  );
  // Not universally supported on older browsers — harmless where it isn't
  // (the input is just left for the next GC-equivalent DOM cleanup pass
  // instead of removed immediately on cancel).
  input.addEventListener("cancel", cleanup, { once: true });
  input.click();
}

/** Always appends at the END of the document, regardless of the current
 * selection — used by the persistent "add file" link, which is
 * deliberately position-independent (see that file's header). */
export function pickFilesAndAppend(editor: LexicalEditor): void {
  pickFiles((files) => {
    let firstKey: string | null = null;
    editor.update(() => {
      const root = $getRoot();
      for (const file of files) {
        const directive = createFileDirectiveNode(file);
        root.append(directive);
        if (firstKey === null) firstKey = directive.getKey();
      }
    });
    if (firstKey) focusFileCaptionOnceMounted(editor, firstKey);
  });
}

/** The `/files` slash command's version: clears the trigger text/block
 * (same convention as every other slash command) and inserts the
 * directives right there — one per file, each on its own row — followed
 * by a fresh paragraph to continue typing in, matching `runOnBlock`'s
 * shape exactly (just spread across two updates instead of one).
 *
 * MUST be called from within an already-active `editor.update()` —
 * exactly how `SlashCommandPlugin.tsx`'s `runCommand` already invokes
 * every command's `run`. The clearing/key-capture step below deliberately
 * does NOT wrap itself in its own `editor.update()`: confirmed directly
 * in Lexical's own source, a nested `update()` call (one made while
 * `editor._updating` is already true) doesn't run its function
 * immediately, it QUEUES it for after the current update finishes — which
 * would leave the block's key still uncaptured by the time this function
 * needs it. Calling the `$`-prefixed functions directly relies on
 * already being inside the CALLER's active update instead. */
export function pickFilesAndInsertAtBlock(editor: LexicalEditor, textNodeKey: string): void {
  const textNode = $getNodeByKey(textNodeKey);
  if (!$isTextNode(textNode)) return;
  const block = getTopLevelBlock(textNode);
  if (!block) return;
  textNode.setTextContent("");
  const capturedBlockKey = block.getKey();

  pickFiles((files) => {
    let firstKey: string | null = null;
    editor.update(() => {
      const block = $getNodeByKey(capturedBlockKey);
      if (!$isElementNode(block)) return;
      let cursor: LexicalNode = block;
      for (const file of files) {
        const directive = createFileDirectiveNode(file);
        cursor.insertAfter(directive);
        cursor = directive;
        if (firstKey === null) firstKey = directive.getKey();
      }
      const following = $createParagraphNode();
      cursor.insertAfter(following);
      following.select();
      if (block.getTextContent() === "") block.remove();
    });
    // Wins out over the `following.select()` above once it actually
    // focuses (it's delayed via rAF polling, so it naturally runs AFTER
    // that immediate, synchronous selection) — exactly the desired
    // result: land in the new file's caption, not the outer editor.
    if (firstKey) focusFileCaptionOnceMounted(editor, firstKey);
  });
}
