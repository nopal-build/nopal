import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { letterForManager } from "../data/letterManager.server";
import { letterForWriter } from "../data/letterWriter.server";
import { getLetterBriefForPage, requestBrief } from "robustness-core/data/brief.server";

/**
 * GET  /api/letter/:fileId/brief   the letter's workings: the brief, the
 *                                  talk-through, the outline, and the job
 *                                  writing either
 * POST /api/letter/:fileId/brief   "Write it again" for the brief
 *
 * The GET is the writer's (`letterForWriter`: a guide, or a client on
 * their own letter), since the page reads it after every talk and while
 * the outline runs. The POST is the manager's (`letterForManager`): a
 * client does not get the brief (Austin, 2026-11-05), and a client's
 * letter has no purpose line to brief from anyway. Nothing here leaves
 * by any other route: not the public page, not the download, not the
 * tab.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const got = await letterForWriter(request, params.fileId);
  if (got instanceof Response) return got;
  return Response.json(await getLetterBriefForPage(got.file._id));
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const got = await letterForManager(request, params.fileId);
  if (got instanceof Response) return got;
  const result = await requestBrief(got.project, got.file, got.user._id);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ jobId: result.jobId }, { status: 202 });
}
