import type { ActionFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { buildDictationContext, type TermsProject } from "../modules/dictationTerms";
import { peopleOnMany } from "../data/projectPeople.server";
import { getDailyLogCards } from "robustness-core/data/dailyLog.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole, getProjectSharing, listProjectsFor } from "robustness-core/data/projectSharing.server";
import type { VaultFolder } from "robustness-core/data/vault.types";
// Plain JS shared with the socket relay beside server.js.
import { signTicket } from "../../dictation/ticket.js";

/**
 * POST /api/dictation/start
 * Body (JSON): { date, cardFile? }
 * Returns: { ticket }
 *
 * The record button's first step (record-in-daily-log seed). The socket
 * relay at /ws/dictation runs outside the app build and can't read the
 * session or the vault, so this route does both checks and hands back a
 * short-lived signed ticket carrying the terms for Soniox.
 *
 * In a Card (`cardFile` is the `::card{file}` name): only one of this
 * person's own Cards for that day, on a project where they still have
 * `dailyLog` -- the same checks the Card save makes, so dictating can't
 * reach anything typing couldn't. The Card's project's terms go first.
 * In the day's own prose: the projects of that day's Cards, or every
 * project the person is on when there are none yet.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { date?: string; cardFile?: string };
  const date = body.date ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Invalid or missing date" }, { status: 400 });
  }

  const cards = await getDailyLogCards(user._id, date);
  let folders: VaultFolder[];
  if (body.cardFile) {
    const card = cards.find((c) => c.fileName === body.cardFile);
    if (!card) return Response.json({ error: "Not found" }, { status: 404 });
    const project = await getFolderById(card.projectFolderId);
    const features = project ? (await getProjectRole(project, user._id))?.features ?? [] : [];
    if (!project || !features.includes("dailyLog")) {
      return Response.json({ error: "You're not writing to that project anymore." }, { status: 403 });
    }
    folders = [project];
  } else if (cards.length) {
    const found = await Promise.all(cards.map((c) => getFolderById(c.projectFolderId)));
    folders = found.filter((f): f is VaultFolder => !!f);
  } else {
    folders = (await listProjectsFor(user._id)).map((m) => m.folder);
  }

  const people = await peopleOnMany(
    await Promise.all(folders.map(async (folder) => ({ folder, sharing: await getProjectSharing(folder) }))),
  );
  const projects: TermsProject[] = people.map((p) => ({ name: p.name, people: p.members.map((m) => m.name) }));

  return Response.json({ ticket: signTicket({ humanId: user._id, context: buildDictationContext(projects) }) });
}
