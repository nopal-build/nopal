/**
 * The dashboard: what `/` shows each person, decided here and only here.
 *
 * `buildDashboard` is pure. It takes the projects a person holds a role
 * on, their role on each (ADR-023), each project's read and one ask
 * from its Efforts sidecar, and recent Steep readings, and returns the
 * only data the page receives. Anything it leaves out never reaches the
 * browser, which is how "a client's reading reaches the guides" and "a
 * client sees their project and nothing else" hold: by what the server
 * returns, not by what the page hides.
 *
 * `loadDashboard` only fetches: the person's projects and roles
 * (`listProjectsFor`) and each Efforts sidecar once, never a whole Graph
 * folder.
 *
 * Nothing here orders by importance. The Efforts sidecar carries no
 * blocking, due or "what this feeds" field, and the guide's rule is that
 * a wrong order is worse than none, so projects keep the order they came
 * in and nothing says otherwise.
 */

import { query } from "./generic.server";
import { getHumansById } from "./humans.server";
import type { VaultFolder } from "./vault.types";
import { getProjectStatus } from "./projectStatus.server";
import type { ProjectSharingEntry, ProjectStatus } from "./project.types";
import { listProjectsFor, roleIn, type ProjectMembership } from "./projectSharing.server";
import { CLIENT_ROLE, GUIDING_ROLE } from "./sharingRoles.server";
import { EFFORTS_SIDECAR_FILE_NAME, readSidecarReadAndAsk } from "./effortReadings.server";
import { listSteepReadings, type SteepReading } from "./steepReadings.server";
import type { SteepPosition } from "./steepScale";

/** How far back a client's reading shows on a guide's row. A week keeps
 * a steep stretch visible past a weekend without becoming a record. */
export const STEEP_NOTE_DAYS = 7;

export type DashboardProjectInput = {
  id: string;
  name: string;
  status: ProjectStatus;
  statusAt: string | null;
  sharing: ProjectSharingEntry[];
  ask: string | null;
};

/** One client's latest reading on a project, in words, with the one
 * before it so the guide sees the slope. Never an average, never beside
 * a score. */
export type SteepNote = {
  who: string;
  position: SteepPosition;
  date: string;
  previous: SteepPosition | null;
};

export type DashboardRow = {
  id: string;
  name: string;
  /** The viewer's role here (ADR-023). */
  role: string;
  status: ProjectStatus;
  statusAt: string | null;
  /** The page's one ask. Null on a Client row. */
  ask: string | null;
  /** Clients' readings on this project, on an Owner's row only. */
  notes: SteepNote[];
  /** Whether this person taps the Steep-o-meter here: anyone on an active
   * project. */
  canTap: boolean;
  /** The viewer's own latest reading here, so the meter shows what they
   * tapped. The page decides whether it is today's. */
  mine: { position: SteepPosition; date: string } | null;
};

export type Dashboard = {
  /** Projects per status, for the guide view's tabs. Null in the client
   * view, which shows no counts and so receives none. */
  counts: Record<ProjectStatus, number> | null;
  /** "client" when every role this person holds is Client: today's log
   * and a Steep-o-meter per project, nothing else. */
  view: "guide" | "client";
  rows: DashboardRow[];
  /** The one project the meter at the top of the screen is about, when
   * there is exactly one they can tap on. Otherwise the meter sits on
   * each row. */
  topMeterProjectId: string | null;
};

export function buildDashboard(input: {
  viewerId: string;
  projects: DashboardProjectInput[];
  readings: SteepReading[];
  names: Map<string, string>;
  status: ProjectStatus;
}): Dashboard {
  const { viewerId, projects, readings, names, status } = input;

  const held = projects
    .map((p) => ({ project: p, role: roleIn(p.sharing, viewerId) }))
    .filter((x): x is { project: DashboardProjectInput; role: string } => x.role !== null);

  const view: Dashboard["view"] =
    held.length > 0 && held.every((x) => x.role === CLIENT_ROLE) ? "client" : "guide";

  const rows: DashboardRow[] = held
    // The client view only ever holds active projects: no tabs, no counts.
    .filter((x) => (view === "client" ? x.project.status === "active" : x.project.status === status))
    .map(({ project, role }) => {
      const onProject = readings.filter((r) => r.project_folder_id === project.id);
      const mineAll = onProject.filter((r) => r.human_id === viewerId);
      const mine = mineAll.length ? mineAll[mineAll.length - 1] : null;
      return {
        id: project.id,
        name: project.name,
        role,
        status: project.status,
        statusAt: project.statusAt,
        ask: role === CLIENT_ROLE ? null : project.ask,
        notes: role === GUIDING_ROLE ? clientNotes(project, onProject, viewerId, names) : [],
        canTap: project.status === "active",
        mine: mine ? { position: mine.position, date: mine.date } : null,
      };
    });

  const tappable = rows.filter((r) => r.canTap);
  let counts: Dashboard["counts"] = null;
  if (view === "guide") {
    counts = { active: 0, completed: 0, trashed: 0 };
    for (const x of held) counts[x.project.status]++;
  }
  return {
    counts,
    view,
    rows,
    topMeterProjectId: tappable.length === 1 ? tappable[0].id : null,
  };
}

/** Each client's latest reading on the project, with the reading before
 * it. Readings from anyone who isn't a Client stay with the person who
 * made them. */
function clientNotes(
  project: DashboardProjectInput,
  onProject: SteepReading[],
  viewerId: string,
  names: Map<string, string>,
): SteepNote[] {
  const byPerson = new Map<string, SteepReading[]>();
  for (const r of onProject) {
    if (r.human_id === viewerId) continue;
    if (roleIn(project.sharing, r.human_id) !== CLIENT_ROLE) continue;
    const list = byPerson.get(r.human_id) ?? [];
    list.push(r);
    byPerson.set(r.human_id, list);
  }
  const notes: SteepNote[] = [];
  for (const [humanId, list] of byPerson) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const before = sorted.length > 1 ? sorted[sorted.length - 2] : null;
    notes.push({
      who: names.get(humanId) ?? "A client",
      position: latest.position,
      date: latest.date,
      previous: before ? before.position : null,
    });
  }
  return notes.sort((a, b) => b.date.localeCompare(a.date));
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Each project's Efforts sidecar, found through its Graph folder: two
 * queries in all, whatever the number of projects. */
async function sidecarsFor(projects: VaultFolder[]): Promise<Map<string, string>> {
  const ids = projects.map((p) => p._id);
  if (ids.length === 0) return new Map();
  const folders = await query<[{ id: unknown; parent_folder_id: string; created_at: string }[]]>(
    `SELECT id, parent_folder_id, created_at FROM vault_folders
     WHERE parent_folder_id IN $ids AND is_folder_type_root = true AND folder_type = "graph"
     ORDER BY created_at ASC`,
    { ids },
  );
  // Oldest Graph folder per project, the same pick `findProjectGraphFolder` makes.
  const graphToProject = new Map<string, string>();
  const seen = new Set<string>();
  for (const f of folders?.[0] ?? []) {
    if (seen.has(f.parent_folder_id)) continue;
    seen.add(f.parent_folder_id);
    graphToProject.set(recordKey(f.id), f.parent_folder_id);
  }
  if (graphToProject.size === 0) return new Map();
  const files = await query<[{ folder_id: string; content?: string }[]]>(
    `SELECT folder_id, content FROM file_refs WHERE folder_id IN $graphIds AND name = $name`,
    { graphIds: [...graphToProject.keys()], name: EFFORTS_SIDECAR_FILE_NAME },
  );
  const out = new Map<string, string>();
  for (const f of files?.[0] ?? []) {
    const projectId = graphToProject.get(f.folder_id);
    if (projectId && f.content) out.set(projectId, f.content);
  }
  return out;
}

/** A SurrealDB record id as the bare key the rest of the app stores. */
function recordKey(id: unknown): string {
  if (id && typeof id === "object" && "id" in id) return String((id as { id: unknown }).id);
  const s = String(id);
  return s.includes(":") ? s.slice(s.indexOf(":") + 1) : s;
}

/** `memberships` is `listProjectsFor(viewerId)`, passed in when the
 * caller already has it. */
export async function loadDashboard(
  viewerId: string,
  status: ProjectStatus,
  memberships?: ProjectMembership[],
): Promise<Dashboard> {
  memberships ??= await listProjectsFor(viewerId);
  const folders = memberships.map((m) => m.folder);
  const [sidecars, readings] = await Promise.all([
    sidecarsFor(folders),
    listSteepReadings(
      folders.map((f) => f._id),
      daysAgo(STEEP_NOTE_DAYS),
    ),
  ]);
  const names = new Map(
    (await getHumansById([...new Set(readings.map((r) => r.human_id))])).map((h) => [h._id, h.name || h.email]),
  );
  const projects: DashboardProjectInput[] = memberships.map(({ folder: f, sharing }) => ({
    id: f._id,
    name: f.name,
    status: getProjectStatus(f),
    statusAt: f.project_status_at ?? null,
    sharing,
    ask: readSidecarReadAndAsk(sidecars.get(f._id)).ask,
  }));
  return buildDashboard({ viewerId, projects, readings, names, status });
}
