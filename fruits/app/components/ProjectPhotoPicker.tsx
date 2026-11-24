// The letter editor's photo picker: the project's own photos, the
// ones already documented on the daily logs (Austin, 2026-10-21: building
// a letter here should draw on what's been uploaded), with upload
// from the computer as the second option. Picking one puts a standard
// markdown image in the text, pointing at the project's copy, which is
// the form the public page serves.
//
// It is a paper on the desk (Austin, 2026-11-24: "another floating piece
// over the preview"): `LetterSplitEditor` hands it to the `PaperPile` as
// the Photos sheet, so it is as wide as the Preview and as tall as the
// window, and the sheet does the scrolling and the way back. It stays up
// after a pick, so several go in one after another, and a photo already
// in the letter says so on its tile. The rows come from
// `/api/projects/:folderId/photos`.
import { Cluster } from "stamps/Cluster";
import { Grid } from "stamps/Grid";
import { Stack } from "stamps/Stack";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import "../styles/vault.css";

// Words a person reads.
export const PHOTO_IN_LETTER = "In the letter";

export type ProjectPhoto = { id: string; name: string; caption: string; date: string; thumb: string; display: string };

/** The markdown a picked photo becomes: its caption as the alt text when
 * the log gave it one, else its name without the extension. */
export function pictureMarkdown(photo: Pick<ProjectPhoto, "id" | "name" | "caption">): string {
  const alt = (photo.caption || photo.name.replace(/\.[^.]+$/, "")).replace(/[\[\]]/g, "");
  return `![${alt}](/api/vault/view/${photo.id})`;
}

/** Whether the letter's text already holds this photo: its address is
 * in the body. Pure. */
export function isPhotoInLetter(body: string, photoId: string): boolean {
  return body.includes(`/api/vault/view/${photoId})`);
}

export function ProjectPhotoPicker({
  photos,
  loading,
  error,
  body = "",
  onPick,
  onUpload,
}: {
  photos: ProjectPhoto[];
  loading: boolean;
  error: string | null;
  /** The letter's text as it stands, to mark the photos already in it. */
  body?: string;
  /** The markdown to put at the cursor. */
  onPick: (markdown: string) => void;
  /** Opens the file picker for a picture from the computer. */
  onUpload: () => void;
}) {
  return (
    <Stack gap={3} aria-label="Add photos" data-photo-picker>
      <Cluster gap={3} align="center">
        <span className={textSize.sm}>From the project's photos</span>
        <button type="button" className="vault-toolbar-btn" onClick={onUpload}>
          Upload from your computer
        </button>
      </Cluster>
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
        // `auto-fill`, not the Grid's own `auto-fit`: a project with two
        // photos keeps small tiles instead of two that fill the sheet.
        <Grid gap={3} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
          {photos.map((photo) => {
            const label = photo.caption || photo.name;
            const used = isPhotoInLetter(body, photo.id);
            return (
              <button
                key={photo.id}
                type="button"
                className="vault-gallery-item"
                onClick={() => onPick(pictureMarkdown(photo))}
                style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }}
                aria-label={used ? `Add ${label} again` : `Add ${label}`}
                title={label}
                data-photo={photo.id}
                data-in-letter={used ? "true" : undefined}
              >
                <img src={photo.thumb} alt={label} loading="lazy" style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 4, opacity: used ? 0.55 : 1 }} />
                <span className="vault-gallery-item-name">{used ? `${PHOTO_IN_LETTER} · ${label}` : label}</span>
              </button>
            );
          })}
        </Grid>
      )}
    </Stack>
  );
}
