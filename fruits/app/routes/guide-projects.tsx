// app/routes/guide-projects.tsx
//
// "All Projects" — every project in the org, Kanban-style
// (garden/3-growing/guide-projects-phases.md). Reached only via the
// landing "Projects" page's (`_index.tsx`) "View all projects →" link.
// The actual board UI lives in `GuideProjectsBoard` (`components/
// guide-projects/`) — this file stays loader/action only, since route
// files in this app don't import plain CSS directly (that component
// does, for `.gp-kanban` etc. — see its own file).
//
// Gated on org Guide (or platform Admin/Super) — both to VIEW the page
// at all and to MOVE a card. The real access-control work already lives
// in `canActAsProjectOwner`/`canViewFolderOrgAware`
// (`robustness-core/data/{projectSharing,vault}.server.ts` — see the
// seed's resolved "Access control" open question) — moving a card is
// just a PATCH to the EXISTING generic `/api/vault/:fileId` endpoint,
// which those already gate correctly. No bespoke permission code here;
// this route's own `requireOrgGuide` is purely a page-level 403, same
// shape `maker_.projects.tsx` already uses for its own Guide-only gate.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { isStaff, getHumansById } from "robustness-core/data/humans.server";
import {
  getOrganizationMembers,
  getOrganizationRole,
  NOPAL_ORGANIZATION_ID,
} from "robustness-core/data/organizations.server";
import {
  getOrgBoardAnchor,
  listBoardPhases,
  listPhaseCards,
} from "robustness-core/data/guideProjectsBoard.server";
import { listProjectsFor } from "robustness-core/data/projectSharing.server";
import { navFor } from "../data/nav.server";
import { GuideProjectsBoard } from "../components/guide-projects/GuideProjectsBoard";

export const meta: MetaFunction = () => [{ title: "O.No · All Projects" }];

async function requireOrgGuide(request: Request) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  const allowed = isStaff(user) || (await getOrganizationRole(user._id)) === "Guide";
  if (!allowed) throw data("Forbidden — Guides only", { status: 403 });
  return user;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireOrgGuide(request);
  const memberships = await listProjectsFor(user._id);
  const nav = await navFor(user._id, memberships);
  const userOut = { name: user.name ?? null, email: user.email, role: user.role };

  const anchor = await getOrgBoardAnchor(NOPAL_ORGANIZATION_ID);
  if (!anchor) {
    return { user: userOut, ...nav, viewerId: user._id, setUp: false as const, phases: [], guides: [] };
  }

  const phases = await listBoardPhases(anchor);
  const cardsByPhase = await Promise.all(phases.map((phase) => listPhaseCards(phase)));

  const members = await getOrganizationMembers(NOPAL_ORGANIZATION_ID);
  const guideMembers = members.filter((m) => m.role === "Guide");
  const guideHumans = await getHumansById(guideMembers.map((m) => m.human_id));
  const guideById = new Map(guideHumans.map((h) => [h._id, h]));
  const guideLabel = (humanId: string) => guideById.get(humanId)?.name ?? guideById.get(humanId)?.email ?? humanId;

  return {
    user: userOut,
    ...nav,
    viewerId: user._id,
    setUp: true as const,
    guides: guideMembers.map((m) => ({ id: m.human_id, name: guideLabel(m.human_id) })),
    phases: phases.map((phase, i) => ({
      name: phase.name,
      type: phase.type,
      folderId: phase.folder._id,
      cards: cardsByPhase[i].map((card) => ({
        fileId: card.file._id,
        title: card.title,
        targetFinish: card.targetFinish,
        guideId: card.guideHumanId,
        guideName: card.guideHumanId ? guideLabel(card.guideHumanId) : null,
        projectFolderId: card.projectFolderId,
      })),
    })),
  };
}

export type GuideProjectsLoaderData = Awaited<ReturnType<typeof loader>>;

export default function GuideProjectsRoute() {
  const loaderData = useLoaderData<typeof loader>();
  return <GuideProjectsBoard data={loaderData} />;
}
