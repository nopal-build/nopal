// Test 1 of the 2026-09-24 user types round (ADR-023): signed in as a
// Client on one project, every surface refuses (a 404 that names
// nothing), for another project and for everything on their own project
// that clients aren't given, guessed ids and typed URLs included. What a
// person needs to be a person still works: the dashboard, the Daily Log,
// their own Steep tap, their own attachment. Then the controls: a
// Crafter (the Nopalito level, not an admin) on the same project reaches
// its work and not its people side (test 4), and the Owner reaches
// everything.
//
// From fruits/, against a running local stack (or production with a test
// account, by HOST):
//   source ../webapp/.env; unset SESSION_SECRET
//   npx vite-node scripts/campbell-walk.ts <clientEmail> <nopalitoEmail> <guideEmail> <ownProjectId> <otherProjectId>
import { query } from "robustness-core/data/generic.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getHumanByEmail } from "robustness-core/data/humans.server";
import { sessionStorage } from "../app/modules/auth/session.server";

const [clientEmail, nopalitoEmail, guideEmail, ownId, otherId] = process.argv.slice(2);
const HOST = process.env.HOST ?? "http://localhost:3001";
if (!otherId) {
  console.error("usage: campbell-walk.ts <client> <nopalito> <guide> <ownProjectId> <otherProjectId>");
  process.exit(1);
}

async function cookieFor(email: string): Promise<string> {
  const human = await getHumanByEmail(email);
  if (!human) throw new Error(`no person ${email}`);
  const session = await sessionStorage.getSession();
  session.set("user", human);
  session.set("sessionIssuedAt", Date.now());
  return (await sessionStorage.commitSession(session)).split(";")[0];
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
const ownFile = await fileUnder(ownId, `AND name != "README.md"`);
const otherFile = await fileUnder(otherId);
const costFile = await fileUnder(ownId, `AND string::contains(name, "cost")`);
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

// ── The client ───────────────────────────────────────────────────────────
const client = await cookieFor(clientEmail);
lines.push(`# client ${clientEmail} on ${own.name}`);
const dash = await hit(client, "dashboard", "GET", "/", 200);
for (const s of [other.name, "/newspaper/"]) {
  if (dash.includes(s)) {
    failures++;
    lines.push(`FAIL dashboard carries "${s}"`);
  }
}
await hit(client, "daily log", "GET", "/daily-log", 200);
await hit(client, "own project page", "GET", `/newspaper/${ownId}`, 404);
await hit(client, "own Costs tab, typed", "GET", `/newspaper/${ownId}?tab=costs`, 404);
await hit(client, "own Logbook, typed", "GET", `/newspaper/${ownId}?tab=logbook`, 404);
await hit(client, "other project page", "GET", `/newspaper/${otherId}`, 404);
await hit(client, "the Vault", "GET", "/vault", 404);
await hit(client, "own project in the Vault", "GET", `/vault?folder=${ownId}`, 404);
await hit(client, "own project's folders", "GET", `/api/vault/folders/${ownId}/children`, 404);
await hit(client, "a subfolder, guessed", "GET", `/api/vault/folders/${subfolder}/children`, 404);
await hit(client, "own project's people", "GET", `/api/vault/projects/${ownId}/sharing`, 404);
await hit(client, "own project's status", "GET", `/api/vault/projects/${ownId}/status`, 404);
await hit(client, "other project's status", "GET", `/api/vault/projects/${otherId}/status`, 404);
await hit(client, "invite someone", "POST", `/api/vault/projects/${ownId}/invite`, 404, { email: "x@example.com", role: "client" });
await hit(client, "set own role", "PUT", `/api/vault/projects/${ownId}/sharing`, 404, { sharing: [] });
for (const [what, id] of [["a file on own project", ownFile], ["a cost file", costFile], ["a file on another project", otherFile]] as const) {
  if (!id) {
    lines.push(`skip ${what}: none found locally`);
    continue;
  }
  await hit(client, `${what}, view`, "GET", `/api/vault/view/${id}`, 404);
  await hit(client, `${what}, record`, "GET", `/api/vault/${id}`, 404);
  await hit(client, `${what}, download`, "GET", `/api/vault/download/${id}`, 404);
  await hit(client, `${what}, rendition`, "GET", `/api/vault/rendition/${id}`, 404);
  await hit(client, `${what}, in the Vault`, "GET", `/vault?file=${id}`, 404);
}
await hit(client, "a mark", "POST", "/api/graphlog/marks", 404, { projectFolderId: ownId, pageHash: "x", unitKey: "x", text: "hello" });
await hit(client, "a move", "POST", "/api/graphlog/moves", 0, { projectFolderId: ownId });
await hit(client, "move options", "GET", `/api/graphlog/move-options?projectFolderId=${ownId}`, 404);
await hit(client, "a GraphLog run", "POST", "/api/graphlog/run", 404, { projectFolderId: ownId });
await hit(client, "own Steep tap", "POST", "/api/steep", 200, { projectFolderId: ownId, position: "uphill" });
await hit(client, "Steep on another project", "POST", "/api/steep", 404, { projectFolderId: otherId, position: "uphill" });
// Their own attachment: upload to today, then load it back.
const form = new FormData();
form.set("date", new Date().toISOString().slice(0, 10));
form.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "campbell-walk.png", { type: "image/png" }));
const up = await hit(client, "own attachment, upload", "POST", "/api/daily-log/upload", 201, form);
const upId = (() => {
  try {
    const j = JSON.parse(up);
    return j.fileRef?._id ?? j.file?._id ?? j._id ?? j.fileId ?? null;
  } catch {
    return null;
  }
})();
// Served by redirect to storage (ADR-021), so the 302 is the success;
// a refusal would be a 404.
if (upId) await hit(client, "own attachment, loads", "GET", `/api/vault/view/${upId}`, 302);
else lines.push(`skip own attachment, loads: upload answered ${up.slice(0, 120)}`);

// ── The Nopalito, working on the same project (test 4) ───────────────────
const nopalito = await cookieFor(nopalitoEmail);
lines.push(`# nopalito ${nopalitoEmail}`);
await hit(nopalito, "project page", "GET", `/newspaper/${ownId}`, 200);
await hit(nopalito, "Costs tab", "GET", `/newspaper/${ownId}?tab=costs`, 200);
await hit(nopalito, "Logbook", "GET", `/newspaper/${ownId}?tab=logbook`, 200);
if (costFile) await hit(nopalito, "a cost file's record", "GET", `/api/vault/${costFile}`, 200);
if (ownFile) await hit(nopalito, "a file's record", "GET", `/api/vault/${ownFile}`, 200);
await hit(nopalito, "another project", "GET", `/newspaper/${otherId}`, 404);
await hit(nopalito, "the people list", "GET", `/api/vault/projects/${ownId}/sharing`, 404);
await hit(nopalito, "invite someone", "POST", `/api/vault/projects/${ownId}/invite`, 404, { email: "x@example.com", role: "client" });

// ── The guide ────────────────────────────────────────────────────────────
const guide = await cookieFor(guideEmail);
lines.push(`# guide ${guideEmail}`);
await hit(guide, "project page", "GET", `/newspaper/${ownId}`, 200);
await hit(guide, "the people list", "GET", `/api/vault/projects/${ownId}/sharing`, 200);
if (ownFile) await hit(guide, "a file's record", "GET", `/api/vault/${ownFile}`, 200);

console.log(lines.join("\n"));
console.log(failures ? `\n${failures} FAILED` : "\nall held");
process.exit(failures ? 1 : 0);
