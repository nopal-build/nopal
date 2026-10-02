// webapp/scripts/graphlog-health.ts
//
// Read-only. Which projects run at night, what their skill files are, and
// what their last runs left unfinished, in one report (2026-10-02, after
// "multiple incomplete graphlog runs from last night").
//
// Writes nothing. Against production:
//   make migrate-prod SCRIPT=graphlog-health.ts
// Locally, from webapp/:
//   npx vite-node scripts/graphlog-health.ts [--since=2026-10-01T20:00Z]
//
// Per project: whether it is on the nightly list, and each seeded skill
// file as one of
//   current   the current default, word for word
//   edited    something else (a person's own, or an older default)
//   skip      first line `skip`: the stage is off (KNOWLEDGE.md seeded
//             this way before 2026-09-09, so an old project can be off
//             without anyone choosing it)
//   MISSING   no file: the stage is skipped and the run says so
// plus any legacy file still sitting beside its successor. Then each run
// since `--since` (default: the last 24 hours) with its outcome and the
// lines it left in `incomplete`, grouped by kind so forty days of the same
// line read as one.
import { query } from "robustness-core/data/generic.server";
import { listFolderChildren, type VaultFolder } from "robustness-core/data/vault.server";
import { getFileRefById } from "robustness-core/data/vault.server";
import { SKILL_FILE_NAMES, classifyStageSkill } from "robustness-core/data/projectN02.server";
import { getAllEffectiveGraphLogDefaultSkills } from "robustness-core/data/graphLogDefaults.server";
import { getGraphLogScheduledFolders } from "robustness-core/data/graphLogSchedule.server";
import type { GraphLogDefaultStage } from "robustness-core/data/graphLogDefaults.server";

const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.slice("--since=".length);
const since = sinceArg ? new Date(sinceArg) : new Date(Date.now() - 24 * 3600 * 1000);

type Folder = VaultFolder & { graphlog_scheduled?: boolean };

const projects = (
  await query<[Folder[]]>(
    `SELECT * FROM vault_folders WHERE folder_type = 'project-n02' AND is_folder_type_root = true AND name != 'personal' ORDER BY name`,
  )
)[0].map((f) => ({ ...f, _id: String((f as unknown as { id: { id: string } }).id.id) }));
const nightly = new Set((await getGraphLogScheduledFolders()).map((f) => f._id));
const defaults = await getAllEffectiveGraphLogDefaultSkills();
const stages = Object.keys(SKILL_FILE_NAMES) as GraphLogDefaultStage[];
const LEGACY = ["PROJECT_VIEW.md"];

console.log(`GraphLog health, runs since ${since.toISOString()}\n`);
const missingTally = new Map<string, number>();
const skipTally = new Map<string, number>();

for (const project of projects) {
  const { folders } = await listFolderChildren(project.human_id, project._id);
  const skills = folders.find((f) => f.is_folder_type_root && f.folder_type === "skills");
  const files = skills ? (await listFolderChildren(project.human_id, skills._id)).files : [];

  const states: string[] = [];
  for (const stage of stages) {
    const name = SKILL_FILE_NAMES[stage];
    const listing = files.find((f) => f.name.toLowerCase() === name.toLowerCase());
    const content = listing ? ((await getFileRefById(listing._id))?.content ?? "") : null;
    const kind = classifyStageSkill(content);
    const state = kind === "missing" ? "MISSING" : kind === "skip" ? "skip" : content === defaults[stage].content ? "current" : "edited";
    if (state === "MISSING") missingTally.set(name, (missingTally.get(name) ?? 0) + 1);
    if (state === "skip") skipTally.set(name, (skipTally.get(name) ?? 0) + 1);
    states.push(`${name.replace(".md", "")} ${state}`);
  }
  const legacy = LEGACY.filter((l) => files.some((f) => f.name.toLowerCase() === l.toLowerCase()));

  const runs = (
    await query<[{ job_name: string; started_at: string; finished_at: string | null; ok: boolean | null; error: string | null; incomplete: string[] | null }[]]>(
      `SELECT job_name, started_at, finished_at, ok, error, incomplete FROM graphlog_runs
       WHERE project_folder_id = $pid AND started_at >= $since ORDER BY started_at`,
      { pid: project._id, since: since.toISOString() },
    )
  )[0];

  console.log(`## ${project.name}${nightly.has(project._id) ? " (nightly)" : ""}${skills ? "" : " (no Skills folder)"}`);
  console.log(`   skills: ${states.join(", ")}${legacy.length ? ` · legacy: ${legacy.join(", ")}` : ""}`);
  if (runs.length === 0) console.log("   runs: none");
  for (const run of runs) {
    const outcome =
      run.ok === null ? "STILL RUNNING (or died)" : run.ok === false ? `FAILED: ${run.error ?? "no error recorded"}` : run.incomplete?.length ? "incomplete" : "ok";
    console.log(`   run ${run.started_at.slice(0, 16)} ${run.job_name}: ${outcome}`);
    // One line per kind: the date prefix (`2026-09-12: `) and counts vary,
    // the reason doesn't.
    const kinds = new Map<string, number>();
    for (const line of run.incomplete ?? []) {
      const kind = line.replace(/^\d{4}-\d{2}-\d{2}: /, "").replace(/\d+/g, "N");
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    for (const [kind, n] of kinds) console.log(`      ${n > 1 ? `${n}x ` : ""}${kind}`);
  }
  console.log("");
}

console.log("## Across projects");
console.log(`   missing: ${[...missingTally].map(([f, n]) => `${f} ${n}`).join(", ") || "none"}`);
console.log(`   skip: ${[...skipTally].map(([f, n]) => `${f} ${n}`).join(", ") || "none"}`);
process.exit(0);
