// The Janitor's report. Read-only: it reads git and prints markdown to
// stdout, and prints nothing when no watched file changed.
//
// Usage (from webapp/): vite-node scripts/janitor/run.ts [--base <ref>] [--head <ref>]
//
//   --base  what to compare against. Default: origin/$GITHUB_BASE_REF in
//           CI, origin/main otherwise. The comparison is against the MERGE
//           BASE with this ref, so a branch that is merely behind main
//           reports nothing.
//   --head  a commit to read instead of the working tree, for replaying
//           history: `--base b50c6ce --head f8c6977` is PR #52's cut.
//
// Exits 0 whatever it finds. A finding is for a person to read, not a gate.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Finding } from "./types";
import { extractRuntimeSkills, watchedFilesChanged, type WatchedFile } from "./checks/watchedFiles";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RUNTIME_SKILLS_PATH = "packages/robustness-core/src/data/graphLogDefaults.server.ts";
const AGENT_SKILLS_DIR = ".agents/skills";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** A file's text at a commit, or `null` when it did not exist there. */
function showAt(ref: string, file: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function agentSkillPathsAt(ref: string): string[] {
  return git("ls-tree", "-r", "--name-only", ref, AGENT_SKILLS_DIR)
    .split("\n")
    .filter((p) => p.endsWith("/SKILL.md"));
}

function main() {
  const baseRef = arg("--base") ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
  const headRef = arg("--head");
  const mergeBase = git("merge-base", baseRef, headRef ?? "HEAD").trim();

  // With no --head the working tree is what is about to be committed, so
  // read that; an uncommitted edit to a skill is still a change.
  const readHead = (file: string): string | null => {
    if (headRef) return showAt(headRef, file);
    const full = path.join(REPO_ROOT, file);
    return existsSync(full) ? readFileSync(full, "utf8") : null;
  };

  const watched: WatchedFile[] = [];

  const skillsBefore = extractRuntimeSkills(showAt(mergeBase, RUNTIME_SKILLS_PATH) ?? "");
  const skillsAfter = extractRuntimeSkills(readHead(RUNTIME_SKILLS_PATH) ?? "");
  for (const name of new Set([...skillsBefore.keys(), ...skillsAfter.keys()])) {
    watched.push({ subject: name, before: skillsBefore.get(name) ?? null, after: skillsAfter.get(name) ?? null });
  }

  const agentPaths = new Set([...agentSkillPathsAt(mergeBase), ...agentSkillPathsAt(headRef ?? "HEAD")]);
  for (const file of [...agentPaths].sort()) {
    watched.push({ subject: file.slice(AGENT_SKILLS_DIR.length + 1), before: showAt(mergeBase, file), after: readHead(file) });
  }

  const findings: Finding[] = [...watchedFilesChanged(watched)];
  if (findings.length === 0) return;

  const lines = [
    "### Janitor",
    "",
    `Text a model or an agent reads changed in this branch (against \`${mergeBase.slice(0, 7)}\`). Nothing here is a verdict on the change. It is here so the change is seen: read the diff of each file below before this merges.`,
    "",
    ...findings.map((f) => `- \`${f.subject}\`: ${f.message}`),
  ];
  console.log(lines.join("\n"));
}

main();
