import { RecordId } from "surrealdb";
import { Data, query, formatRecord, upsert, merge, remove } from "./generic.server";

/**
 * A registered sync target: one local directory on one device, mirrored to
 * one folder under the `syncs/` vault root. One device per target — a
 * second machine syncing the same content registers its own target. This
 * keeps phase-B sync single-writer and conflict-free by construction.
 *
 * Per-file sync state deliberately does NOT live here — the CLI keeps a
 * local state file (like a git index); the server's per-file truth is the
 * `content_hash` on each file_ref.
 */
export type SyncTarget = Data & {
  humanId: string;
  /** Display name; also the folder name under syncs/. */
  name: string;
  /** The vault folder this target mirrors into. */
  folderId: string;
  /** Random id generated and stored by the CLI on first use. */
  deviceId: string;
  /** Human-readable device name, e.g. "Gs-MacBook-Pro.local". */
  deviceLabel: string;
  /** Absolute local path on that device — informational/display only. */
  localPath: string;
  /** Run `nopal video prep` on raw videos before uploading — the optimized
   * .web.mp4 sibling is synced instead of the original recording. */
  preprocess?: boolean;
  /** Pull remote changes down as well as pushing local ones. Off by
   * default — push-only targets never modify the local directory. */
  twoWay?: boolean;
  createdAt: string;
  lastSyncedAt: string | null;
};

export async function createSyncTarget(data: {
  humanId: string;
  name: string;
  folderId: string;
  deviceId: string;
  deviceLabel: string;
  localPath: string;
  preprocess?: boolean;
  twoWay?: boolean;
}): Promise<SyncTarget | undefined> {
  const result = await upsert("sync_targets", {
    ...data,
    preprocess: data.preprocess ?? false,
    twoWay: data.twoWay ?? false,
    createdAt: new Date().toISOString(),
    lastSyncedAt: null,
  });
  const record = Array.isArray(result) ? result[0] : result;
  return record ? formatRecord(record as unknown as SyncTarget) : undefined;
}

export async function getSyncTargetsByHuman(
  humanId: string,
): Promise<SyncTarget[]> {
  const result = await query<[SyncTarget[]]>(
    `SELECT * FROM sync_targets WHERE humanId = $humanId ORDER BY name ASC`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function getSyncTargetById(
  id: string,
): Promise<SyncTarget | undefined> {
  const result = await query<[SyncTarget[]]>(
    `SELECT * FROM sync_targets WHERE id = $rid`,
    { rid: new RecordId("sync_targets", id) },
  );
  const record = result?.[0]?.[0];
  return record ? formatRecord(record) : undefined;
}

export async function touchSyncTarget(
  id: string,
): Promise<SyncTarget | undefined> {
  const result = await merge("sync_targets", id, {
    lastSyncedAt: new Date().toISOString(),
  });
  return result ? formatRecord(result as unknown as SyncTarget) : undefined;
}

export async function deleteSyncTarget(id: string): Promise<void> {
  await remove("sync_targets", id);
}
