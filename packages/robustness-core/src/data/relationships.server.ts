import { query, upsert, merge, formatRecord, type Data } from "./generic.server";
import { getHumans, type Human } from "./humans.server";
import { removeFolderSharingBetweenHumans } from "./vault.server";

export type Relationship = Data & {
  humanAId: string;
  humanBId: string;
  createdBy: string;
  createdAt: string;
  /**
   * Set when this relationship has been revoked — see `revokeRelationship`.
   * A revoked relationship no longer grants vault visibility, and only the
   * human who revoked it (`revokedBy`) can re-create it later.
   */
  revokedBy?: string;
  revokedAt?: string;
};

export type CreateRelationshipResult =
  | { status: "created"; relationship: Relationship }
  | { status: "reactivated"; relationship: Relationship }
  | { status: "already-related" }
  | { status: "revoked-by-other" };

function isAdminOrSuper(human: Pick<Human, "role">): boolean {
  return human.role === "Admin" || human.role === "Super";
}

/** The relationship row between two humans, in either direction — active or revoked — if any. */
async function getRelationshipBetween(
  humanAId: string,
  humanBId: string,
): Promise<Relationship | undefined> {
  const result = await query<[Relationship[]]>(
    `SELECT * FROM relationships WHERE (humanAId = $a AND humanBId = $b) OR (humanAId = $b AND humanBId = $a) LIMIT 1;`,
    { a: humanAId, b: humanBId },
  );
  const record = result?.[0]?.[0];
  return record ? formatRecord(record) : undefined;
}

/** True if an *active* (non-revoked) relationship already exists between the two humans, in either direction. */
export async function relationshipExists(
  humanAId: string,
  humanBId: string,
): Promise<boolean> {
  const existing = await getRelationshipBetween(humanAId, humanBId);
  return Boolean(existing && !existing.revokedAt);
}

/**
 * Create a relationship between two humans, unless one already exists (in
 * either direction) or the ids are the same. Relationships are undirected —
 * either human being an Admin/Super already grants mutual visibility, so
 * this is mainly meant for Human ↔ Human connections.
 *
 * If the two humans previously had a relationship that was revoked, only
 * the human who revoked it (`revokedBy`) can re-create it — doing so
 * reactivates the same underlying record rather than creating a new one.
 * If the *other* human (the one who was revoked) tries, the request is
 * rejected with `"revoked-by-other"` so the caller can explain why.
 */
export async function createRelationship(
  humanAId: string,
  humanBId: string,
  createdBy: string,
): Promise<CreateRelationshipResult> {
  if (humanAId === humanBId) return { status: "already-related" };

  const existing = await getRelationshipBetween(humanAId, humanBId);
  if (existing) {
    if (!existing.revokedAt) return { status: "already-related" };
    if (existing.revokedBy !== createdBy) return { status: "revoked-by-other" };

    await merge("relationships", existing._id!, {
      createdBy,
      createdAt: new Date().toISOString(),
      revokedBy: null,
      revokedAt: null,
    });
    const reactivated = await getRelationshipBetween(humanAId, humanBId);
    return reactivated
      ? { status: "reactivated", relationship: reactivated }
      : { status: "already-related" };
  }

  const record = {
    humanAId,
    humanBId,
    createdBy,
    createdAt: new Date().toISOString(),
  };
  const result = await upsert("relationships", record);
  const item = Array.isArray(result) ? result[0] : result;
  const relationship = item
    ? formatRecord(item as unknown as Relationship)
    : undefined;
  return relationship
    ? { status: "created", relationship }
    : { status: "already-related" };
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
 * Revoke the relationship between two humans (in either direction) and
 * permanently strip any direct folder sharing between them. This is a
 * one-way action, and it's non-reversible for the revoked human: the
 * relationship is soft-deleted (not removed outright) precisely so we
 * remember who revoked whom — only `revokedBy` can re-kindle it later via
 * `createRelationship`. The other human can't reconnect on their own.
 *
 * Admins/Supers never need an explicit relationship row for visibility
 * (see `getRelatedHumans`), so revoking someone they were only ever
 * automatically visible to — never explicitly connected to — would
 * otherwise be a complete no-op: there'd be no row to mark revoked, so
 * nothing would persist and the "Revoked" state could never show up. To
 * keep revoke meaningful in that case too, create the row straight into
 * the revoked state when one doesn't already exist.
 */
export async function revokeRelationship(
  humanAId: string,
  humanBId: string,
  revokedBy: string,
): Promise<void> {
  const existing = await getRelationshipBetween(humanAId, humanBId);
  const now = new Date().toISOString();
  if (existing) {
    if (!existing.revokedAt) {
      await merge("relationships", existing._id!, {
        revokedBy,
        revokedAt: now,
      });
    }
  } else {
    await upsert("relationships", {
      humanAId,
      humanBId,
      createdBy: revokedBy,
      createdAt: now,
      revokedBy,
      revokedAt: now,
    });
  }
  await removeFolderSharingBetweenHumans(humanAId, humanBId);
}

/**
 * Humans that `human` has a relationship with — used both for the profile
 * page's relationship list and the vault folder-sharing picker.
 *
 * - Admins/Supers can see, and are visible to, everyone.
 * - Everyone can always see Admins/Supers.
 * - Otherwise two Human-role accounts must have an explicit relationship —
 *   active only by default, or also revoked ones when `includeRevoked` is
 *   set (used by the profile page so a revoked relationship still shows up,
 *   as "Revoked", for the human who didn't do the revoking).
 */
export async function getRelatedHumans(
  human: Human,
  { includeRevoked = false }: { includeRevoked?: boolean } = {},
): Promise<Human[]> {
  const allHumans = (await getHumans())?.data ?? [];
  const others = allHumans.filter(
    (h) =>
      h._id !== human._id &&
      h.email.trim().toLowerCase() !== human.email.trim().toLowerCase(),
  );

  if (isAdminOrSuper(human)) return others;

  const relationships = await getRelationshipsForHuman(human._id);
  // By default only active relationships count. The profile page's
  // relationship list opts into `includeRevoked` so a revoked relationship
  // still shows up (as "Revoked") for both parties, instead of silently
  // disappearing for whoever didn't do the revoking. Other consumers (e.g.
  // the vault folder-sharing picker) must keep excluding revoked partners,
  // since revoking also strips folder sharing between the two humans.
  const relatedIds = new Set(
    relationships
      .filter((r) => includeRevoked || !r.revokedAt)
      .map((r) => (r.humanAId === human._id ? r.humanBId : r.humanAId)),
  );

  return others.filter((h) => isAdminOrSuper(h) || relatedIds.has(h._id));
}
