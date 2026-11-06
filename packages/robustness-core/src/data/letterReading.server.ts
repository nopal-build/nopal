/**
 * What a reader is told around the letter in front of them, and the one
 * place a mailbox flag comes down (Austin, 2026-11-05; `letterHouses.ts`
 * has the rule).
 *
 * One letter at a time (Austin, 2026-10-29: "it feels like you're
 * physically setting one letter down and switching to the other"): an
 * open letter says who it is from and, to someone on the project, where
 * it went. No thread, no quoted text, nothing listed under it.
 *
 * There is no Reply here, on purpose (Austin, 2026-11-05: "replying to a
 * letter shouldn't be as easy as pushing reply. That feels like an email
 * ... It's not a reply to one email; it's a new, considered letter back
 * to the other person"). Writing back is starting a letter at the desk,
 * with its title, what it is for and who it is for, like any other.
 *
 * Who decides what. A person: to open the letter. Code: what is said
 * around it, and the flag.
 */

import { firstName } from "./humanNames";
import { getHumanById, type Human } from "./humans.server";
import { lowerLetterFlag } from "./letterFlags.server";
import { houseMayOpen, houseOf, housesOf, type House } from "./letterHouses";
import { getProjectRole } from "./projectSharing.server";
import type { FileRef, VaultFolder } from "./vault.types";

/** What the letter's page says around the letter, for this reader. */
export type LetterReading = {
  /** The first name of who it is from; null for a letter with no house. */
  from: string | null;
  /** The house it went to, told to someone on the project only. */
  toHouse: House | null;
};

/** Who the letter is from goes to every reader, the public link and the
 * printed page included: a letter says who wrote it. The house it went
 * to is for someone on the project who is shown the letter, by their
 * house. And when that person is the one opening it (`lowers`), their
 * flag for it comes down: this is the only place a flag is lowered, and
 * the mailbox's list never calls it. The caller says when the request is
 * a person's own opening (not a render, not an admin viewing as them). */
export async function readLetter(
  file: FileRef,
  project: VaultFolder,
  viewer: Pick<Human, "_id"> | null,
  opts: { lowers: boolean },
): Promise<LetterReading> {
  const houses = housesOf(file);
  if (!houses) return { from: null, toHouse: null };
  const sender = await getHumanById(houses.fromHumanId);
  const from = sender ? firstName(sender) : null;
  const role = viewer ? await getProjectRole(project, viewer._id) : null;
  if (!viewer || !role || !houseMayOpen(file, houseOf(role.role))) return { from, toHouse: null };
  if (opts.lowers) await lowerLetterFlag(file._id, viewer._id);
  return { from, toHouse: houses.toHouse };
}
