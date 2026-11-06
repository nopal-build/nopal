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
 * What is there instead (Austin, 2026-11-06; `letterReflection.server.ts`):
 * the reader's own talk-through of the letter, shown to them and nobody
 * else. Theirs to keep or drop, and never addressed to the writer.
 *
 * Who decides what. A person: to open the letter, and what to say about
 * it. Code: what is said around it, the flag, and whose reflection the
 * page is handed (the viewer's own, or none).
 */

import { firstName } from "./humanNames";
import { getHumanById, type Human } from "./humans.server";
import { lowerLetterFlag } from "./letterFlags.server";
import { houseMayOpen, houseOf, housesOf, mayReflect, mayStartLetter, type House } from "./letterHouses";
import { getReflection, reflectionForPage, type ReflectionForPage } from "./letterReflection.server";
import { letterViewerOf, sentCopyOf } from "./letters.server";
import { getProjectRole } from "./projectSharing.server";
import type { FileRef, VaultFolder } from "./vault.types";

/** What the letter's page says around the letter, for this reader. */
export type LetterReading = {
  /** The first name of who it is from; null for a letter with no house. */
  from: string | null;
  /** The house it went to, told to someone on the project only. */
  toHouse: House | null;
  /** The viewer's own talk-through of this letter, when they may have
   * one (`mayReflect`, and the caller's `reflects`). Null means no box. */
  reflection: ReflectionForPage | null;
  /** The project a letter can be started in from a kept reflection, for
   * someone who may write letters there; null for everyone else. */
  writeBackIn: string | null;
};

/** Who the letter is from goes to every reader, the public link and the
 * printed page included: a letter says who wrote it. The house it went
 * to is for someone on the project who is shown the letter, by their
 * house. And when that person is the one opening it (`lowers`), their
 * flag for it comes down: this is the only place a flag is lowered, and
 * the mailbox's list never calls it. The caller says when the request is
 * a person's own opening (not a render, not an admin viewing as them).
 *
 * The reflection is looked up before anything about houses, so a letter
 * from before houses gets the box too. `reflects` is the caller saying
 * the viewer is here as themself (signed in, nobody looking as them);
 * a render pass and a preview never ask. Someone the letter isn't shown
 * to, a public-link visitor off the project included, gets none. */
export async function readLetter(
  file: FileRef,
  project: VaultFolder,
  viewer: (Pick<Human, "_id"> & { role?: string | null }) | null,
  opts: { lowers: boolean; reflects?: boolean },
): Promise<LetterReading> {
  const role = viewer ? await getProjectRole(project, viewer._id) : null;
  const house = role ? houseOf(role.role) : null;
  const reflects = !!viewer && !!role && opts.reflects && role.features.includes("dailyLog") && mayReflect(file, house, !!sentCopyOf(file));
  const reflection = reflects ? reflectionForPage(await getReflection(file._id, viewer._id)) : null;
  // "Write a letter from this": for whoever may start a letter here
  // (`mayStartLetter`: a Guide, or a client), as the route that starts
  // one asks again.
  const writeBackIn = reflection && viewer && mayStartLetter(letterViewerOf(viewer._id, role)) ? project._id : null;

  const houses = housesOf(file);
  if (!houses) return { from: null, toHouse: null, reflection, writeBackIn };
  const sender = await getHumanById(houses.fromHumanId);
  const from = sender ? firstName(sender) : null;
  if (!viewer || !role || !houseMayOpen(file, house)) return { from, toHouse: null, reflection: null, writeBackIn: null };
  if (opts.lowers) await lowerLetterFlag(file._id, viewer._id);
  return { from, toHouse: houses.toHouse, reflection, writeBackIn };
}
