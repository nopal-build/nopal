// app/components/LetterSplitEditor.tsx
// Lifted out of `routes/vault.tsx` unchanged (2026-11-06; Austin: "The
// whole letters workflow shouldn't go to the vault, it should feel like
// you are still in the project, at the desk and writing a letter"). It
// is mounted by `LetterWriting`, at the desk and in the Vault's back room.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { WebsitePageContent } from "stamps/WebsitePageContent";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";
import OxRenderer from "./OxRenderer";
import { rewriteViewUrls } from "robustness-core/data/publicBody";
import { LetterRecorder } from "./LetterRecorder";
import { setLeadingRecording } from "./letterRecording";
import { MarkdownSplitEditor } from "./MarkdownSplitEditor";
import { ProjectPhotoPicker, type ProjectPhoto } from "./ProjectPhotoPicker";

// ─── Letter editor ──────────────────────────────────────────────────
// A letter is a website page that lives in a project (Austin,
// 2026-10-21; `letters.server.ts`): the same `MarkdownSplitEditor`
// as a website page, previewing through the website directive registry
// inside `WebsitePageContent`, which is exactly what the public
// letter page renders (`public.letter.$fileId.tsx`). No publish
// toggle: sharing is the switch on the project's Letters tab. A
// picture dropped, pasted or picked uploads beside the file
// (`/api/vault/upload` into its folder) and lands in the text as a
// standard markdown image pointing at the vault, the one form the public
// page serves.
export function LetterSplitEditor({
  fileId,
  folderId,
  projectFolderId,
  initialContent,
  editable,
  onSave,
  headerLeft,
  toolbarRight,
  purpose,
  recordable = false,
}: {
  fileId: string;
  folderId: string | null;
  /** The project the letter belongs to: where "Add picture" looks
   * first (`/api/projects/:id/photos`, the Photos tab's own rows). */
  projectFolderId: string | null;
  initialContent: string;
  editable: boolean;
  onSave: (fileId: string, content: string) => Promise<unknown>;
  headerLeft?: ReactNode;
  toolbarRight?: ReactNode;
  /** What the letter is for, in the guide's words (`FileRef.purpose`):
   * read under the header while writing, since the chain (purpose,
   * brief, talk-through, outline, letter) lives on this page. */
  purpose?: string | null;
  /** "Read it to them" in the toolbar: guides only, on a letter they can
   * edit (`LetterRecorder`). */
  recordable?: boolean;
}) {
  // The project's photos, fetched the first time the picker opens.
  const [photos, setPhotos] = useState<ProjectPhoto[] | null>(null);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const loadPhotos = useCallback(async () => {
    if (!projectFolderId) {
      setPhotosError("This file isn't inside a project");
      return;
    }
    try {
      const res = await fetch(`/api/projects/${projectFolderId}/photos`);
      const data = (await res.json().catch(() => null)) as { photos?: ProjectPhoto[]; error?: string } | null;
      if (!res.ok || !data?.photos) throw new Error(data?.error ?? "The project's photos didn't load. Try again.");
      setPhotos(data.photos);
      setPhotosError(null);
    } catch (err) {
      setPhotosError(err instanceof Error ? err.message : "The project's photos didn't load. Try again.");
    }
  }, [projectFolderId]);

  const insertPictures = useCallback(
    async (files: File[]): Promise<string[]> => {
      if (!folderId) throw new Error("This file has no folder to keep a picture in");
      const out: string[] = [];
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        form.append("folderId", folderId);
        // The letter this is for: a client's door into the Letters
        // folder (`canUploadToFolder`); a guide passes anyway.
        form.append("letterFileId", fileId);
        const res = await fetch("/api/vault/upload", { method: "POST", body: form });
        const data = (await res.json().catch(() => null)) as { fileRef?: { _id: string }; error?: string } | null;
        if (!res.ok || !data?.fileRef?._id) throw new Error(data?.error ?? `${file.name} didn't upload. Try again.`);
        const alt = file.name.replace(/\.[^.]+$/, "");
        out.push(`![${alt}](/api/vault/view/${data.fileRef._id})`);
      }
      return out;
    },
    [folderId, fileId],
  );

  // Simpler than the website editor on purpose (Austin, 2026-10-21): the
  // same design language, fewer ways to go wrong. No scratch pad link;
  // which directives a letter gets, against what stays website-only,
  // is a later, deliberate pass. Light/Dark stays: the public link follows
  // the reader's scheme, only the PDF is pinned to light.
  // The purpose line sits under the breadcrumb in the toolbar's left
  // slot, so the toolbar keeps its two sides and the sentence wraps on
  // its own line.
  const headerWithPurpose = purpose ? (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
      {headerLeft}
      <span className={textSize.sm} style={{ color: semanticColors.textSubtle }} data-letter-purpose>
        {purpose}
      </span>
    </div>
  ) : (
    headerLeft
  );

  return (
    <MarkdownSplitEditor
      fileId={fileId}
      initialContent={initialContent}
      editable={editable}
      onSave={onSave}
      headerLeft={headerWithPurpose}
      toolbarRight={toolbarRight}
      onInsertFiles={insertPictures}
      spellCheck
      autosave
      showLength
      renderPicturePicker={({ insert, upload, close }) => (
        <PhotoPickerLoader photos={photos} error={photosError} load={loadPhotos} insert={insert} upload={upload} close={close} />
      )}
      toolbarTools={
        recordable && editable && folderId
          ? ({ body, updateBody, previewElement, setReading }) => (
              <LetterRecorder
                letterFileId={fileId}
                folderId={folderId}
                body={body}
                previewElement={previewElement}
                setReading={setReading}
                onRecorded={(recordingFileId) => updateBody((prev) => setLeadingRecording(prev, recordingFileId))}
              />
            )
          : undefined
      }
      renderPreview={(body, previewScheme) => (
        <WebsitePageContent>
          {/* The preview draws the letter's files through the letter's
              own routes, as the sent page does (`publicLetterBody`), so
              it is what the page will be for everyone: the Vault's file
              routes refuse a client (ADR-023), the letter's serve its
              writer (`letterPageFile`). The stored text keeps
              `/api/vault/view/`; only what is drawn changes. */}
          <OxRenderer
            markdown={rewriteViewUrls(body, (id) => `/api/letter/${fileId}/view/${id}`)}
            directives={buildWebsiteDirectiveRegistry({ dailyLogEntries: {}, forcedScheme: previewScheme })}
            className="ox-no-dots ox-no-heading-marks website-page-ox"
          />
        </WebsitePageContent>
      )}
    />
  );
}

/** Fetches the project's photos when the picker panel mounts, then hands
 * them to `ProjectPhotoPicker`. */
function PhotoPickerLoader({
  photos,
  error,
  load,
  insert,
  upload,
  close,
}: {
  photos: ProjectPhoto[] | null;
  error: string | null;
  load: () => Promise<void>;
  insert: (markdown: string[]) => void;
  upload: () => void;
  close: () => void;
}) {
  useEffect(() => {
    if (photos === null && !error) void load();
  }, [photos, error, load]);
  return <ProjectPhotoPicker photos={photos ?? []} loading={photos === null && !error} error={error} onPick={(md) => insert([md])} onUpload={upload} onClose={close} />;
}
