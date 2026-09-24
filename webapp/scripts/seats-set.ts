// Sets seats (ADR-022) from lines `project_id<TAB>email<TAB>seat`, read
// from the file named on the command line: only the lines Austin marked.
// Changes nothing but the `seat` on each named person's sharing entry
// (their Sharing Role and access are untouched), and prints each change.
// Pass --dry to print without writing.
//
//   npx tsx scripts/seats-set.ts marked.tsv --dry
//   npx tsx scripts/seats-set.ts marked.tsv
import { readFileSync } from "node:fs";
import { getHumanByEmail } from "robustness-core/data/humans.server";
import { isProjectSeat, parseProjectSharing, withProjectSharing } from "robustness-core/data/project.types";
import { getFolderById, getReadmeFileForFolder, updateFileRef } from "robustness-core/data/vault.server";

const file = process.argv[2];
const dry = process.argv.includes("--dry");
if (!file) throw new Error("usage: seats-set.ts <marked.tsv> [--dry]");

const lines = readFileSync(file, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#") && !l.startsWith("project_id"));

let problems = 0;
for (const line of lines) {
  const [projectId, email, seat] = line.split("\t").map((s) => s?.trim());
  if (!projectId || !email || !isProjectSeat(seat)) {
    console.error(`skip (expected project_id, email, guide|client|observer): ${line}`);
    problems++;
    continue;
  }
  const folder = await getFolderById(projectId);
  const human = await getHumanByEmail(email);
  if (!folder || !human) {
    console.error(`skip (no such ${folder ? "person" : "project"}): ${line}`);
    problems++;
    continue;
  }
  const readme = await getReadmeFileForFolder(folder.human_id, folder._id);
  const sharing = parseProjectSharing(readme?.content ?? "");
  const entry = sharing.find((s) => s.human === human._id);
  if (!readme || !entry) {
    console.error(`skip (${email} is not shared on ${folder.name}; seats go on existing members only): ${line}`);
    problems++;
    continue;
  }
  if (entry.seat === seat) continue;
  console.log(`${folder.name}: ${email} ${entry.seat ?? "unmarked"} -> ${seat}${dry ? " (dry)" : ""}`);
  if (dry) continue;
  const next = sharing.map((s) => (s.human === human._id ? { ...s, seat } : s));
  await updateFileRef(readme._id, { content: withProjectSharing(readme.content ?? "", next) });
}
if (problems) console.error(`${problems} line(s) skipped`);
process.exit(problems ? 1 : 0);
