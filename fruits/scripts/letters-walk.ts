// A project to walk letters between houses by hand on the dev stack
// (letter-mailbox seed, 2026-11-05). Pulled data is not a fixture for
// this: it has no second client, and its access cache comes back empty.
// This makes a "Letters walk" project with two guides, a crafter and two
// clients, through `writeProjectSharing`, the same writer the invite flow
// ends in, so the cache the Vault's gates read is built with the list.
//
// austin@nopal.build (local admin_1) is the first Guide and staff. The
// second Guide is a plain Human, so a guide who is not staff is walked
// too. Everyone else signs in by code through Mailpit, each in their own
// private window. Run again, it finds what it made; `--remove` takes the
// project, its letters' flags and the four people away.
//
// From fruits/, with the dev stack up:
//   DATABASE_USERNAME=root DATABASE_PASSWORD=root npx vite-node scripts/letters-walk.ts [--remove]
import { query } from "robustness-core/data/generic.server";
import { createHuman, deleteHuman, getHumanByEmail, getHumanById, type Human } from "robustness-core/data/humans.server";
import { writeProjectSharing } from "robustness-core/data/projectSharing.server";
import { createVaultFolder, deleteVaultFolderCascade, ensureVaultRootFolders, listFolderChildren } from "robustness-core/data/vault.server";

const NAME = "Letters walk";
const APP = "http://localhost:3001";
const PEOPLE = [
  { email: "walk-guide@example.com", name: "Gwen Guide", role: "Guide" },
  { email: "walk-crafter@example.com", name: "Cal Crafter", role: "Crafter" },
  { email: "walk-client-a@example.com", name: "Ana Client", role: "Client" },
  { email: "walk-client-b@example.com", name: "Ben Client", role: "Client" },
] as const;

async function main() {
  const austin = (await getHumanById("admin_1")) as Human;
  const root = (await ensureVaultRootFolders(austin._id)).find((r) => r.vault_root_key === "projects")!;
  const existing = (await listFolderChildren(austin._id, root._id)).folders.find((f) => f.name === NAME);

  if (process.argv.includes("--remove")) {
    if (existing) {
      // The flags table exists only once a letter has been sent.
      await query(`DELETE letter_flags WHERE project_folder_id = $f`, { f: existing._id }).catch(() => undefined);
      await deleteVaultFolderCascade(existing._id);
    }
    for (const person of PEOPLE) {
      const human = await getHumanByEmail(person.email);
      if (human) await deleteHuman(human._id);
    }
    console.log("Removed the letters walk.");
    process.exit(0);
  }

  const humans: Human[] = [];
  for (const person of PEOPLE) {
    humans.push((await getHumanByEmail(person.email)) ?? (await createHuman({ email: person.email, name: person.name, role: "Human" }))!);
  }
  const folder = existing ?? (await createVaultFolder({ human_id: austin._id, name: NAME, parent_folder_id: root._id }))!;
  await writeProjectSharing(folder, [{ human: austin._id, role: "Guide" }, ...humans.map((h, i) => ({ human: h._id, role: PEOPLE[i].role }))]);

  console.log(`Letters walk ready: ${APP}/newspaper/${folder._id}
  Letters tab (the desk): ${APP}/newspaper/${folder._id}?tab=letters

  Sign in as each in its own private window; the code is in Mailpit (http://localhost:8025).
    Guide, staff (you):  ${austin.email}
${PEOPLE.map((p) => `    ${`${p.role}:`.padEnd(20)} ${p.email}`).join("\n")}

  The walk:
    1. As a guide, New letter: a title, what it is for, and who it is for. Pick the clients. Write a line, then Send.
    2. As each client, open the project: the flag is up. Open the mailbox, then the letter.
       The flag comes down for that client and stays up for the other.
    3. As a guide, write another, this time for the team, and send it. The other guide and the crafter get the flag.
       As a client, that letter is not in the mailbox, and its link is not found.
    4. As the other guide, read it. There is no Reply on it: writing back is a new letter from the desk.
    5. As the crafter, the desk lists every letter in both directions and offers no way to write one.
    6. As a guide, New letter and go straight to the letter: the talk box is above the editor with no brief.
       Say something, Write the outline. What you said goes on the record when you Send, not before.
    7. As a client, open a letter from the mailbox. Under its header: Talk it through. Open it; it sits beside
       the letter. Say something and leave: it is a draft only you see. Keep it: now it is on the record as yours.
       The other client's page shows none of it.
    8. As the other guide, talk the team's letter through and keep it. Write a letter from this: the New letter
       form, saying what it comes from. Title, what it is for, who it is for. No brief.
    9. On that letter's page: what you said, what you were reading, and Write the outline. The outline has read
       the letter you were reading. Send: nothing is added to your Card a second time.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
