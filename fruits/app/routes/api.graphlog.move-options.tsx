import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getAccessibleProjectFolders, getFileRefById, getFolderById, getReadmeFileForFolder } from "robustness-core/data/vault.server";
import { canViewFolder } from "robustness-core/data/vault.types";
import { pageHash } from "robustness-core/data/pageBody.server";
import { pageMarkUnits } from "robustness-core/data/graphLogMarks.server";
import { cardChunks } from "robustness-core/data/graphLogMoves.server";
import { getDailyLogCards } from "robustness-core/data/dailyLog.server";
import { parseSyncedCardFileName } from "robustness-core/data/dailyLogSync.server";
import { getHumansById } from "robustness-core/data/humans.server";

/**
 * GET /api/graphlog/move-options?projectFolderId=&pageHash=&unitKey=
 *
 * What the margin needs to offer a refile in place: the daily-log entries
 * this passage cites, what each one is made of, and the projects the
 * reader could file it under. The person picks both, so nothing depends
 * on a model reading a sentence, and the other project's name never has
 * to be typed into a mark (see `graphLogMoves.server.ts`).
 *
 * An entry the reader did not write is still offered: choosing it records
 * a request for its author rather than moving their words.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const projectFolderId = url.searchParams.get("projectFolderId") ?? "";
  const unitKey = url.searchParams.get("unitKey") ?? "";
  const hash = url.searchParams.get("pageHash") ?? "";

  const folder = await getFolderById(projectFolderId);
  if (!folder || !canViewFolder(user._id, folder)) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  const raw = (await getReadmeFileForFolder(folder.human_id, folder._id))?.content ?? "";
  if (pageHash(raw) !== hash) {
    return Response.json({ error: "This page has been rewritten. Reload it." }, { status: 409 });
  }
  const unit = pageMarkUnits(raw).find((u) => u.key === unitKey);
  if (!unit) return Response.json({ error: "That passage isn't on this page." }, { status: 400 });

  const entries = [];
  for (const ref of unit.refs) {
    if (!ref.fileId) continue;
    const synced = await getFileRefById(ref.fileId);
    const parsed = synced ? parseSyncedCardFileName(synced.name) : null;
    if (!parsed) continue;
    const card = (await getDailyLogCards(parsed.humanId, parsed.date)).find(
      (c) => c.projectFolderId === folder._id,
    );
    if (!card) continue;
    entries.push({
      fileId: ref.fileId,
      date: parsed.date,
      authorName: ref.name,
      yours: parsed.humanId === user._id,
      sections: cardChunks(card.content).map((c) => ({
        heading: c.heading,
        occurrence: c.occurrence,
        words: c.text.trim().split(/\s+/).length,
      })),
    });
  }

  const humans = await getHumansById([user._id]);
  const projects = (await getAccessibleProjectFolders(user._id))
    .filter((p) => p._id !== folder._id)
    .map((p) => ({ id: p._id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return Response.json({ entries, projects, you: humans[0]?.name ?? null });
}
