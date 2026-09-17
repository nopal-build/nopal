/**
 * TRIMMED duplicate of fruits/app/oxmarkdown/fileDirective.ts -- only the
 * two type exports `OxRenderer.tsx` actually needs (`import type`, erased
 * at compile time), not the real `::file{...}` insertion logic, which is
 * Lexical-editor-only (OxEditor territory, not OxRenderer) and would pull
 * a `lexical` dependency into webapp for zero runtime benefit -- marketing
 * pages only ever render, never edit. See
 * webapp/app/components/OxRenderer.tsx's own comment for why this whole
 * directory is duplicated in the first place. Not shared; keep both in
 * sync by hand if these types change shape.
 */

/** What a real upload resolves to — enough to render a real thumbnail
 * (`fileId`, via `/api/vault/view/:fileId`) and decide whether it's even
 * an image worth previewing (`contentType`). */
export interface UploadedFileInfo {
  fileId: string;
  contentType: string;
}

/** Supplied by whichever route owns real vault storage. Omit entirely for
 * a browser-only preview with no server persistence. */
export type UploadFileFn = (file: File) => Promise<UploadedFileInfo>;
