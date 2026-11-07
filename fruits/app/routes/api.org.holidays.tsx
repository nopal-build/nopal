// app/routes/api.org.holidays.tsx
//
// GET /api/org/holidays — the Organization's observed holidays
// (`organizations.server.ts`), as JSON. Same gate as the `/org` web page
// itself (`org.tsx`'s own `requireOrgAccess`): a platform Admin/Super, or
// a Human who's specifically a Guide on the Nopal Organization. The
// direct machine-readable hook for `nopal org holidays`
// (`crates/cli/src/org.rs`) — same intent as `/api/performance/*`'s own
// header comment: an agent or script reads this instead of parsing the
// web page's HTML. (Used to also return org-wide office hours — removed
// 2026-11-03, see `org.tsx`'s own header comment: availability moved to
// being per-person, on each Human's own Profile page.)
import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { isStaff } from "robustness-core/data/humans.server";
import { getOrganization, getOrganizationRole, NOPAL_ORGANIZATION_ID } from "robustness-core/data/organizations.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const allowed = isStaff(user) || (await getOrganizationRole(user._id)) === "Guide";
  if (!allowed) return Response.json({ error: "Forbidden — Guides only" }, { status: 403 });

  const organization = await getOrganization(NOPAL_ORGANIZATION_ID);
  return Response.json({
    organizationName: organization?.name ?? null,
    holidays: [...(organization?.holidays ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
  });
}
