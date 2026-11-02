/**
 * The record button under an editor (record-in-daily-log seed). Settled
 * words go into the document at the cursor the recording started from,
 * as ordinary text: they read the same as typed words and are edited the
 * same way. Words not settled yet show below the editor, greyed, never in
 * the document, so a save mid-sentence can never store a guess.
 *
 * Inserts happen inside `editor.update()`'s own callback, and the next
 * insertion point is read there too (Lexical's update is queued, not run
 * on the spot; the paste-image round learned that the hard way).
 */
import { useContext, useEffect, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createRangeSelection,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type LexicalEditor,
} from "lexical";
import { DictationContext, type DictationSession, type DictationTarget } from "./dictation";

type Point = { key: string; offset: number; type: "text" | "element" };

export default function DictateButtonPlugin({ target }: { target: DictationTarget }) {
  const start = useContext(DictationContext);
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<"idle" | "starting" | "recording" | "stopping">("idle");
  const [provisional, setProvisional] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const sessionRef = useRef<DictationSession | null>(null);
  const pointRef = useRef<Point | null>(null);

  // A recording outlives nothing: leaving the page stops it.
  useEffect(() => () => sessionRef.current?.stop(), []);

  if (!start) return null;

  const onClick = async () => {
    if (state === "recording") {
      setState("stopping");
      sessionRef.current?.stop();
      return;
    }
    if (state !== "idle") return;
    setNote(null);
    setState("starting");
    pointRef.current = readCursor(editor);
    try {
      sessionRef.current = await start(target, {
        onFinal: (text) => insertFinal(editor, pointRef, text),
        onProvisional: setProvisional,
        onEnd: (endNote) => {
          sessionRef.current = null;
          setState("idle");
          setNote(endNote);
        },
      });
      setState((s) => (s === "starting" ? "recording" : s));
    } catch (err) {
      setState("idle");
      setNote(err instanceof Error ? err.message : "Couldn't start recording.");
    }
  };

  const label =
    state === "recording" ? "stop" : state === "starting" ? "starting…" : state === "stopping" ? "finishing…" : "record";

  return (
    <div>
      <button
        type="button"
        className="ox-add-file-link"
        onClick={onClick}
        aria-pressed={state === "recording"}
        disabled={state === "starting" || state === "stopping"}
      >
        <MicIcon recording={state === "recording"} />
        {label}
      </button>
      {provisional && <div className="subtle-text">{provisional}</div>}
      {note && <div className="subtle-text">{note}</div>}
    </div>
  );
}

function MicIcon({ recording }: { recording: boolean }) {
  return (
    <svg width="13" height="26" viewBox="0 0 13 26" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="3.5" y="2" width="6" height="13" rx="3" stroke="currentColor" strokeWidth="2" fill={recording ? "currentColor" : "none"} />
      <path d="M1 12.5C1 15.5376 3.46243 18 6.5 18C9.53757 18 12 15.5376 12 12.5M6.5 18V23" stroke="currentColor" strokeWidth="2" />
    </svg>
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
 * Inserts `text` at the recording's point, then moves the point to just
 * after it. If the point is gone (the person deleted that paragraph) the
 * words go at the end of the entry instead, so nothing heard is dropped.
 * The person's own cursor is put back afterwards, so dictating doesn't
 * pull their caret away while they fix a word elsewhere.
 */
export function insertFinal(editor: LexicalEditor, pointRef: { current: Point | null }, text: string) {
  editor.update(
    () => {
      const before = $getSelection();
      const theirs = $isRangeSelection(before) ? before.clone() : null;

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

      sel.insertText(joinable(sel, text));

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

function fits(node: ReturnType<typeof $getNodeByKey>, offset: number): boolean {
  if (!node) return false;
  if ($isTextNode(node)) return offset <= node.getTextContentSize();
  if ($isElementNode(node)) return offset <= node.getChildrenSize();
  return false;
}

// The engine's words carry their own leading space. Drop it at the start
// of a line or after a space already there, and add one when the text
// before ends mid-word.
function joinable(sel: ReturnType<typeof $createRangeSelection>, text: string): string {
  const anchor = sel.anchor.getNode();
  const prev = $isTextNode(anchor) ? anchor.getTextContent().slice(0, sel.anchor.offset).slice(-1) : "";
  if (prev === "" || /\s/.test(prev)) return text.replace(/^\s+/, "");
  if (!/^\s/.test(text) && /^[\p{L}\p{N}]/u.test(text)) return ` ${text}`;
  return text;
}
