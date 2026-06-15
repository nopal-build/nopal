/**
 * MdxEditorWorkable — markdown display with task interactivity and file management.
 *
 * Main content (headings, paragraphs, blockquotes, code, links) is read-only.
 * Tasks (checklist items) are fully interactive: toggle, edit text, add, remove.
 * Unplaced files can be added or removed via the References section.
 * CSV value chips are editable if onCsvFieldChange is provided.
 *
 * Visually identical to MdxEditorEditable.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  parseNopalDocument,
  parseNopalUserContent,
  buildUserContent,
  serializeDocument,
  type NopalFileEntry,
  type NopalImagePlacement,
} from '../util/nopalMarkdown'
import MdxRenderer from './MdxRenderer'

interface MdxEditorWorkableProps {
  markdown: string
  onChange: (md: string) => void
  uploadFile?: (file: File) => Promise<string>
  csvFields?: Record<string, string>
  onCsvFieldChange?: (key: string, value: string) => void
}

interface WorkableFile {
  index: number
  url: string | null
  name: string
  isImage: boolean
  status: 'uploading' | 'ready'
}

const IMAGE_MIME = /^image\//i
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|ico)(\?.*)?$/i

export default function MdxEditorWorkable({
  markdown,
  onChange,
  uploadFile,
  csvFields,
  onCsvFieldChange,
}: MdxEditorWorkableProps) {
  const [initialState] = useState(() => {
    const { userContent, files } = parseNopalDocument(markdown)
    const { editorText, placements } = parseNopalUserContent(userContent)
    const nextIndex =
      files.length > 0 ? Math.max(...files.map((f) => f.index)) + 1 : 1
    const workableFiles: WorkableFile[] = files.map((f) => ({
      ...f,
      status: 'ready' as const,
    }))
    return { editorText, placements, files: workableFiles, nextIndex }
  })

  const [files, setFiles] = useState<WorkableFile[]>(initialState.files)
  const [editorText, setEditorText] = useState(initialState.editorText)
  const [placements] = useState<NopalImagePlacement[]>(initialState.placements)
  const nextIndexRef = useRef(initialState.nextIndex)

  // ── Emit changes to parent ─────────────────────────────────────────────────

  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    const userContent = buildUserContent(editorText, placements)
    onChange(
      serializeDocument(
        userContent,
        files.filter((f) => f.status === 'ready'),
      ),
    )
  }, [editorText, files]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── File management ────────────────────────────────────────────────────────

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleAddFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = Array.from(e.target.files ?? [])
      e.target.value = ''
      if (!list.length || !uploadFile) return

      const startIdx = nextIndexRef.current
      nextIndexRef.current += list.length

      // Add uploading placeholders
      const placeholders: WorkableFile[] = list.map((file, i) => ({
        index: startIdx + i,
        url: null,
        name: `Uploading ${file.name}…`,
        isImage: IMAGE_MIME.test(file.type) || IMAGE_EXT.test(file.name),
        status: 'uploading' as const,
      }))
      setFiles((prev) => [...prev, ...placeholders])

      // Upload each file concurrently
      await Promise.all(
        list.map(async (file, i) => {
          try {
            const url = await uploadFile(file)
            setFiles((prev) =>
              prev.map((f) =>
                f.index === startIdx + i
                  ? { ...f, url, name: file.name, status: 'ready' as const }
                  : f,
              ),
            )
          } catch (err) {
            console.error('Upload error:', err)
            // Remove failed placeholder
            setFiles((prev) => prev.filter((f) => f.index !== startIdx + i))
          }
        }),
      )
    },
    [uploadFile],
  )

  const handleRemoveFile = useCallback((fileIndex: number) => {
    setFiles((prev) => prev.filter((f) => f.index !== fileIndex))
  }, [])

  // ── Editor text change ─────────────────────────────────────────────────────

  const handleEditorTextChange = useCallback((newText: string) => {
    setEditorText(newText)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  // Convert WorkableFile[] to NopalFileEntry[] for the renderer (omit status)
  const rendererFiles: NopalFileEntry[] = files
    .filter((f) => f.status === 'ready')
    .map(({ index, url, name, isImage }) => ({ index, url, name, isImage }))

  return (
    <div>
      <MdxRenderer
        editorText={editorText}
        files={rendererFiles}
        placements={placements}
        onChange={handleEditorTextChange}
        csvFields={csvFields}
        onCsvFieldChange={onCsvFieldChange}
        canManageFiles={!!uploadFile}
        onAddFile={handleAddFile}
        onRemoveFile={handleRemoveFile}
      />
      {uploadFile && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
      )}
    </div>
  )
}
