/**
 * MdxEditorView — static, non-interactive markdown display.
 *
 * Parses the raw nopal markdown, then delegates all rendering to MdxRenderer.
 * No Lexical, no editor overhead. Visually identical to MdxEditorEditable.
 */

import { useMemo } from 'react'
import {
  parseNopalDocument,
  parseNopalUserContent,
} from '../util/nopalMarkdown'
import MdxRenderer from './MdxRenderer'

interface MdxEditorViewProps {
  markdown: string
  csvFields?: Record<string, string>
  className?: string
}

export default function MdxEditorView({
  markdown,
  csvFields,
  className,
}: MdxEditorViewProps) {
  const { editorText, files, placements } = useMemo(() => {
    const { userContent, files } = parseNopalDocument(markdown)
    const { editorText, placements } = parseNopalUserContent(userContent)
    return { editorText, files, placements }
  }, [markdown])

  return (
    <MdxRenderer
      editorText={editorText}
      files={files}
      placements={placements}
      csvFields={csvFields}
      className={className}
    />
  )
}
