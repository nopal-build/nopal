import type { LoaderFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import {
  getFileRefById,
  getFolderById,
  isFolderUnderSyncs,
  listFolderChildren,
} from "robustness-core/data/vault.server";
import { getPresignedDownloadUrl } from "robustness-core/data/file.server";

/**
 * GET /api/vault/folders/:folderId/download-manifest
 *
 * Everything a client needs to trigger a "download every file in this
 * folder" batch — one call instead of N round trips, one per file (see
 * `fruits_.vault.tsx`'s `handleDownloadAll`). DIRECT child files only —
 * a file inside a nested sub-folder is NOT included. This deliberately
 * isn't a zip: each entry becomes its own separate, staggered browser
 * download (see the vault skill for why) — a flat batch of individual
 * downloads has nowhere to put a preserved directory structure anyway, so
 * a sub-folder's own files are simply skipped (download that sub-folder
 * directly to get them).
 *
 * Same per-file shape `/api/vault/download/:fileId` returns: `{ url }` for
 * an S3-backed file, `{ content, contentType }` for a content-only one.
 * Entries that fail to resolve (e.g. a presign error) are silently
 * dropped rather than failing the whole batch.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, syncScoped } = scoped;

  const { folderId } = params;
  if (!folderId) {
    return Response.json({ error: "folderId required" }, { status: 400 });
  }

  const folder = await getFolderById(folderId);
  if (!folder) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (folder.human_id !== user._id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (syncScoped && !(await isFolderUnderSyncs(folderId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { files } = await listFolderChildren(folder.human_id, folderId);

  const entries = await Promise.all(
    files.map(async (listing) => {
      const file = await getFileRefById(listing._id);
      if (!file) return null;

      if (file.s3_key) {
        try {
          const url = await getPresignedDownloadUrl(file.s3_key, file.name);
          return { id: file._id, name: file.name, url };
        } catch (err) {
          console.error("Presign download error:", err);
          return null;
        }
      }

      if (file.content != null) {
        return {
          id: file._id,
          name: file.name,
          content: file.content,
          contentType: file.content_type,
        };
      }

      return null;
    }),
  );

  return Response.json({ files: entries.filter((e) => e !== null) });
}
