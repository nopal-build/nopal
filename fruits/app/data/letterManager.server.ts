// The one gate for a letter's workings (the brief, the talk-through, the
// outline): a Guide on the project, or staff (`canManageLetters`), and
// the letter itself. Anyone else gets the 404 of a letter that isn't
// there, a Client, Crafter and Observer included. Shared by the
// `api.letter.$fileId.{brief,talk,outline}` routes so the rule is in one
// place.
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFileRefById } from "robustness-core/data/vault.server";
import { getProjectRole, type ResolvedProjectRole } from "robustness-core/data/projectSharing.server";
import { canManageLetters, letterHome } from "robustness-core/data/letters.server";
import type { Human } from "robustness-core/data/humans.server";
import type { FileRef, VaultFolder } from "robustness-core/data/vault.types";

export type LetterManager = { user: Human; file: FileRef; project: VaultFolder; role: ResolvedProjectRole | null };

export async function letterForManager(request: Request, fileId: string | undefined): Promise<LetterManager | Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const file = fileId ? await getFileRefById(fileId) : null;
  const home = file && !file.archived_at ? await letterHome(file) : null;
  if (!file || !home) return Response.json({ error: "Not found" }, { status: 404 });
  const role = await getProjectRole(home.project, user._id);
  if (!canManageLetters(user, role)) return Response.json({ error: "Not found" }, { status: 404 });
  return { user, file, project: home.project, role };
}
