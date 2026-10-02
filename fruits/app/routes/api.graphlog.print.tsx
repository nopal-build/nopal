import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById, type VaultFolder } from "robustness-core/data/vault.server";
import { getProjectRole, isProjectFolder } from "robustness-core/data/projectSharing.server";
import { isStaff } from "robustness-core/data/humans.server";
import {
  enqueueGraphLogJob,
  getGraphLogJobOwner,
  getGraphLogJobStatus,
  getGraphLogProjectStatus,
} from "robustness-core/data/graphLogQueue.server";
import { getEffortsPrintedAt, printAllowance, printStagesStarted } from "robustness-core/data/effortsPrint.server";
import { getGraphLogRunStartedAt, getLastPrintDurationMs } from "robustness-core/data/graphLogPerf.server";
import type { Feature } from "robustness-core/data/features";

/**
 * "Print an update" on the Efforts page (ADR-030).
 *
 * POST { projectFolderId } enqueues a `"print"` job: the graph, then the
 * page, so marks made just before it are on the page it prints. Anyone
 * with a role on the project may print once the last print is a week old;
 * a Guide or Nopal staff any time (`printAllowance`). 403 with the next
 * date when it is too soon, 409 while a job is already running.
 *
 * GET ?projectFolderId[&jobId] is what the page polls: whether a job is
 * running, the printed date, the reader's allowance, and, given the id
 * the POST returned, how that print ended. Its own route because the
 * jobs route admits owners and staff only, and a Client who prints has
 * to be able to follow their own print.
 */

type Reader = { userId: string; folder: VaultFolder; features: readonly Feature[]; staff: boolean };

async function readerFor(request: Request, projectFolderId: string | null): Promise<Reader | Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!projectFolderId) return Response.json({ error: "projectFolderId is required" }, { status: 400 });
  const folder = await getFolderById(projectFolderId);
  const notFound = Response.json({ error: "Project not found" }, { status: 404 });
  if (!folder || !(await isProjectFolder(folder))) return notFound;
  const role = await getProjectRole(folder, user._id);
  const staff = isStaff(user);
  // A share from before roles reads the page but never prints, the same
  // as it never marks.
  if (!role && !staff) return notFound;
  return { userId: user._id, folder, features: role?.features ?? [], staff };
}

async function allowanceFor(reader: Reader) {
  const printedAt = await getEffortsPrintedAt(reader.folder);
  const allowance = printAllowance({ features: reader.features, isStaff: reader.staff, printedAt, now: new Date() });
  return { printedAt, allowance };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const reader = await readerFor(request, url.searchParams.get("projectFolderId"));
  if (reader instanceof Response) return reader;

  const [status, { printedAt, allowance }] = await Promise.all([
    getGraphLogProjectStatus(reader.folder._id),
    allowanceFor(reader),
  ]);

  let job: {
    state: string;
    readmeChanged: boolean | null;
    error: string | null;
    /** Stages started, 0 to 5 (`printStagesStarted`). */
    stagesStarted: number;
    /** When the worker picked the print up; null while it waits. */
    startedAt: string | null;
    /** How long this project's last print took, for "usually about". */
    lastPrintMs: number | null;
  } | null = null;
  const jobId = url.searchParams.get("jobId");
  if (jobId) {
    const owner = await getGraphLogJobOwner(jobId);
    if (owner?.projectFolderId === reader.folder._id) {
      const s = await getGraphLogJobStatus(jobId);
      if (s.ok) {
        const result = (s.result ?? null) as { readmeChanged?: unknown } | null;
        const [startedAt, lastPrintMs] = await Promise.all([getGraphLogRunStartedAt(jobId), getLastPrintDurationMs(reader.folder._id)]);
        job = {
          state: s.state,
          readmeChanged: typeof result?.readmeChanged === "boolean" ? result.readmeChanged : null,
          error: s.state === "failed" ? (s.error ?? "The print stopped on an error.") : null,
          stagesStarted: printStagesStarted(s.log ?? []),
          startedAt,
          lastPrintMs,
        };
      }
    }
  }

  return Response.json({ running: status.running, printedAt, allowance, job });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const body = (await request.json().catch(() => ({}))) as { projectFolderId?: unknown };
  const reader = await readerFor(request, typeof body.projectFolderId === "string" ? body.projectFolderId : null);
  if (reader instanceof Response) return reader;

  const { allowance } = await allowanceFor(reader);
  if (!allowance.may) {
    return Response.json({ error: "Not yet", nextAt: allowance.nextAt }, { status: 403 });
  }
  const status = await getGraphLogProjectStatus(reader.folder._id);
  if (status.running) {
    return Response.json({ error: "Already running", currentJobName: status.currentJobName }, { status: 409 });
  }

  try {
    const jobId = await enqueueGraphLogJob("print", { actingHumanId: reader.userId, projectFolderId: reader.folder._id });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("GraphLog print enqueue error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed to start the print" }, { status: 500 });
  }
}
