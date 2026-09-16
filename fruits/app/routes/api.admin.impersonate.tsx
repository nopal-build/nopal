import type { ActionFunctionArgs } from "react-router";
import { startImpersonation } from "../modules/auth/auth.server";
import { getHumanByEmail } from "robustness-core/data/humans.server";

/**
 * POST /api/admin/impersonate
 *
 * Body: { humanId: string } or { email: string }
 *
 * Lets a signed-in Admin/Super "log in as" another human for debugging.
 * Unlike the passkey "switch account" flow, this never requires the
 * target's own passkey — authorization comes entirely from the *caller's*
 * current session role, re-checked server-side. See `canImpersonate` in
 * `modules/auth/auth.server.ts` for the exact rules (Admins → Human
 * accounts only, Supers → anyone).
 *
 * `email` is accepted as an alternative to `humanId` so the "switch
 * account" modal — which only ever stores email/name in localStorage —
 * can hit this endpoint directly without a separate id lookup.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    humanId?: string;
    email?: string;
  };

  let humanId = body.humanId?.trim();
  if (!humanId && body.email?.trim()) {
    const target = await getHumanByEmail(body.email.trim());
    if (!target) {
      return Response.json(
        { error: "That account no longer exists." },
        { status: 404 },
      );
    }
    humanId = target._id;
  }
  if (!humanId) {
    return Response.json({ error: "Missing humanId or email" }, { status: 400 });
  }

  const { human, setCookie, error } = await startImpersonation(
    request,
    humanId,
  );

  if (!human) {
    return Response.json(
      { error: error ?? "Could not log in as that account." },
      { status: 403, headers: { "Set-Cookie": setCookie } },
    );
  }

  return Response.json(
    { success: true, human: { email: human.email, name: human.name } },
    { headers: { "Set-Cookie": setCookie } },
  );
}
