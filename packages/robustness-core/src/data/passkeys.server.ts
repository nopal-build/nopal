import { RecordId } from "surrealdb";
import {
  Data,
  query,
  select,
  formatRecord,
  upsert,
  merge,
  remove,
} from "./generic.server";

export type Passkey = Data & {
  humanId: string;
  webauthnUserId: string; // Base64URLString handed to the authenticator at registration (the WebAuthn "userHandle")
  credentialId: string; // Base64URLString identifying the credential itself
  publicKey: string; // Base64-encoded COSE public key bytes
  counter: number;
  transports: string[];
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  name: string;
  createdAt: string;
};

export async function getPasskeysByHuman(humanId: string): Promise<Passkey[]> {
  const result = await query<[Passkey[]]>(
    `SELECT * FROM passkeys WHERE humanId = $humanId ORDER BY createdAt DESC;`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function getPasskeyById(id: string): Promise<Passkey | undefined> {
  return select<Passkey>(new RecordId("passkeys", id));
}

export async function getPasskeyByCredentialId(
  credentialId: string,
): Promise<Passkey | undefined> {
  const result = await query<[Passkey[]]>(
    `SELECT * FROM passkeys WHERE credentialId = $credentialId;`,
    { credentialId },
  );
  const record = result?.[0]?.[0] || undefined;
  return record ? formatRecord(record) : undefined;
}

export async function createPasskey(data: {
  humanId: string;
  webauthnUserId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  name: string;
}): Promise<Passkey | undefined> {
  const result = await upsert("passkeys", {
    ...data,
    createdAt: new Date().toISOString(),
  });
  const record = Array.isArray(result) ? result[0] : result;
  return record ? formatRecord(record as unknown as Passkey) : undefined;
}

export async function deletePasskey(id: string): Promise<void> {
  await remove("passkeys", id);
}

/** Update the stored signature counter after a successful authentication. */
export async function updatePasskeyCounter(
  id: string,
  counter: number,
): Promise<void> {
  await merge("passkeys", id, { counter });
}
