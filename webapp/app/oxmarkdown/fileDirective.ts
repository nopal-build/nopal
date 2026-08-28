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
 * `::file{name="..."}` is deliberately just a leaf directive (own row, no
 * children) — the same "mount point, not nested markdown" shape already
 * planned for `::card{file=...}` (see the `oxmarkdown` skill) — its
 * caption lives in its OWN `caption` attribute rather than a second file,
 * since a caption is short enough not to need one.
 *
 * The directive is inserted immediately (optimistically, `name` only) so
 * the row appears without waiting on a round trip; if the caller passes
 * `onUploadFile` (see `UploadFileFn` below), each picked file is then
 * uploaded in the background and the resulting `fileId`/`contentType` are
 * written onto the SAME node once it resolves — found again by KEY, not
 * by holding onto the original node reference, since real time (a
 * network request) passes between insertion and completion. If a upload
 * fails, the node is marked with `uploadError="1"` instead (see
 * `OxRenderer.tsx`'s `FileDirectiveLayout`) rather than silently leaving
 * it stuck looking like it's still uploading forever. Callers that don't
 * pass `onUploadFile` at all (e.g. a pure visual mockup with no real
 * vault behind it) get the old browser-only behavior: the row shows up
 * with just its filename, no bytes ever leave the browser.
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
import { $createOxDirectiveNode, $isOxDirectiveNode } from "./editingNodes";
import { getFileCaptionMember } from "./fileCaptionFlow";
import { getTopLevelBlock } from "./SlashCommandPlugin";

/** What a real upload resolves to — enough to render a real thumbnail
 * (`fileId`, via `/api/vault/view/:fileId`) and decide whether it's even
 * an image worth previewing (`contentType`). */
export interface UploadedFileInfo {
  fileId: string;
  contentType: string;
}

/** Supplied by whichever route owns real vault storage (e.g. the Daily
 * Log route uploads into that day's vault folder) — `OxEditor` itself
 * stays ignorant of vault/folder specifics; it only knows how to call
 * this and what to do with the result. Omit entirely for a browser-only
 * preview with no server persistence (the visual mockup route does
 * this today). */
export type UploadFileFn = (file: File) => Promise<UploadedFileInfo>;

function createFileDirectiveNode(file: File) {
  return $createOxDirectiveNode({
    type: "leafDirective",
    name: "file",
    attributes: { name: file.name },
    children: [],
  });
}

/** Kicks off `onUploadFile` for each freshly-inserted node and writes the
 * result back onto that SAME node once it resolves — looked up again by
 * KEY (not held as a direct reference), since a real network request
 * happens between insertion and completion, and a document mutation
 * elsewhere in the meantime would invalidate a stale node reference. */
function uploadAndAttach(
  editor: LexicalEditor,
  entries: { file: File; nodeKey: string }[],
  onUploadFile: UploadFileFn,
): void {
  for (const { file, nodeKey } of entries) {
    onUploadFile(file).then(
      ({ fileId, contentType }) => {
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if ($isOxDirectiveNode(node)) {
            node.setAttribute("fileId", fileId);
            node.setAttribute("contentType", contentType);
          }
        });
      },
      (err) => {
        console.error("File upload failed:", err);
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if ($isOxDirectiveNode(node)) node.setAttribute("uploadError", "1");
        });
      },
    );
  }
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
export function pickFilesAndAppend(editor: LexicalEditor, onUploadFile?: UploadFileFn): void {
  pickFiles((files) => {
    let firstKey: string | null = null;
    const entries: { file: File; nodeKey: string }[] = [];
    editor.update(() => {
      const root = $getRoot();
      for (const file of files) {
        const directive = createFileDirectiveNode(file);
        root.append(directive);
        entries.push({ file, nodeKey: directive.getKey() });
        if (firstKey === null) firstKey = directive.getKey();
      }
    });
    if (firstKey) focusFileCaptionOnceMounted(editor, firstKey);
    if (onUploadFile) uploadAndAttach(editor, entries, onUploadFile);
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
export function pickFilesAndInsertAtBlock(
  editor: LexicalEditor,
  textNodeKey: string,
  onUploadFile?: UploadFileFn,
): void {
  const textNode = $getNodeByKey(textNodeKey);
  if (!$isTextNode(textNode)) return;
  const block = getTopLevelBlock(textNode);
  if (!block) return;
  textNode.setTextContent("");
  const capturedBlockKey = block.getKey();

  pickFiles((files) => {
    let firstKey: string | null = null;
    const entries: { file: File; nodeKey: string }[] = [];
    editor.update(() => {
      const block = $getNodeByKey(capturedBlockKey);
      if (!$isElementNode(block)) return;
      let cursor: LexicalNode = block;
      for (const file of files) {
        const directive = createFileDirectiveNode(file);
        cursor.insertAfter(directive);
        cursor = directive;
        entries.push({ file, nodeKey: directive.getKey() });
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
    if (onUploadFile) uploadAndAttach(editor, entries, onUploadFile);
  });
}
