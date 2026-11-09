import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { letterForWriter } from "../data/letterWriter.server";
import { computeMdUpdate, updateFileRef } from "robustness-core/data/vault.server";

/**
 * PATCH /api/letter/:fileId   { content }
 *
 * The desk's save: the letter's words, by whoever may write the letter
 * (`letterForWriter`). It does for a letter what the Vault's content
 * PATCH (`api.vault.$fileId.tsx`) does, and nothing else: the text, its
 * version trail, and the hash that "edited since you sent it" and the
 * syncs read. The Vault's route asks for the Vault's own access, which
 * a client never has (ADR-023); the desk asks the letter's rule instead,
 * so this route exists. Renaming, moving and the rest stay the Vault's.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PATCH") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const got = await letterForWriter(request, params.fileId);
  if (got instanceof Response) return got;
  const body = (await request.json().catch(() => ({}))) as { content?: unknown };
  if (typeof body.content !== "string") return Response.json({ error: "Only content updates are allowed" }, { status: 400 });
  const { content, md_versions } = computeMdUpdate(got.file, body.content);
  const updated = await updateFileRef(got.file._id, {
    content,
    md_versions,
    content_hash: crypto.createHash("sha256").update(content, "utf8").digest("hex"),
  });
  return Response.json({ fileRef: updated });
}
