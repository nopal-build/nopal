/**
 * The dictate button under a daily log editor (record-in-daily-log seed).
 * Settled words go into the document at the cursor dictation started
 * from, as ordinary text: they read the same as typed words and are
 * edited the same way. Words not settled yet show greyed right after
 * them, in the entry (Austin, 2026-11-02: no line under the button).
 * Those updates carry `PROVISIONAL_TAG`, which `OxEditor`'s markdown sync
 * skips, so the autosave doesn't store a guess; the next settled words
 * take them out again. The control itself is
 * `components/DictateButton.tsx`.
 *
 * Inserts happen inside `editor.update()`'s own callback, and the next
 * insertion point is read there too (Lexical's update is queued, not run
 * on the spot; the paste-image round learned that the hard way).
 */
import { useContext, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
} from "lexical";
import { DictationContext, joinWords, type DictationTarget } from "./dictation";
import { DictateButton } from "../components/DictateButton";

type Point = { key: string; offset: number; type: "text" | "element" };

/** Marks an update that only placed words not settled yet. */
export const PROVISIONAL_TAG = "dictation-provisional";
const PROVISIONAL_STYLE = "opacity: 0.5";

export default function DictateButtonPlugin({ target }: { target: DictationTarget }) {
  const start = useContext(DictationContext);
  const [editor] = useLexicalComposerContext();
  const pointRef = useRef<Point | null>(null);
  const provisionalRef = useRef<string | null>(null);
  if (!start) return null;
  return (
    <DictateButton
      start={start}
      target={target}
      onBegin={() => (pointRef.current = readCursor(editor))}
      onFinal={(text) => insertFinal(editor, pointRef, text, provisionalRef)}
      onProvisional={(text) => showProvisional(editor, pointRef, provisionalRef, text)}
    />
  );
}

/** Where the cursor is in this editor right now, or null if it isn't. */
function readCursor(editor: LexicalEditor): Point | null {
  return editor.getEditorState().read(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return null;
    const { key, offset, type } = sel.focus;
    return { key, offset, type };
  });
}

/**
 * Inserts `text` at dictation's point, then moves the point to just
 * after it. If the point is gone (the person deleted that paragraph) the
 * words go at the end of the entry instead, so nothing heard is dropped.
 * The person's own cursor is put back afterwards, so dictating doesn't
 * pull their caret away while they fix a word elsewhere.
 */
export function insertFinal(
  editor: LexicalEditor,
  pointRef: { current: Point | null },
  text: string,
  provisionalRef: { current: string | null } = { current: null },
) {
  editor.update(
    () => {
      $removeProvisional(provisionalRef);
      const before = $getSelection();
      const theirs = $isRangeSelection(before) ? before.clone() : null;

      const sel = $selectionAtPoint(pointRef);
      const anchor = sel.anchor.getNode();
      const prevChar = $isTextNode(anchor) ? anchor.getTextContent().slice(0, sel.anchor.offset).slice(-1) : "";
      sel.insertText(joinWords(prevChar, text));

      const after = $getSelection();
      if ($isRangeSelection(after)) {
        const { key, offset, type } = after.focus;
        pointRef.current = { key, offset, type };
      }
      $setSelection(theirs);
    },
    { tag: "dictation" },
  );
}

/**
 * Shows words not settled yet, greyed, just after the settled ones,
 * leaving the point where it was so the next settled words go in ahead
 * of them. Empty text just takes the old ones out; that update is saved
 * normally, so the entry's last save never holds a guess.
 */
export function showProvisional(
  editor: LexicalEditor,
  pointRef: { current: Point | null },
  provisionalRef: { current: string | null },
  text: string,
) {
  if (!text && !provisionalRef.current) return;
  editor.update(
    () => {
      $removeProvisional(provisionalRef);
      if (!text) return;
      const before = $getSelection();
      const theirs = $isRangeSelection(before) ? before.clone() : null;
      const sel = $selectionAtPoint(pointRef);
      const anchor = sel.anchor.getNode();
      const prevChar = $isTextNode(anchor) ? anchor.getTextContent().slice(0, sel.anchor.offset).slice(-1) : "";
      const node = $createTextNode(joinWords(prevChar, text)).setStyle(PROVISIONAL_STYLE);
      sel.insertNodes([node]);
      provisionalRef.current = node.getKey();
      $setSelection(theirs);
    },
    { tag: text ? [PROVISIONAL_TAG, HISTORY_MERGE_TAG] : [HISTORY_MERGE_TAG] },
  );
}

function $removeProvisional(provisionalRef: { current: string | null }) {
  const key = provisionalRef.current;
  provisionalRef.current = null;
  const node = key ? $getNodeByKey(key) : null;
  if (node && node.isAttached()) node.remove();
}

/** A collapsed selection at dictation's point, or at the end of the entry
 * when the point is gone. */
function $selectionAtPoint(pointRef: { current: Point | null }) {
  const sel = $createRangeSelection();
  const p = pointRef.current;
  const node = p ? $getNodeByKey(p.key) : null;
  if (p && node && node.isAttached() && fits(node, p.offset)) {
    sel.anchor.set(p.key, p.offset, p.type);
    sel.focus.set(p.key, p.offset, p.type);
  } else {
    const root = $getRoot();
    let last = root.getLastChild();
    if (!$isElementNode(last) || last.isInline() || last.getType() !== "paragraph") {
      last = $createParagraphNode();
      root.append(last);
    }
    const end = last.selectEnd();
    sel.anchor.set(end.anchor.key, end.anchor.offset, end.anchor.type);
    sel.focus.set(end.anchor.key, end.anchor.offset, end.anchor.type);
  }
  $setSelection(sel);
  return sel;
}

function fits(node: ReturnType<typeof $getNodeByKey>, offset: number): boolean {
  if (!node) return false;
  if ($isTextNode(node)) return offset <= node.getTextContentSize();
  if ($isElementNode(node)) return offset <= node.getChildrenSize();
  return false;
}
