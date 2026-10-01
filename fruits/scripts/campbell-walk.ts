// The Campbell walk, over HTTP (2026-09-25 people, access and features
// round; first written for ADR-023). Gates tests 1 to 4 and 9:
//   1. A Client on one project gets My Project (Efforts, Photos, their own
//      Steep tap) and the Daily Log. Everything else on the project, and
//      anything on another project, is refused by the server, typed URLs
//      and guessed file ids included, and a photo of a receipt too.
//   3. The admin sees everyone in /maker/projects?tab=humans and moves the client to
//      Observer and back there; what the client reaches follows on the
//      next load. A client or crafter can't open the list.
//   4. A Guide who isn't an admin moves people below Guide on their own
//      project, and makes nobody a Guide, touches no admin, and can't reach
//      another project's people.
//   9. The Crafter reaches the project's work as before; the Guide
//      reaches its people.
// And the Maker (ADR-026, 2026-09-28): the Guide sees their own project
// there and not the other, regroups through it, can't make a Guide; a
// Crafter or Client has no Maker and is refused by URL; someone guiding
// nothing can't start a project; a Client leaves a note with the pen.
// While the client is an Observer: they read the Costs tab; their Card and
// note wait for a Guide, who takes the Card and passes the note; they
// don't move an entry or file a file. A photo on the waiting Card opens
// for the Guide who decides on it and for nobody else until it is taken.
// Taking the client off the project empties the Card they wrote today,
// and they can't write to it again.
//
// Everything the walk changes it puts back. With SEED_RECEIPT=1 (default
// on localhost) and no receipt photo on the project, the crafter files one
// photo as a receipt first and files it back as a photo at the end.
//
// From fruits/, against a running local stack (or production with test
// accounts, by HOST):
//   source ../webapp/.env; unset SESSION_SECRET
//   npx vite-node scripts/campbell-walk.ts <client> <crafter> <guide> <admin> <ownProjectId> <otherProjectId>
// <guide> must not be an admin; the walk makes them Guide on the project
// through the Maker and puts their old role back. Use someone who already
// has a role on the project: putting back "no role" takes them off, and
// an invited account that is then on no project is deleted with its
// invite (`withdrawInvite`), which is how a local test account was lost
// on 2026-10-01.
import { query } from "robustness-core/data/generic.server";
import { getFolderById, getReadmeFileForFolder } from "robustness-core/data/vault.server";
import { getHumanByEmail } from "robustness-core/data/humans.server";
import { getProjectSharing, guidesAny, listProjectsFor } from "robustness-core/data/projectSharing.server";
import { ensureVaultRootFolders } from "robustness-core/data/vault.server";
import { loadProjectFiles } from "robustness-core/data/fileFolders.server";
import { getDailyLogCards, listCardsForProject } from "robustness-core/data/dailyLog.server";
import { listSuggestionMarks, listUnreadMarks, pageMarkUnits } from "robustness-core/data/graphLogMarks.server";
import { pageHash } from "robustness-core/data/pageBody.server";
import { listPacketFiles, removePacketFile } from "robustness-core/data/seedPackets.server";
import { sessionStorage } from "../app/modules/auth/session.server";

const [clientEmail, crafterEmail, guideEmail, adminEmail, ownId, otherId] = process.argv.slice(2);
const HOST = process.env.HOST ?? "http://localhost:3001";
const SEED_RECEIPT = (process.env.SEED_RECEIPT ?? (HOST.includes("localhost") ? "1" : "0")) === "1";
if (!otherId) {
  console.error("usage: campbell-walk.ts <client> <crafter> <guide> <admin> <ownProjectId> <otherProjectId>");
  process.exit(1);
}

async function person(email: string) {
  const human = await getHumanByEmail(email);
  if (!human) throw new Error(`no person ${email}`);
  const session = await sessionStorage.getSession();
  session.set("user", human);
  session.set("sessionIssuedAt", Date.now());
  return { id: human._id, role: human.role, cookie: (await sessionStorage.commitSession(session)).split(";")[0] };
}

const own = (await getFolderById(ownId))!;
const other = (await getFolderById(otherId))!;
// Names a refusal must never carry.
const secrets = [own.name, other.name];

/** One file somewhere under a project (a guessed id, as far as a client knows). */
async function fileUnder(projectId: string, where = ""): Promise<string | null> {
  let frontier = [projectId];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const files = await query<[{ id: { id: string }; name: string }[]]>(
      `SELECT id, name FROM file_refs WHERE folder_id IN $ids ${where} LIMIT 1`,
      { ids: frontier },
    );
    const f = files?.[0]?.[0];
    if (f) return String(f.id.id);
    const kids = await query<[{ id: { id: string } }[]]>(`SELECT id FROM vault_folders WHERE parent_folder_id IN $ids`, { ids: frontier });
    frontier = (kids?.[0] ?? []).map((k) => String(k.id.id));
  }
  return null;
}
const otherFile = await fileUnder(otherId);
const subfolder = String(
  ((await query<[{ id: { id: string } }[]]>(`SELECT id FROM vault_folders WHERE parent_folder_id = $id LIMIT 1`, { id: ownId }))?.[0]?.[0])?.id.id ?? ownId,
);

let failures = 0;
const lines: string[] = [];
async function hit(cookie: string, label: string, method: string, path: string, expect: number, body?: unknown) {
  const res = await fetch(`${HOST}${path}`, {
    method,
    redirect: "manual",
    headers: { cookie, ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  // 0 means "refused, any way": a 400 on a half-filled body names nothing
  // either, and the walk can't forge a valid move.
  let ok = expect === 0 ? res.status >= 400 && res.status < 500 : res.status === expect;
  let note = "";
  if (expect === 404) {
    const leaked = secrets.filter((s) => text.includes(s));
    if (leaked.length) {
      ok = false;
      note = ` names ${leaked.join(", ")}`;
    }
  }
  if (!ok) failures++;
  lines.push(`${ok ? "ok  " : "FAIL"} ${label}: ${method} ${path} -> ${res.status} (want ${expect})${note}`);
  return text;
}
function check(label: string, ok: boolean) {
  if (!ok) failures++;
  lines.push(`${ok ? "ok  " : "FAIL"} ${label}`);
}
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const client = await person(clientEmail);
const crafter = await person(crafterEmail);
const guide = await person(guideEmail);
const admin = await person(adminEmail);
if (guide.role !== "Human") throw new Error(`${guideEmail} is ${guide.role}; test 4 needs a Guide who isn't an admin`);
const before = await getProjectSharing(own);
const roleOf = async (id: string) => (await getProjectSharing(own)).find((e) => e.human === id)?.role ?? null;
const setGroup = (who: { cookie: string }, humanId: string, group: string, label: string) =>
  hit(who.cookie, label, "POST", "/maker/projects", 200, form({ humanId, projectId: ownId, group }));
const putSharing = async (who: { cookie: string }, change: Record<string, string>, label: string, want: number) => {
  const now = await getProjectSharing(own);
  const next = [...now.filter((e) => !(e.human in change)), ...Object.entries(change).map(([human, role]) => ({ human, role }))];
  return hit(who.cookie, label, "PUT", `/api/vault/projects/${ownId}/sharing`, want, { sharing: next });
};

// ── Photos: one the client may open, one receipt photo they may not ─────
let rows = await loadProjectFiles(own);
const photos = rows.filter((r) => r.folders.includes("gallery") && !r.folders.includes("costs") && r.copyFileId);
let receipt = rows.find((r) => r.folders.includes("gallery") && r.folders.includes("costs") && r.copyFileId) ?? null;
let seeded: string | null = null;
if (!receipt && SEED_RECEIPT && photos.length > 1) {
  const target = photos[photos.length - 1];
  await hit(crafter.cookie, "seed: crafter files a photo as a receipt", "POST", "/api/graphlog/file-marks", 201, {
    projectFolderId: ownId,
    fileId: target.fileId,
    act: { kind: "file-as", fileKind: "receipt" },
  });
  seeded = target.fileId;
  rows = await loadProjectFiles(own);
  receipt = rows.find((r) => r.fileId === seeded) ?? null;
}
const photo = rows.find((r) => r.folders.includes("gallery") && !r.folders.includes("costs") && r.copyFileId) ?? null;
const doc = rows.find((r) => !r.folders.includes("gallery") && r.copyFileId) ?? null;

const crafterGuides = guidesAny(await listProjectsFor(crafter.id));

// ── Test 3, first half: the admin's list ─────────────────────────────────
lines.push(`# admin ${adminEmail}`);
const list = await hit(admin.cookie, "the humans list", "GET", "/maker/projects?tab=humans", 200);
check("the list names the client", list.includes(clientEmail));
await setGroup(admin, guide.id, "Guide", "make the walk's guide a Guide");
check("the guide is Guide", (await roleOf(guide.id)) === "Guide");
await setGroup(admin, client.id, "Observer", "move the client to Observer");
check("the client is Observer", (await roleOf(client.id)) === "Observer");

// ── The client as an Observer: reads, suggests, doesn't move or file ─────
lines.push(`# client as Observer`);
await hit(client.cookie, "Costs tab, now given", "GET", `/newspaper/${ownId}?tab=costs`, 200);
await hit(client.cookie, "their Suggestions tab", "GET", `/newspaper/${ownId}?tab=suggestions`, 200);
await hit(client.cookie, "a move", "POST", "/api/graphlog/moves", 403, {
  projectFolderId: ownId,
  unitKey: "x",
  entryFileId: "x",
  destProjectFolderId: otherId,
});
await hit(client.cookie, "file a file", "POST", "/api/graphlog/file-marks", 403, {
  projectFolderId: ownId,
  fileId: "x",
  act: { kind: "file-as", fileKind: "photo" },
});

// What an Observer writes waits for a Guide: a Card and a note.
const day = new Date().toISOString().slice(0, 10);
const WORDS = "the walk suggests this";
const fed = async () => (await listCardsForProject(ownId)).find((c) => c.humanId === client.id && c.date === day)?.content ?? "";
await hit(client.cookie, "a Card on the project", "POST", "/daily-log", 200, { date: day, createCardForProject: ownId });
const suggested = (await getDailyLogCards(client.id, day)).find((c) => c.projectFolderId === ownId) ?? null;
check("the Card is a suggestion", !!suggested?.suggestion);
if (suggested) {
  // With a photo on it: a Guide has to see what they are deciding on.
  const shot = new FormData();
  shot.set("date", day);
  shot.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "campbell-suggests.png", { type: "image/png" }));
  const shotAnswer = await hit(client.cookie, "a photo for the Card", "POST", "/api/daily-log/upload", 201, shot);
  let photo: string | null = null;
  try {
    photo = (JSON.parse(shotAnswer) as { fileId?: string }).fileId ?? null;
  } catch {
    // The 201 above already failed.
  }
  check("the photo uploaded", !!photo);
  const CARD = photo ? `${WORDS}\n\n::file{name="campbell-suggests.png" caption fileId="${photo}" contentType="image/png"}\n` : WORDS;
  await hit(client.cookie, "write in it", "POST", "/daily-log", 200, { date: day, content: CARD, cardFileId: suggested.fileId });
  check("the project doesn't get it yet", (await fed()) === "");
  await hit(crafter.cookie, "a crafter takes it", "POST", "/api/graphlog/suggestions", 404, { projectFolderId: ownId, kind: "card", id: suggested.fileId, verdict: "take" });
  const tab = await hit(guide.cookie, "the guide's Suggestions tab", "GET", `/newspaper/${ownId}?tab=suggestions`, 200);
  check("the guide sees it", tab.includes(WORDS));
  if (photo) {
    // Served by redirect to storage (ADR-021), so the 302 is the success.
    await hit(guide.cookie, "the waiting Card's photo, for the guide", "GET", `/api/vault/rendition/${photo}?size=thumb`, 302);
    await hit(guide.cookie, "the waiting Card's photo, enlarged", "GET", `/api/vault/view/${photo}`, 302);
    await hit(crafter.cookie, "the waiting Card's photo, for a crafter", "GET", `/api/vault/rendition/${photo}?size=thumb`, 404);
  }
  await hit(guide.cookie, "the guide takes it", "POST", "/api/graphlog/suggestions", 200, { projectFolderId: ownId, kind: "card", id: suggested.fileId, verdict: "take" });
  check("the project gets it, as written", (await fed()) === CARD);
  // Taken, it is the project's, and the take's own sync copies it in.
  // The Card still names the writer's original, which is what the Logbook
  // and the Card's synced copy print: anyone on the project who asks for
  // that id is served the copy (`readableFile`).
  if (photo) {
    const copied = (await loadProjectFiles(own)).find((r) => r.fileId === photo);
    check("the take copied the photo into the project", !!copied && copied.serveId !== photo);
    // The crafter was refused a moment ago, and a refusal is reused for
    // five seconds (`REFUSAL_MS`, `featureAccess.server.ts`).
    await new Promise((r) => setTimeout(r, 5500));
    await hit(crafter.cookie, "the taken Card's photo, by the id the Card names, for a crafter", "GET", `/api/vault/rendition/${photo}?size=thumb`, 302);
    await hit(crafter.cookie, "the same, but the record stays its writer's", "GET", `/api/vault/${photo}`, 404);
  }
}
const readme = (await getReadmeFileForFolder(own.human_id, own._id))?.content ?? "";
const passage = pageMarkUnits(readme)[0];
if (passage) {
  await hit(client.cookie, "a note", "POST", "/api/graphlog/marks", 201, { projectFolderId: ownId, pageHash: pageHash(readme), unitKey: passage.key, text: WORDS });
  const note = (await listSuggestionMarks(ownId, client.id)).find((m) => m.text === WORDS && m.suggestion === "pending");
  check("the note is a suggestion", !!note);
  check("the page run doesn't read it", !(await listUnreadMarks(ownId)).some((m) => m._id === note?._id));
  if (note) {
    await hit(guide.cookie, "the guide passes it", "POST", "/api/graphlog/suggestions", 200, { projectFolderId: ownId, kind: "note", id: note._id, verdict: "pass" });
    check("still unread by the page run", !(await listUnreadMarks(ownId)).some((m) => m._id === note._id));
  }
} else lines.push("skip the note: the page has no passages");

await setGroup(admin, client.id, "Client", "move the client back to Client");
check("the client is Client", (await roleOf(client.id)) === "Client");

// ── Test 1: the client ───────────────────────────────────────────────────
lines.push(`# client ${clientEmail} on ${own.name}`);
await hit(client.cookie, "home, straight to My Project", "GET", "/", 302);
await hit(client.cookie, "daily log", "GET", "/daily-log", 200);
const page = await hit(client.cookie, "own project, Efforts", "GET", `/newspaper/${ownId}`, 200);
check("the page names no other project", !page.includes(other.name));
check("the page has no Vault link", !page.includes('href="/vault"'));
check("the page shows who's on the project", page.includes("data-project-people"));
const photosTab = await hit(client.cookie, "own project, Photos", "GET", `/newspaper/${ownId}?tab=photos`, 200);
check("Photos carries no cost", !photosTab.includes('"vendor"'));
if (receipt) check("Photos leaves out the receipt photo", !photosTab.includes(receipt.serveId));
if (photo) check("Photos carries the photo", photosTab.includes(photo.serveId));
await hit(client.cookie, "own Files tab, typed", "GET", `/newspaper/${ownId}?tab=files`, 404);
await hit(client.cookie, "own Costs tab, typed", "GET", `/newspaper/${ownId}?tab=costs`, 404);
await hit(client.cookie, "own Logbook, typed", "GET", `/newspaper/${ownId}?tab=logbook`, 404);
await hit(client.cookie, "other project page", "GET", `/newspaper/${otherId}`, 404);
await hit(client.cookie, "the Vault", "GET", "/vault", 404);
await hit(client.cookie, "own project in the Vault", "GET", `/vault?folder=${ownId}`, 404);
await hit(client.cookie, "own project's folders", "GET", `/api/vault/folders/${ownId}/children`, 404);
await hit(client.cookie, "a subfolder, guessed", "GET", `/api/vault/folders/${subfolder}/children`, 404);
await hit(client.cookie, "own project's people", "GET", `/api/vault/projects/${ownId}/sharing`, 404);
await hit(client.cookie, "own project's status", "GET", `/api/vault/projects/${ownId}/status`, 404);
await hit(client.cookie, "other project's status", "GET", `/api/vault/projects/${otherId}/status`, 404);
await hit(client.cookie, "invite someone", "POST", `/api/vault/projects/${ownId}/invite`, 404, { email: "x@example.com", role: "Client" });
await hit(client.cookie, "set own role", "PUT", `/api/vault/projects/${ownId}/sharing`, 404, { sharing: [] });
await hit(client.cookie, "the humans list", "GET", "/maker/projects?tab=humans", 403);
// The CLI and the API are the admins' (2026-09-29); a Client's profile
// carries neither and the server refuses both.
await hit(client.cookie, "the CLI login page", "GET", "/cli-login?port=4321&state=x", 403);
await hit(client.cookie, "mint an API token", "POST", "/profile", 403, form({ intent: "generate-api-token", name: "walk" }));
const profile = await hit(client.cookie, "their profile", "GET", "/profile", 200);
check("no CLI, tokens or invite on it", !profile.includes("CLI sessions") && !profile.includes("Personal access tokens") && !profile.includes('value="add-relationship"'));
if (photo) {
  await hit(client.cookie, "a photo, view", "GET", `/api/vault/view/${photo.serveId}`, 302);
  await hit(client.cookie, "a photo, thumbnail", "GET", `/api/vault/rendition/${photo.serveId}?size=thumb`, 302);
  await hit(client.cookie, "a photo, record", "GET", `/api/vault/${photo.serveId}`, 404);
  await hit(client.cookie, "a photo, in the Vault", "GET", `/vault?file=${photo.serveId}`, 404);
} else lines.push("skip a photo: none on the project");
for (const [what, id] of [
  ["a receipt photo", receipt?.serveId],
  ["a document", doc?.serveId],
  ["a file on another project", otherFile],
] as const) {
  if (!id) {
    lines.push(`skip ${what}: none found locally`);
    continue;
  }
  await hit(client.cookie, `${what}, view`, "GET", `/api/vault/view/${id}`, 404);
  await hit(client.cookie, `${what}, record`, "GET", `/api/vault/${id}`, 404);
  await hit(client.cookie, `${what}, download`, "GET", `/api/vault/download/${id}`, 404);
  await hit(client.cookie, `${what}, rendition`, "GET", `/api/vault/rendition/${id}`, 404);
}
// A Client leaves a note with the pen (ADR-026), and it lands as written;
// taking the client off later in the walk scraps it with the rest.
if (passage) {
  await hit(client.cookie, "a note with the pen", "POST", "/api/graphlog/marks", 201, {
    projectFolderId: ownId,
    pageHash: pageHash(readme),
    unitKey: passage.key,
    text: "the walk's client noted this",
  });
} else await hit(client.cookie, "a note with the pen (no passage)", "POST", "/api/graphlog/marks", 400, { projectFolderId: ownId, pageHash: pageHash(readme), unitKey: "x", text: "hello" });
await hit(client.cookie, "a move", "POST", "/api/graphlog/moves", 0, { projectFolderId: ownId });
await hit(client.cookie, "move options", "GET", `/api/graphlog/move-options?projectFolderId=${ownId}`, 404);
await hit(client.cookie, "a GraphLog run", "POST", "/api/graphlog/run", 404, { projectFolderId: ownId });
await hit(client.cookie, "own Steep tap", "POST", "/api/steep", 200, { projectFolderId: ownId, position: "uphill" });
await hit(client.cookie, "Steep on another project", "POST", "/api/steep", 404, { projectFolderId: otherId, position: "uphill" });
const upload = new FormData();
upload.set("date", new Date().toISOString().slice(0, 10));
upload.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "campbell-walk.png", { type: "image/png" }));
const up = await hit(client.cookie, "own attachment, upload", "POST", "/api/daily-log/upload", 201, upload);
const upId = (() => {
  try {
    const j = JSON.parse(up);
    return j.fileRef?._id ?? j.file?._id ?? j._id ?? j.fileId ?? null;
  } catch {
    return null;
  }
})();
// Served by redirect to storage (ADR-021), so the 302 is the success.
if (upId) await hit(client.cookie, "own attachment, loads", "GET", `/api/vault/view/${upId}`, 302);
else lines.push(`skip own attachment, loads: upload answered ${up.slice(0, 120)}`);

// ── Test 9: the crafter ──────────────────────────────────────────────────
lines.push(`# crafter ${crafterEmail}`);
await hit(crafter.cookie, "project page", "GET", `/newspaper/${ownId}`, 200);
await hit(crafter.cookie, "Suggestions, typed", "GET", `/newspaper/${ownId}?tab=suggestions`, 404);
await hit(crafter.cookie, "Photos", "GET", `/newspaper/${ownId}?tab=photos`, 200);
await hit(crafter.cookie, "Files", "GET", `/newspaper/${ownId}?tab=files`, 200);
const costs = await hit(crafter.cookie, "Costs tab", "GET", `/newspaper/${ownId}?tab=costs`, 200);
if (receipt) check("Costs carries the receipt photo", costs.includes(receipt.serveId));
await hit(crafter.cookie, "Logbook", "GET", `/newspaper/${ownId}?tab=logbook`, 200);
if (receipt) await hit(crafter.cookie, "the receipt photo", "GET", `/api/vault/view/${receipt.serveId}`, 302);
if (doc) await hit(crafter.cookie, "a document's record", "GET", `/api/vault/${doc.serveId}`, 200);
await hit(crafter.cookie, "another project", "GET", `/newspaper/${otherId}`, 404);
await hit(crafter.cookie, "the people list", "GET", `/api/vault/projects/${ownId}/sharing`, 404);
await hit(crafter.cookie, "invite someone", "POST", `/api/vault/projects/${ownId}/invite`, 404, { email: "x@example.com", role: "Client" });
if (crafter.role === "Human") await hit(crafter.cookie, "the humans list", "GET", "/maker/projects?tab=humans", crafterGuides ? 404 : 403);

// ── Test 4: a Guide who isn't an admin ───────────────────────────────────
lines.push(`# guide ${guideEmail}`);
await hit(guide.cookie, "project page", "GET", `/newspaper/${ownId}`, 200);
await hit(guide.cookie, "the people list", "GET", `/api/vault/projects/${ownId}/sharing`, 200);
await putSharing(guide, { [client.id]: "Observer" }, "regroup the client to Observer", 200);
await putSharing(guide, { [client.id]: "Client" }, "and back to Client", 200);
check("the client is Client again", (await roleOf(client.id)) === "Client");
await putSharing(guide, { [crafter.id]: "Guide" }, "make the crafter a Guide", 403);
await putSharing(guide, { [admin.id]: "Crafter" }, "put an admin on the project", 403);
await hit(guide.cookie, "invite a Guide", "POST", `/api/vault/projects/${ownId}/invite`, 403, { email: crafterEmail, role: "Guide" });
await hit(guide.cookie, "another project's people", "GET", `/api/vault/projects/${otherId}/sharing`, 404);
await hit(guide.cookie, "the humans list (a tab a Guide isn't given)", "GET", "/maker/projects?tab=humans", 404);
check("the crafter is still what they were", (await roleOf(crafter.id)) === (before.find((e) => e.human === crafter.id)?.role ?? null));

// ── The Maker: the guide's own projects, and nobody else's Maker ────────
lines.push(`# the Maker`);
const makerPage = await hit(guide.cookie, "the Maker", "GET", "/maker", 200);
check("the Maker has the tile and no stats or usage", makerPage.includes("data-maker-tile") && !makerPage.includes("General Stats") && !makerPage.includes("GraphLog Usage"));
const projectsPage = await hit(guide.cookie, "Projects and humans", "GET", "/maker/projects", 200);
check("it lists the guide's project", projectsPage.includes(`data-maker-project="${ownId}"`));
check("and not the other one", !projectsPage.includes(`data-maker-project="${otherId}"`) && !projectsPage.includes(other.name));
check("and offers no Humans tab", !projectsPage.includes('data-tab="humans"'));
await hit(guide.cookie, "own project in the Maker", "GET", `/maker/projects/${ownId}`, 200);
await hit(guide.cookie, "the other project in the Maker", "GET", `/maker/projects/${otherId}`, 404);
await hit(guide.cookie, "regroup the client through the Maker", "POST", `/maker/projects/${ownId}`, 200, form({ humanId: client.id, group: "Observer" }));
check("the client is Observer", (await roleOf(client.id)) === "Observer");
await hit(guide.cookie, "and back", "POST", `/maker/projects/${ownId}`, 200, form({ humanId: client.id, group: "Client" }));
check("the client is Client again", (await roleOf(client.id)) === "Client");
await hit(guide.cookie, "make the crafter a Guide through the Maker", "POST", `/maker/projects/${ownId}`, 200, form({ humanId: crafter.id, group: "Guide" }));
check("refused: the crafter is not a Guide", (await roleOf(crafter.id)) !== "Guide");
await hit(crafter.cookie, crafterGuides ? "the Maker (the crafter guides elsewhere)" : "the Maker", "GET", "/maker", crafterGuides ? 200 : 403);
await hit(crafter.cookie, "this project in the Maker", "GET", `/maker/projects/${ownId}`, 404);
await hit(client.cookie, "the Maker", "GET", "/maker", 403);
await hit(client.cookie, "this project in the Maker", "GET", `/maker/projects/${ownId}`, 404);
// Someone guiding nothing can't start a project, from any route.
const clientRoot = (await ensureVaultRootFolders(client.id)).find((r) => r.vault_root_key === "projects");
if (clientRoot) await hit(client.cookie, "start a project in the Vault", "POST", "/api/vault/folders", 403, { name: "the walk's project", parent_folder_id: clientRoot._id });
await hit(client.cookie, "start a project in the Maker", "POST", "/maker/projects", 403, form({ intent: "start", name: "the walk's project" }));

// ── Taken off, the client's Card from today is scrapped ─────────────────
lines.push(`# the client comes off`);
const today = new Date().toISOString().slice(0, 10);
await hit(client.cookie, "a Card on the project", "POST", "/daily-log", 200, { date: today, createCardForProject: ownId });
const ownCard = async () => (await getDailyLogCards(client.id, today)).find((c) => c.projectFolderId === ownId) ?? null;
const written = await ownCard();
if (written) {
  await hit(client.cookie, "write in it", "POST", "/daily-log", 200, { date: today, content: "the walk wrote this", cardFileId: written.fileId });
  check("the Card has words", (await ownCard())?.content === "the walk wrote this");
  await setGroup(admin, client.id, "", "take the client off");
  check("the client is off", (await roleOf(client.id)) === null);
  check("the Card is empty", (await ownCard())?.content === "");
  const again = await hit(client.cookie, "write in it again", "POST", "/daily-log", 200, { date: today, content: "back again", cardFileId: written.fileId });
  check("refused, still empty", again.includes("not writing to that project") && (await ownCard())?.content === "");
  await setGroup(admin, client.id, "Client", "put the client back");
  check("the client is Client", (await roleOf(client.id)) === "Client");
} else check("the client's Card was made", false);

// ── The creator comes off only once someone else is the Guide ───────────
// Putting them back names them on the list, where before they may have
// been Guide by default: the same people, one more line in the README.
const creator = own.human_id;
const creatorBefore = before.find((e) => e.human === creator)?.role ?? "Guide";
if (creator !== guide.id) {
  lines.push(`# the creator`);
  await setGroup(admin, creator, "", "take the creator off while the guide is Guide");
  check("the creator is off", (await roleOf(creator)) === null);
  await setGroup(admin, creator, creatorBefore, "put the creator back");
  check("the creator is back", (await roleOf(creator)) === creatorBefore);
}

// ── Seeding (2026-09-29, folded 2026-10-01): the push route is gone ──────
// The seed packet is the one door; a prepared day goes through it below.
// An admin wipes; a guide and a crafter cannot.
await hit(guide.cookie, "seed: the push route is gone, even for a guide", "POST", "/api/graphlog/seed", 404, { projectFolderId: ownId, days: [] });

// ── The Budget (2026-09-29): a view under Costs for Guides alone ────────
// The project may already have a budget (a start is refused twice), so
// the walk asserts the doors and never writes a line.
await hit(guide.cookie, "budget: the guide opens the view", "GET", `/newspaper/${ownId}?tab=costs&view=budget`, 200);
for (const [who, label] of [[crafter, "a crafter"], [client, "a client"]] as const) {
  await hit(who.cookie, `budget: ${label} typing the URL`, "GET", `/newspaper/${ownId}?tab=costs&view=budget`, 404);
  // Both are on the project, so the API says 403, not 404 (a 404 is for
  // someone with no role at all).
  await hit(who.cookie, `budget: ${label} on the API`, "POST", "/api/budget", 403, { act: "change", projectFolderId: ownId, key: "hvac", estimate: 1 });
}
await hit(guide.cookie, "budget: a line nobody started", "POST", "/api/budget", 404, { act: "change", projectFolderId: ownId, key: "no-such-line", estimate: 1 });
await hit(guide.cookie, "budget: a table that doesn't fit is refused", "POST", "/api/budget", 400, { act: "start", projectFolderId: ownId, asOf: "2026-04-22", table: "| line item | cost estimate | confidence |\n|---|---|---|\n| solar | $1 | 0.5 |\n" });

// ── Seed packets (2026-09-30): a packet is its owner's and the Guides' ───
// The guide opens a round; the client adds a file; nobody but the client
// and the guides can open it; only a guide sows or ends the round.
await hit(crafter.cookie, "packets: a crafter can't open a round", "POST", "/api/seed-round", 404, { projectFolderId: ownId, act: "open" });
await hit(guide.cookie, "packets: the guide opens a round", "POST", "/api/seed-round", 200, { projectFolderId: ownId, act: "open" });
// A prepared day (seed shape, `kind: seed`) in the guide's packet is placed
// by code, no model: the seed day exists after Sow, and only an admin can
// wipe it. The job is followed through its id like any GraphLog job.
const SEED_DAY = `---\ndate: 2020-01-01\nproject: walk\nkind: seed\n---\n\n## Walker\n\n- The walk seeded a line.\n  - src: the walk\n\n## Noted (not anyone's words)\n\n- The walk noted a fact.\n`;
const preparedForm = new FormData();
preparedForm.append("projectFolderId", ownId);
preparedForm.append("file", new File([SEED_DAY], "2020-01-01.md", { type: "text/markdown" }));
await hit(guide.cookie, "seed: the guide adds a prepared day to their packet", "POST", "/api/seed-packet", 201, preparedForm);
const sowStarted = await hit(guide.cookie, "seed: the guide sows", "POST", "/api/graphlog/sow", 202, { projectFolderId: ownId });
const sowJobId = (() => { try { return (JSON.parse(sowStarted) as { jobId?: string }).jobId ?? null; } catch { return null; } })();
let sowDone: { state?: string; result?: { lines?: number; days?: string[] } } = {};
if (sowJobId) {
  for (let i = 0; i < 60 && sowDone.state !== "completed" && sowDone.state !== "failed"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    sowDone = JSON.parse(await hit(guide.cookie, "seed: following the sow job", "GET", `/api/graphlog/jobs/${sowJobId}`, 200)) as typeof sowDone;
    lines.pop();
  }
}
check("seed: the prepared day was placed by code (2 lines, one day)", sowDone.state === "completed" && sowDone.result?.lines === 2 && (sowDone.result?.days ?? []).includes("2020-01-01"));
await hit(guide.cookie, "seed: the guide reads it in the Logbook", "GET", `/newspaper/${ownId}?tab=logbook`, 200);
await hit(client.cookie, "seed: no Logbook for a client", "GET", `/newspaper/${ownId}?tab=logbook`, 404);
await hit(guide.cookie, "seed: the guide can't wipe it", "POST", "/api/graphlog/seed-wipe", 404, { projectFolderId: ownId });
await hit(crafter.cookie, "seed: nor a crafter", "POST", "/api/graphlog/seed-wipe", 404, { projectFolderId: ownId });
await hit(admin.cookie, "seed: the admin wipes it", "POST", "/api/graphlog/seed-wipe", 200, { projectFolderId: ownId });
// The wipe put the prepared file back to waiting; take it out so the round can end clean.
for (const f of await listPacketFiles(ownId)) if (f.name === "2020-01-01.md") await removePacketFile(f._id);

const packetForm = new FormData();
packetForm.append("projectFolderId", ownId);
packetForm.append("file", new File(["8/2 Walker: the walk added a line.\n"], "walk-thread.txt", { type: "text/plain" }));
const added = await hit(client.cookie, "packets: the client adds a file to their packet", "POST", "/api/seed-packet", 201, packetForm);
const packetId = (() => { try { return (JSON.parse(added) as { id?: string }).id ?? null; } catch { return null; } })();
check("packets: the file was added", !!packetId);
if (packetId) {
  await hit(client.cookie, "packets: the client opens their own file", "GET", `/api/seed-packet/${packetId}`, 200);
  await hit(guide.cookie, "packets: a guide opens it", "GET", `/api/seed-packet/${packetId}`, 200);
  await hit(crafter.cookie, "packets: a crafter can't", "GET", `/api/seed-packet/${packetId}`, 404);
  await hit(crafter.cookie, "packets: a crafter can't take it out", "POST", "/api/seed-packet", 404, { act: "remove", id: packetId });
  await hit(crafter.cookie, "packets: a crafter can't sow", "POST", "/api/graphlog/sow", 404, { projectFolderId: ownId });
  await hit(client.cookie, "packets: a client can't sow", "POST", "/api/graphlog/sow", 404, { projectFolderId: ownId });
  await hit(client.cookie, "packets: a client can't end the round", "POST", "/api/seed-round", 404, { projectFolderId: ownId, act: "end" });
  await hit(client.cookie, "packets: the client takes it back out", "POST", "/api/seed-packet", 200, { act: "remove", id: packetId });
}
await hit(guide.cookie, "packets: the guide ends the round (nothing left to sow)", "POST", "/api/seed-round", 200, { projectFolderId: ownId, act: "end" });
const lateForm = new FormData();
lateForm.append("projectFolderId", ownId);
lateForm.append("file", new File(["late"], "late.txt", { type: "text/plain" }));
await hit(client.cookie, "packets: nothing is added once the round is ended", "POST", "/api/seed-packet", 409, lateForm);

// ── Put everything back ──────────────────────────────────────────────────
const guideBefore = before.find((e) => e.human === guide.id)?.role ?? "";
await setGroup(admin, guide.id, guideBefore, "put the guide back");
const guides = (await getProjectSharing(own)).filter((e) => e.role === "Guide").map((e) => e.human);
if (guides.length === 1 && guides[0] === creator) {
  await setGroup(admin, creator, "", "take the creator off with nobody else Guide");
  check("refused: the creator is still on", (await roleOf(creator)) === creatorBefore);
} else {
  lines.push(`skip the creator refusal: the project has other Guides`);
}
if (seeded) {
  await hit(crafter.cookie, "seed: file the receipt back as a photo", "POST", "/api/graphlog/file-marks", 201, {
    projectFolderId: ownId,
    fileId: seeded,
    act: { kind: "file-as", fileKind: "photo" },
  });
}
const after = await getProjectSharing(own);
const key = (l: { human: string; role: string }[]) => JSON.stringify([...l].sort((x, y) => x.human.localeCompare(y.human)));
check("the project's people are as they were", key(after) === key(before));

console.log(lines.join("\n"));
console.log(failures ? `\n${failures} FAILED` : "\nall held");
process.exit(failures ? 1 : 0);
