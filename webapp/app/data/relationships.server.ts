import { query, upsert } from "./generic.server";
import { getHumans, type Human } from "./humans.server";

export type Relationship = {
  id?: { tb: string; id: string };
  _id?: string;
  humanAId: string;
  humanBId: string;
  createdBy: string;
  createdAt: string;
};

function isAdminOrSuper(human: Pick<Human, "role">): boolean {
  return human.role === "Admin" || human.role === "Super";
}

/** True if a relationship already exists between the two humans, in either direction. */
export async function relationshipExists(
  humanAId: string,
  humanBId: string,
): Promise<boolean> {
  const result = await query<[Relationship[]]>(
    `SELECT * FROM relationships WHERE (humanAId = $a AND humanBId = $b) OR (humanAId = $b AND humanBId = $a) LIMIT 1;`,
    { a: humanAId, b: humanBId },
  );
  return (result?.[0]?.length ?? 0) > 0;
}

/**
 * Create a relationship between two humans, unless one already exists (in
 * either direction) or the ids are the same. Relationships are undirected —
 * either human being an Admin/Super already grants mutual visibility, so
 * this is mainly meant for Human ↔ Human connections.
 */
export async function createRelationship(
  humanAId: string,
  humanBId: string,
  createdBy: string,
): Promise<Relationship | undefined> {
  if (humanAId === humanBId) return undefined;
  if (await relationshipExists(humanAId, humanBId)) return undefined;

  const record = {
    humanAId,
    humanBId,
    createdBy,
    createdAt: new Date().toISOString(),
  };
  const result = await upsert("relationships", record);
  const item = Array.isArray(result) ? result[0] : result;
  return item as Relationship | undefined;
}

/**
 * Repoint any relationships referencing `fromHumanId` (e.g. a placeholder
 * invited-but-never-logged-in human) so they reference `toHumanId` instead.
 * Used when merging a duplicate invite into an existing account via alias
 * email. Also drops any relationship that repointing would turn into a
 * self-relationship.
 */
export async function repointRelationshipsToHuman(
  fromHumanId: string,
  toHumanId: string,
): Promise<void> {
  if (fromHumanId === toHumanId) return;

  await query(
    `UPDATE relationships SET humanAId = $toId WHERE humanAId = $fromId;`,
    { fromId: fromHumanId, toId: toHumanId },
  );
  await query(
    `UPDATE relationships SET humanBId = $toId WHERE humanBId = $fromId;`,
    { fromId: fromHumanId, toId: toHumanId },
  );
  await query(`DELETE relationships WHERE humanAId = humanBId;`);
}

export async function getRelationshipsForHuman(
  humanId: string,
): Promise<Relationship[]> {
  const result = await query<[Relationship[]]>(
    `SELECT * FROM relationships WHERE humanAId = $id OR humanBId = $id;`,
    { id: humanId },
  );
  return result?.[0] ?? [];
}

/**
 * Humans that `human` has a relationship with — used both for the profile
 * page's relationship list and the vault folder-sharing picker.
 *
 * - Admins/Supers can see, and are visible to, everyone.
 * - Everyone can always see Admins/Supers.
 * - Otherwise two Human-role accounts must have an explicit relationship.
 */
export async function getRelatedHumans(human: Human): Promise<Human[]> {
  const allHumans = (await getHumans())?.data ?? [];
  const others = allHumans.filter(
    (h) =>
      h._id !== human._id &&
      h.email.trim().toLowerCase() !== human.email.trim().toLowerCase(),
  );

  if (isAdminOrSuper(human)) return others;

  const relationships = await getRelationshipsForHuman(human._id);
  const relatedIds = new Set(
    relationships.map((r) =>
      r.humanAId === human._id ? r.humanBId : r.humanAId,
    ),
  );

  return others.filter((h) => isAdminOrSuper(h) || relatedIds.has(h._id));
}
