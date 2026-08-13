import { Data, query, formatRecord, upsert } from "./generic.server";

/**
 * Audit trail for the "login as user" (impersonation) admin tool — see
 * `startImpersonation` / `stopImpersonation` in `modules/auth/auth.server.ts`.
 * Purely a record of who viewed as whom and when; never read to authorize
 * anything.
 */
export type ImpersonationEvent = Data & {
  action: "start" | "stop" | "expire";
  adminId: string;
  adminEmail: string;
  adminName: string;
  targetId: string;
  targetEmail: string;
  targetName: string;
  createdAt: string;
};

export async function recordImpersonationEvent(entry: {
  action: "start" | "stop" | "expire";
  adminId: string;
  adminEmail: string;
  adminName: string;
  targetId: string;
  targetEmail: string;
  targetName: string;
}): Promise<void> {
  try {
    await upsert("impersonationEvents", {
      ...entry,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // Never let a logging failure block the actual impersonation
    // start/stop — the session change already committed by this point.
    console.error("Failed to record impersonation event:", err);
  }
}

export async function getImpersonationEvents(): Promise<ImpersonationEvent[]> {
  const result = await query<[ImpersonationEvent[]]>(
    `SELECT * FROM impersonationEvents ORDER BY createdAt DESC LIMIT 200;`,
  );
  return (result?.[0] ?? []).map(formatRecord);
}
