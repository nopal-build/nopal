// The one gate for writing a letter from a route: the person may write
// this letter (`resolveLetterForWriter`, `mayWriteLetter` in
// `letterHouses.ts`: a Guide on the project for any letter but a
// client's, a client for a letter from them). Anyone else gets the 404
// of a letter that isn't there: Crafters, Observers, staff off the
// project, a guide at a client's draft, a client at anyone else's.
// Shared by the `api.letter.$fileId.{talk,outline,send,recording}`
// routes, the workings read, the letter's own save and dictation, so
// the rule is in one place. Writing the brief stays the manager's
// (`letterManager.server.ts`).
import { getUserFromRequest } from "../modules/auth/auth.server";
import { resolveLetterForWriter, type LetterWriterKind } from "robustness-core/data/letters.server";
import { getProjectRole, type ResolvedProjectRole } from "robustness-core/data/projectSharing.server";
import type { Human } from "robustness-core/data/humans.server";
import type { FileRef, VaultFolder } from "robustness-core/data/vault.types";

export type LetterWriter = { user: Human; file: FileRef; project: VaultFolder; writer: LetterWriterKind; role: ResolvedProjectRole | null };

export async function letterForWriter(request: Request, fileId: string | undefined): Promise<LetterWriter | Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const mine = fileId ? await resolveLetterForWriter(fileId, user) : null;
  if (!mine) return Response.json({ error: "Not found" }, { status: 404 });
  // The role again, for the talk-through's `features` (`sendTalkThrough`).
  return { user, file: mine.file, project: mine.project, writer: mine.writer, role: await getProjectRole(mine.project, user._id) };
}
