import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { uploadFileToS3 } from "robustness-core/data/file.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole, isProjectFolder } from "robustness-core/data/projectSharing.server";
import { addPacketFile, currentSeedRound, getPacketFile, isPacketText, removePacketFile } from "robustness-core/data/seedPackets.server";

/**
 * POST /api/seed-packet
 *
 * A person's own seed packet on a project (`seedPackets.server.ts`).
 *
 *   multipart { file, projectFolderId }   adds one file to the caller's
 *       packet. Anyone with a role on the project, a Client included,
 *       while a seeding round is open.
 *   JSON { act: "remove", id }            takes one of the caller's own
 *       files back out, until it has been sown.
 *
 * A packet is rows, not a Vault folder, so this route is the only way a
 * file gets in: the bytes go to storage (text is kept inline) and nothing
 * under the project's folders changes. 404 for anyone not on the project,
 * so an id can't be probed; 409 when no round is open.
 */
const MAX_INLINE_TEXT_BYTES = 5 * 1024 * 1024;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  if (isJson) {
    const body = (await request.json().catch(() => null)) as { act?: unknown; id?: unknown } | null;
    if (!body || body.act !== "remove" || typeof body.id !== "string") return Response.json({ error: "Invalid request" }, { status: 400 });
    const file = await getPacketFile(body.id);
    // Only the person who added it, and the same 404 for anything else.
    if (!file || file.human_id !== user._id) return Response.json({ error: "Not found" }, { status: 404 });
    if (file.sown_at) return Response.json({ error: "That one has already been sown." }, { status: 409 });
    await removePacketFile(file._id);
    return Response.json({ ok: true });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const projectFolderId = form?.get("projectFolderId");
  if (!(file instanceof File) || typeof projectFolderId !== "string") return Response.json({ error: "Pick a file first." }, { status: 400 });
  if (file.size === 0) return Response.json({ error: "That file is empty." }, { status: 400 });

  const folder = await getFolderById(projectFolderId);
  if (!folder || !(await isProjectFolder(folder)) || !(await getProjectRole(folder, user._id))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const round = await currentSeedRound(folder._id);
  if (!round) return Response.json({ error: "This project isn't taking seed packets right now." }, { status: 409 });

  try {
    const contentType = file.type || "application/octet-stream";
    let content: string | null = null;
    let s3Key: string | null = null;
    let s3Url: string | null = null;
    let contentHash: string;
    if (isPacketText(file.name, contentType) && file.size <= MAX_INLINE_TEXT_BYTES) {
      content = await file.text();
      contentHash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
    } else {
      contentHash = crypto.createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      s3Key = `seed-packets/${folder._id}/${user._id}/${Date.now()}-${safeName}`;
      s3Url = await uploadFileToS3(file, s3Key);
    }
    const { file: row, outcome } = await addPacketFile({
      project_folder_id: folder._id,
      round: round.round,
      human_id: user._id,
      name: file.name,
      content_type: contentType,
      size: file.size,
      content_hash: contentHash,
      s3_key: s3Key,
      s3_url: s3Url,
      content,
    });
    return Response.json({ id: row._id, name: row.name, outcome }, { status: outcome === "added" ? 201 : 200 });
  } catch (err) {
    console.error("seed-packet upload error:", err);
    return Response.json({ error: "That didn't upload. Try again." }, { status: 500 });
  }
}
