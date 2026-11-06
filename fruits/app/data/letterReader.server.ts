// The gate for a reader's own talk-through of a letter (Austin,
// 2026-11-06; `letterReflection.server.ts`): someone signed in as
// themself, on the project, whom the sent letter is shown to. Any group,
// a Client included; `resolveSentLetterForMember` is their door to a
// sent letter and refuses a Client a letter the team sent the team.
// Anyone else gets the 404 of a letter that isn't there. An admin
// looking as someone is refused: the words would go on that person's
// record as theirs. Beside `letterForManager`, which is the writer's gate.
import { getUserFromRequest, isImpersonating } from "../modules/auth/auth.server";
import { getProjectRole, type ResolvedProjectRole } from "robustness-core/data/projectSharing.server";
import { resolveSentLetterForMember } from "robustness-core/data/letters.server";
import type { Human } from "robustness-core/data/humans.server";
import type { FileRef, VaultFolder } from "robustness-core/data/vault.types";

export type LetterReader = { user: Human; file: FileRef; project: VaultFolder; role: ResolvedProjectRole | null };

export async function letterForReader(request: Request, fileId: string | undefined): Promise<LetterReader | Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (await isImpersonating(request)) return Response.json({ error: "Not found" }, { status: 404 });
  const found = fileId ? await resolveSentLetterForMember(fileId, user._id) : null;
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  return { user, file: found.file, project: found.project, role: await getProjectRole(found.project, user._id) };
}
