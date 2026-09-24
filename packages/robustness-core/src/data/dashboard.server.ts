/**
 * The dashboard: what `/` shows each person, decided here and only here.
 *
 * `buildDashboard` is pure. It takes the projects a person can already
 * see, where they sit on each (ADR-022), each project's read and one ask
 * from its Efforts sidecar, and recent Steep readings, and returns the
 * only data the page receives. Anything it leaves out never reaches the
 * browser, which is how "a client's reading reaches the guides" and "a
 * client sees their project and nothing else" hold: by what the server
 * returns, not by what the page hides.
 *
 * `loadDashboard` only fetches. It reads each project's README once (for
 * seats) and each Efforts sidecar once, never a whole Graph folder.
 *
 * Nothing here orders by importance. The Efforts sidecar carries no
 * blocking, due or "what this feeds" field, and the guide's rule is that
 * a wrong order is worse than none, so projects keep the order they came
 * in and nothing says otherwise.
 */

import { query } from "./generic.server";
import { getHumansById } from "./humans.server";
import { getAccessibleProjectFolders } from "./vault.server";
import type { VaultFolder } from "./vault.types";
import { getProjectStatus } from "./projectStatus.server";
import {
  parseProjectSharing,
  type ProjectSeat,
  type ProjectSharingEntry,
  type ProjectStatus,
} from "./project.types";
import { seatFromSharing } from "./projectSharing.server";
import { ownerTierRoleNames } from "./sharingRoles.server";
import { EFFORTS_SIDECAR_FILE_NAME, readSidecarReadAndAsk } from "./effortReadings.server";
import { listSteepReadings, type SteepReading } from "./steepReadings.server";
import type { SteepPosition } from "./steepScale";

/** How far back a client's reading shows on a guide's row. A week keeps
 * a steep stretch visible past a weekend without becoming a record. */
export const STEEP_NOTE_DAYS = 7;

export type DashboardProjectInput = {
  id: string;
  name: string;
  ownerId: string;
  status: ProjectStatus;
  statusAt: string | null;
  sharing: ProjectSharingEntry[];
  read: string | null;
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
  seat: ProjectSeat;
  status: ProjectStatus;
  statusAt: string | null;
  /** Guide and observer rows: the page's one ask. Client rows: null. */
  ask: string | null;
  /** Client rows: where it stands, in the page's own words. Guide rows: null. */
  read: string | null;
  /** Client readings on this project. Empty on every client row, always. */
  notes: SteepNote[];
  /** Whether this person taps the Steep-o-meter on this project. Observers
   * look in; their own meter belongs to the projects they run. */
  canTap: boolean;
  /** The viewer's own latest reading here, so the meter shows what they
   * tapped. The page decides whether it is today's. */
  mine: { position: SteepPosition; date: string } | null;
};

export type Dashboard = {
  /** Projects per status, for the guide view's tabs. Null in the client
   * view, which shows no counts and so receives none. */
  counts: Record<ProjectStatus, number> | null;
  /** "client" when every project this person is on seats them as a
   * client: no list, no counts, their project first. */
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
  /** For unmarked entries; see `seatFromSharing`. */
  ownerTierRoles?: ReadonlySet<string>;
}): Dashboard {
  const { viewerId, projects, readings, names, status, ownerTierRoles } = input;

  const seated = projects
    .map((p) => ({ project: p, seat: seatFromSharing({ human_id: p.ownerId }, p.sharing, viewerId, ownerTierRoles) }))
    .filter((x): x is { project: DashboardProjectInput; seat: ProjectSeat } => x.seat !== null);

  const view: Dashboard["view"] =
    seated.length > 0 && seated.every((x) => x.seat === "client") ? "client" : "guide";

  const rows: DashboardRow[] = seated
    // A client only ever sees their active projects: no tabs, no counts.
    .filter((x) => (view === "client" ? x.project.status === "active" : x.project.status === status))
    .map(({ project, seat }) => {
      const onProject = readings.filter((r) => r.project_folder_id === project.id);
      const mineAll = onProject.filter((r) => r.human_id === viewerId);
      const mine = mineAll.length ? mineAll[mineAll.length - 1] : null;
      const isClientSeat = seat === "client";
      return {
        id: project.id,
        name: project.name,
        seat,
        status: project.status,
        statusAt: project.statusAt,
        ask: isClientSeat ? null : project.ask,
        read: isClientSeat ? project.read : null,
        notes: isClientSeat ? [] : clientNotes(project, onProject, viewerId, names, ownerTierRoles),
        canTap: seat !== "observer" && project.status === "active",
        mine: mine ? { position: mine.position, date: mine.date } : null,
      };
    });

  const tappable = rows.filter((r) => r.canTap);
  let counts: Dashboard["counts"] = null;
  if (view === "guide") {
    counts = { active: 0, completed: 0, trashed: 0 };
    for (const x of seated) counts[x.project.status]++;
  }
  return {
    counts,
    view,
    rows,
    topMeterProjectId: tappable.length === 1 ? tappable[0].id : null,
  };
}

/** Each client's latest reading on the project, with the reading before
 * it. Readings from guides and observers stay with the person who made
 * them; the ones that reach this row are the clients'. */
function clientNotes(
  project: DashboardProjectInput,
  onProject: SteepReading[],
  viewerId: string,
  names: Map<string, string>,
  ownerTierRoles?: ReadonlySet<string>,
): SteepNote[] {
  const byPerson = new Map<string, SteepReading[]>();
  for (const r of onProject) {
    if (r.human_id === viewerId) continue;
    if (seatFromSharing({ human_id: project.ownerId }, project.sharing, r.human_id, ownerTierRoles) !== "client") continue;
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

/** Each project's README content (for its sharing list), one query. */
async function readmesFor(projects: VaultFolder[]): Promise<Map<string, string>> {
  const ids = projects.map((p) => p._id);
  if (ids.length === 0) return new Map();
  const result = await query<[{ folder_id: string; human_id: string; name: string; content?: string }[]]>(
    `SELECT folder_id, human_id, name, content FROM file_refs
     WHERE folder_id IN $ids AND string::lowercase(name) = "readme.md"`,
    { ids },
  );
  const owners = new Map(projects.map((p) => [p._id, p.human_id]));
  const out = new Map<string, string>();
  for (const row of result?.[0] ?? []) {
    if (owners.get(row.folder_id) !== row.human_id) continue;
    out.set(row.folder_id, row.content ?? "");
  }
  return out;
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

/** `folders` is `getAccessibleProjectFolders(viewerId)`, passed in when the
 * caller already has it. */
export async function loadDashboard(
  viewerId: string,
  status: ProjectStatus,
  folders?: VaultFolder[],
): Promise<Dashboard> {
  folders ??= await getAccessibleProjectFolders(viewerId);
  const [readmes, sidecars, readings, ownerTierRoles] = await Promise.all([
    readmesFor(folders),
    sidecarsFor(folders),
    listSteepReadings(
      folders.map((f) => f._id),
      daysAgo(STEEP_NOTE_DAYS),
    ),
    ownerTierRoleNames(),
  ]);
  const names = new Map(
    (await getHumansById([...new Set(readings.map((r) => r.human_id))])).map((h) => [h._id, h.name || h.email]),
  );
  const projects: DashboardProjectInput[] = folders.map((f) => {
    const { read, ask } = readSidecarReadAndAsk(sidecars.get(f._id));
    return {
      id: f._id,
      name: f.name,
      ownerId: f.human_id,
      status: getProjectStatus(f),
      statusAt: f.project_status_at ?? null,
      sharing: withViewerSeat(f, parseProjectSharing(readmes.get(f._id) ?? ""), viewerId),
      read,
      ask,
    };
  });
  return buildDashboard({ viewerId, projects, readings, names, status, ownerTierRoles });
}

/** Someone who can open a project (it is in their accessible list) but has
 * no entry in its sharing list reached it through a shared parent. They
 * sit as a client, the narrowest seat, as they do on the project page. */
function withViewerSeat(
  folder: VaultFolder,
  sharing: ProjectSharingEntry[],
  viewerId: string,
): ProjectSharingEntry[] {
  if (seatFromSharing(folder, sharing, viewerId) !== null) return sharing;
  return [...sharing, { human: viewerId, role: "Observer", seat: "client" }];
}
