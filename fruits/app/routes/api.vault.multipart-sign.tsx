import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { presignMultipartParts } from "robustness-core/data/file.server";

/**
 * POST /api/vault/multipart-sign
 * Body (JSON): { uploadId, key, partNumbers: number[] }
 * Returns: { parts: [{ partNumber, url }] }
 *
 * Presigned PUT URLs for parts of an upload `multipart-init` opened. The
 * browser sends each part straight to storage on its URL and reads the
 * part's ETag from the response, so the bytes never pass through this
 * server: a phone video is bigger than a request this machine should hold
 * (Gerald's `.MOV`s, 2026-10-31).
 */

/** Parts signed per request: a 2 GB video is 200 parts of 10 MB, signed a
 * batch at a time as the upload goes. */
const MAX_PARTS_PER_REQUEST = 50;

export async function action({ request }: ActionFunctionArgs) {
  // Sync-scope OK: parts can only attach to an upload session whose key was
  // issued by multipart-init, which enforces the syncs/ restriction.
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const user = scoped.user;

  const body = (await request.json().catch(() => null)) as { uploadId?: unknown; key?: unknown; partNumbers?: unknown } | null;
  const uploadId = typeof body?.uploadId === "string" ? body.uploadId : null;
  const key = typeof body?.key === "string" ? body.key : null;
  const partNumbers = Array.isArray(body?.partNumbers) ? body.partNumbers : null;
  if (!uploadId || !key || !partNumbers?.length) {
    return Response.json({ error: "uploadId, key, and partNumbers are required" }, { status: 400 });
  }
  if (partNumbers.length > MAX_PARTS_PER_REQUEST) {
    return Response.json({ error: `At most ${MAX_PARTS_PER_REQUEST} parts per request` }, { status: 400 });
  }
  if (!partNumbers.every((n) => Number.isInteger(n) && n >= 1 && n <= 10000)) {
    return Response.json({ error: "Invalid partNumber" }, { status: 400 });
  }

  // Security: ensure the key belongs to this user
  if (!key.startsWith(`vault/${user._id}/`)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return Response.json({ parts: await presignMultipartParts(key, uploadId, partNumbers as number[]) });
  } catch (err) {
    console.error("Multipart sign error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Could not sign the upload" }, { status: 500 });
  }
}
