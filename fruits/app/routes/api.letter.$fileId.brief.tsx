import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFileRefById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { canManageLetters, letterHome } from "robustness-core/data/letters.server";
import { getLetterBriefForPage, requestBrief } from "robustness-core/data/brief.server";

/**
 * GET  /api/letter/:fileId/brief   the brief and the job writing it
 * POST /api/letter/:fileId/brief   "Write it again"
 *
 * Guides only (`canManageLetters`: a Guide on the project, or staff);
 * anyone else gets the 404 of a letter that isn't there, a Client,
 * Crafter and Observer included. The brief never leaves by any other
 * route: not the public page, not the download, not the tab. The letter's
 * page polls the GET while a job runs.
 */
async function letterForManager(request: Request, fileId: string | undefined) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const file = fileId ? await getFileRefById(fileId) : null;
  const home = file && !file.archived_at ? await letterHome(file) : null;
  if (!file || !home) return Response.json({ error: "Not found" }, { status: 404 });
  if (!canManageLetters(user, await getProjectRole(home.project, user._id))) return Response.json({ error: "Not found" }, { status: 404 });
  return { user, file, project: home.project };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const got = await letterForManager(request, params.fileId);
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
