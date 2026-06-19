/**
 * MdxEditorView — static, non-interactive markdown display.
 *
 * Parses the raw nopal markdown, then delegates all rendering to MdxRenderer.
 * No Lexical, no editor overhead. Visually identical to MdxEditorEditable.
 */

import { useMemo } from "react";
import { importFromMarkdown } from "../util/nopalEditorState";
import MdxRenderer from "./MdxRenderer";

interface MdxEditorViewProps {
  markdown: string;
  csvFields?: Record<string, string>;
  className?: string;
}

export default function MdxEditorView({
  markdown,
  csvFields,
  className,
}: MdxEditorViewProps) {
  const editorState = useMemo(() => importFromMarkdown(markdown), [markdown]);

  return (
    <MdxRenderer
      state={editorState}
      csvFields={csvFields}
      className={className}
    />
  );
}
