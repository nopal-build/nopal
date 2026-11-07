/**
 * Letters between houses (Austin, 2026-11-05): "think of it as a letter
 * that shows up at someone's house. You would assume both members, or all
 * members, of the house could open and read the letter." A letter is
 * written by a person and delivered to a house. Everyone in the receiving
 * house can open it; everyone in the house it came from sees it at the
 * desk (the Letters tab); nobody else is shown the letter.
 *
 * Two houses on a project, read from the group a person already holds
 * (`features.ts`), nothing stored about people:
 * - the clients' house: everyone in the Client group;
 * - the guides' house: Guides, plus Crafters and Observers, who read and
 *   do not write.
 *
 * A sent letter keeps who it is from and its two houses on its record
 * (`FileRef.from_human_id`, `from_house`, `to_house`). Where it is going
 * is picked when the letter is started, with its title and what it is
 * for (Austin, 2026-11-05: "when you sit down to write a letter, it's:
 * what is it, what's the title, why are you writing it, and who are you
 * writing it to"): the letters route writes `to_house` on the draft
 * (`houseAtStart`), and `from_human_id` too when a client starts one.
 * `sendLetter` writes what is still missing the first time it is sent,
 * and from then none of the three changes. A draft that has only
 * `to_house`, or that and `from_human_id`, is addressed, not housed:
 * `housesOf` reads it as having no house, so it refuses and flags
 * nobody. A letter sent before
 * 2026-11-05 has none of the three: nothing can tell who it was for, so
 * it is outside every rule here and shows to everyone, as it did.
 *
 * On screen the guides' house is "the team": Guides write, and Crafters
 * and Observers read every letter in both directions and reply to none.
 *
 * Who writes which letter (`mayWriteLetter`, Austin 2026-11-05/06): a
 * Guide on the project writes any letter that is not a client's; a
 * client writes a letter that is from them and nothing else; everyone
 * else, Crafters, Observers and staff with no role on the project
 * included, writes nothing ("staff join the project to write there").
 * A client's letter is from them from the moment it is started: the
 * route that starts it writes `from_human_id` on the draft, so the draft
 * is theirs before it has a house. A guide's draft says who it is from
 * only once sent. The rule reads `from_house` on a sent letter and, for
 * a draft, whether the person it is from is in the clients' house now.
 *
 * Every housed letter has the guides' house on one side (a client writes
 * the guides; a guide writes the clients or the guides), so the one
 * refusal there is: a Client and a letter the guides sent to the guides.
 *
 * Plain module, pure: the tests read every branch without a database.
 * Who is in a house on a given project is `letterHouses.server.ts`.
 */

import { groupOf } from "./features";

export const HOUSES = ["guides", "clients"] as const;
export type House = (typeof HOUSES)[number];

export function isHouse(value: unknown): value is House {
  return typeof value === "string" && (HOUSES as readonly string[]).includes(value);
}

/** The house a stored role name puts someone in, or null for a name
 * nobody knows. Through `groupOf`, so an old "Owner" reads as a Guide. */
export function houseOf(roleName: string | null | undefined): House | null {
  const group = roleName ? groupOf(roleName) : null;
  if (!group) return null;
  return group === "Client" ? "clients" : "guides";
}

/** The three fields as stored. */
export type LetterHouseFields = {
  from_human_id?: string | null;
  from_house?: string | null;
  to_house?: string | null;
};

export type LetterHouses = { fromHumanId: string; fromHouse: House; toHouse: House };

/** A letter's houses, or null for one that has none (sent before houses,
 * or not sent). All three or nothing: a record with only some is read as
 * houseless, so a half-written one can never refuse or flag anybody. */
export function housesOf(file: LetterHouseFields): LetterHouses | null {
  if (!file.from_human_id || !isHouse(file.from_house) || !isHouse(file.to_house)) return null;
  return { fromHumanId: file.from_human_id, fromHouse: file.from_house, toHouse: file.to_house };
}

/** Where a letter is going: its house once sent, else the house its
 * draft was addressed to when it was started, else null (an upload, a
 * reply, a draft from before letters were addressed). */
export function addressedTo(file: LetterHouseFields): House | null {
  return housesOf(file)?.toHouse ?? (isHouse(file.to_house) ? file.to_house : null);
}

/** Where a new letter is going, picked on the form that starts it. On a
 * project with clients the guide says which house, and there is no
 * default; with no clients there is nothing to pick and it is the
 * guides'. */
export function houseAtStart(input: { projectHasClients: boolean; asked?: unknown }): { ok: true; toHouse: House } | ({ ok: false } & HouseRefusal) {
  if (!input.projectHasClients) return { ok: true, toHouse: "guides" };
  if (!isHouse(input.asked)) return { ok: false, status: 400, error: HOUSE_NOT_CHOSEN };
  return { ok: true, toHouse: input.asked };
}

/** Whether someone in `viewerHouse` is shown this letter at all. A
 * houseless letter shows to everyone, as before. A viewer with no house
 * is shown no housed letter. */
export function houseMayOpen(file: LetterHouseFields, viewerHouse: House | null): boolean {
  const houses = housesOf(file);
  if (!houses) return true;
  if (!viewerHouse) return false;
  return houses.fromHouse === viewerHouse || houses.toHouse === viewerHouse;
}

/** Whether someone may talk a letter through on its page (Austin,
 * 2026-11-06: "an option to talk through the letter while you are
 * viewing it"): anyone the letter is shown to, once it is sent. Both
 * houses of a letter between them, so a writer may reflect on their own
 * side's letter; a letter with no house, anyone on the project. The
 * caller has already found the viewer on the project. */
export function mayReflect(file: LetterHouseFields, viewerHouse: House | null, sent: boolean): boolean {
  return sent && !!viewerHouse && houseMayOpen(file, viewerHouse);
}

/** Someone looking at a letter, as the write rules see them: who, which
 * house, and whether they guide the project (`ResolvedProjectRole.guiding`,
 * a Guide there). Staff with no role on the project have no house and
 * do not guide: they write nothing here. */
export type LetterViewer = { humanId: string; house: House | null; guiding: boolean };

/** Whether a letter is a client's: it came from the clients' house once
 * sent, or its draft is from someone in that house now. */
export function isClientsLetter(file: LetterHouseFields, members: readonly { human: string; house: House | null }[]): boolean {
  if (file.from_house === "clients") return true;
  if (!file.from_human_id) return false;
  return members.some((m) => m.human === file.from_human_id && m.house === "clients");
}

/** Whether `viewer` may write this letter: its words, its talk-through
 * and outline, its pictures and recording, its send, and its delete
 * while a draft. See the header. */
export function mayWriteLetter(viewer: LetterViewer, file: LetterHouseFields, members: readonly { human: string; house: House | null }[]): boolean {
  if (viewer.house === "clients") return !!file.from_human_id && file.from_human_id === viewer.humanId;
  if (viewer.guiding) return !isClientsLetter(file, members);
  return false;
}

/** Whether `viewer` may start a letter on the project: a Guide there, or
 * someone in the clients' house. Crafters, Observers and staff with no
 * role start none. */
export function mayStartLetter(viewer: Pick<LetterViewer, "house" | "guiding">): boolean {
  return viewer.guiding || viewer.house === "clients";
}

/** A tab row as the desk filter reads it (`LetterRow` has all of it). */
export type DeskRowFields = {
  sentDate: string | null;
  houses: LetterHouses | null;
  fromHumanId: string | null;
  toHouse: House | null;
  editedSinceSent: boolean;
  purpose: string | null;
};

/** The desk's rows for one viewer (Austin, 2026-11-05: "The desk holds
 * what you are writing, what your house has sent and what your house has
 * received"; a client's desk is "the same place with less on it"):
 * - a draft shows to whoever may write it, and to the rest of the guides'
 *   house as it always did; a client's draft shows to that client alone;
 * - a sent letter shows to both of its houses (`houseMayOpen`), and a
 *   letter with no house to everyone, as before;
 * - each row says whether the viewer may write it (`writes`: Edit,
 *   Delete, the preview link), and "edited since sent" is told to a
 *   letter's writers only, since a client's unsent edits are theirs
 *   alone;
 * - a client is told no purpose line: it is the guide's own line, kept
 *   off the letter's page on purpose, and a client's letters have none.
 * Pure. */
export function deskRows<R extends DeskRowFields>(rows: readonly R[], viewer: LetterViewer, members: readonly { human: string; house: House | null }[]): (R & { writes: boolean })[] {
  const asClient = viewer.house === "clients";
  const out: (R & { writes: boolean })[] = [];
  for (const row of rows) {
    const fields: LetterHouseFields = { from_human_id: row.fromHumanId, from_house: row.houses?.fromHouse ?? null, to_house: row.houses?.toHouse ?? row.toHouse };
    const writes = mayWriteLetter(viewer, fields, members);
    const shown = row.sentDate ? houseMayOpen(fields, viewer.house) : asClient ? writes : !isClientsLetter(fields, members);
    if (!shown) continue;
    out.push({ ...row, writes, editedSinceSent: writes && row.editedSinceSent, purpose: asClient ? null : row.purpose });
  }
  return out;
}

/** Whether the letter is in this person's mailbox: sent to their house by
 * someone other than them. A houseless letter is in every mailbox, the
 * way it was on every tile. The caller passes sent letters only. */
export function inMailbox(file: LetterHouseFields, viewer: { humanId: string; house: House | null }): boolean {
  return housesInMailbox(housesOf(file), viewer);
}

/** `inMailbox`, for a caller that has already read the houses. */
export function housesInMailbox(houses: LetterHouses | null, viewer: { humanId: string; house: House | null }): boolean {
  if (!houses) return true;
  return !!viewer.house && houses.toHouse === viewer.house && houses.fromHumanId !== viewer.humanId;
}

/** Everyone on a project with the house they are in, from the project's
 * list and the Guides of the Organization that owns it. The precedence is
 * `getProjectRole`'s: a person's entry on the list decides when its role
 * is a group anyone knows (so an org Guide the list names a Client is in
 * the clients' house); an org Guide the list says nothing usable about
 * is in the guides' house. Pure. */
export function houseMembersFrom(sharing: readonly { human: string; role: string }[], orgGuideIds: readonly string[]): { human: string; house: House }[] {
  const houses = new Map<string, House | null>();
  for (const entry of sharing) {
    if (!houses.has(entry.human)) houses.set(entry.human, houseOf(entry.role));
  }
  for (const id of orgGuideIds) {
    if (!houses.get(id)) houses.set(id, "guides");
  }
  return [...houses.entries()].flatMap(([human, house]) => (house ? [{ human, house }] : []));
}

/** Whether the project has a clients' house to write to: what decides
 * whether a guide is asked who a letter is for. */
export function projectHasClients(members: readonly { house: House | null }[]): boolean {
  return members.some((m) => m.house === "clients");
}

/** Whose flag goes up when a letter is sent to `toHouse`: everyone in
 * that house now, except the person sending and the person it is from
 * (a letter is never in its writer's own mailbox). Decided at the send,
 * which is how "only mail that arrives after you join" holds with no
 * join date kept: someone who joins later was never on this list. */
export function flagRecipients(members: readonly { human: string; house: House | null }[], toHouse: House, except: readonly string[]): string[] {
  return [...new Set(members.filter((m) => m.house === toHouse && !except.includes(m.human)).map((m) => m.human))];
}

export type HouseRefusal = { status: 400; error: string };

/** Where a letter goes at Send. In order:
 * - a letter that has a house keeps it, whoever sends it again and
 *   whatever they ask for;
 * - a draft addressed when it was started goes where it was addressed;
 * - a client's letter goes to the guides, always;
 * - a guide's goes to the guides when the project has no clients;
 * - otherwise (an upload, or a draft from before letters were addressed
 *   at the start) the guide says which at Send, and there is no default.
 * Writing back to a letter is none of these: it is a new letter, started
 * and addressed like any other (Austin, 2026-11-05). */
export function houseAtSend(input: {
  current: LetterHouseFields;
  senderHouse: House;
  projectHasClients: boolean;
  asked?: unknown;
}): { ok: true; toHouse: House } | ({ ok: false } & HouseRefusal) {
  const decided = addressedTo(input.current);
  if (decided) return { ok: true, toHouse: decided };
  if (input.senderHouse === "clients") return { ok: true, toHouse: "guides" };
  if (!input.projectHasClients) return { ok: true, toHouse: "guides" };
  if (!isHouse(input.asked)) return { ok: false, status: 400, error: HOUSE_NOT_CHOSEN };
  return { ok: true, toHouse: input.asked };
}

/** Whether Send has to ask: a guide, a project with clients, and a letter
 * that has no house and was not addressed when it was started. */
export function sendAsksForHouse(input: { current: LetterHouseFields; projectHasClients: boolean }): boolean {
  if (addressedTo(input.current)) return false;
  return input.projectHasClients;
}

// Words a person reads (Nopal's voice; listed in the round's return leg).
export const HOUSE_NOT_CHOSEN = "Pick who this letter is for first.";
// The guides' house reads as "the team": it is the Guides with the
// Crafters and Observers who read along (Austin, 2026-11-05).
export const HOUSE_LABEL: Record<House, string> = { guides: "the team", clients: "the clients" };
