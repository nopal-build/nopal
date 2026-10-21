// The deliverable editor's picture picker: the project's own photos, the
// ones already documented on the daily logs (Austin, 2026-10-21: building
// a deliverable here should draw on what's been uploaded), with upload
// from the computer as the second option. Picking one puts a standard
// markdown image in the text, pointing at the project's copy, which is
// the form the public page serves. Rendered inside the Markdown pane of
// `MarkdownSplitEditor` (`vault.tsx`); the rows come from
// `/api/projects/:folderId/photos`.
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import "../styles/vault.css";

export type ProjectPhoto = { id: string; name: string; caption: string; date: string; thumb: string; display: string };

/** The markdown a picked photo becomes: its caption as the alt text when
 * the log gave it one, else its name without the extension. */
export function pictureMarkdown(photo: Pick<ProjectPhoto, "id" | "name" | "caption">): string {
  const alt = (photo.caption || photo.name.replace(/\.[^.]+$/, "")).replace(/[\[\]]/g, "");
  return `![${alt}](/api/vault/view/${photo.id})`;
}

export function ProjectPhotoPicker({
  photos,
  loading,
  error,
  onPick,
  onUpload,
  onClose,
}: {
  photos: ProjectPhoto[];
  loading: boolean;
  error: string | null;
  /** The markdown to put at the cursor. */
  onPick: (markdown: string) => void;
  /** Opens the file picker for a picture from the computer. */
  onUpload: () => void;
  onClose: () => void;
}) {
  return (
    <section className={sprinkles({ display: "flex", flexDirection: "column", gap: 3 })} aria-label="Add a picture" data-photo-picker style={{ padding: "10px 14px", borderBottom: "1px solid var(--foreground)" }}>
      <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3 })}>
        <span className={textSize.sm}>From the project's photos</span>
        <button type="button" className="vault-toolbar-btn" onClick={onUpload}>
          Upload from your computer
        </button>
        <button type="button" className="vault-toolbar-btn" onClick={onClose} aria-label="Close the picture picker">
          Close
        </button>
      </div>
      {error ? (
        <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textDanger }} role="alert">
          {error}
        </p>
      ) : loading ? (
        <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textSubtle }}>
          Looking through the project's photos…
        </p>
      ) : photos.length === 0 ? (
        <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textSubtle }}>
          No photos on this project yet. Upload one from your computer.
        </p>
      ) : (
        <div className="vault-gallery-grid" style={{ maxHeight: 280, overflowY: "auto" }}>
          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              className="vault-gallery-item"
              onClick={() => onPick(pictureMarkdown(photo))}
              style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }}
              aria-label={`Add ${photo.caption || photo.name}`}
              data-photo={photo.id}
            >
              <img src={photo.thumb} alt={photo.caption || photo.name} loading="lazy" style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 4 }} />
              <span className="vault-gallery-item-name">{photo.caption || photo.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
