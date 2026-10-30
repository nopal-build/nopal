import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { letterForManager } from "../data/letterManager.server";
import { getFileRefById } from "robustness-core/data/vault.server";
import { enqueueLetterRecording, letterRecordingState } from "robustness-core/data/letterRecordingQueue.server";
import type { FileRef } from "robustness-core/data/vault.types";

/**
 * POST /api/letter/:fileId/recording   { recordingFileId }
 * GET  /api/letter/:fileId/recording?file=<recordingFileId>
 *
 * A guide's recording of the letter, read aloud. The browser records
 * and uploads it beside the letter (`/api/vault/upload`, or multipart
 * for a large one); this asks the worker to make it web-safe under the
 * same file id (`letterRecording.server.ts`), and the GET says how that
 * is going, so the outcome is on the page that asked (nobody reads the
 * worker's log). The recording becomes the letter's first block in the
 * editor, and so an unsent change, by the same autosave every edit
 * takes. Guides only (`letterForManager`); the recording must be a video
 * in the letter's own folder.
 */
async function recordingFor(request: Request, fileId: string | undefined, recordingFileId: unknown): Promise<FileRef | Response> {
  const got = await letterForManager(request, fileId);
  if (got instanceof Response) return got;
  const recording = typeof recordingFileId === "string" && recordingFileId ? await getFileRefById(recordingFileId) : null;
  if (!recording || recording.archived_at || recording.folder_id !== got.file.folder_id || !recording.content_type.startsWith("video/")) {
    return Response.json({ error: "That recording isn't beside this letter" }, { status: 404 });
  }
  return recording;
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const body = (await request.json().catch(() => ({}))) as { recordingFileId?: unknown };
  const recording = await recordingFor(request, params.fileId, body.recordingFileId);
  if (recording instanceof Response) return recording;
  await enqueueLetterRecording(recording._id);
  return Response.json({ state: "preparing" }, { status: 202 });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const recording = await recordingFor(request, params.fileId, new URL(request.url).searchParams.get("file"));
  if (recording instanceof Response) return recording;
  return Response.json(await letterRecordingState(recording._id), { headers: { "Cache-Control": "no-store" } });
}
