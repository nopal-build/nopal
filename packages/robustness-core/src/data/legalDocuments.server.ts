import { RecordId } from "surrealdb";
import { upsert, query, formatRecord, type Data } from "./generic.server";

export interface LegalDocumentRecord extends Data {
  document_type: "wc_waiver";
  // Contractor info
  contractor_name: string;
  // Independent Contractor info
  ic_name: string;
  business_name: string;
  roc_license: string;
  phone: string;
  email: string;
  // Acknowledgment
  has_wc_insurance: boolean;
  insurance_carrier: string;
  policy_number: string;
  expiration_date: string;
  // Signature / audit
  signature_name: string;
  signed_at: string; // ISO timestamp
  ip_address: string;
  // Storage
  s3_url: string;
  s3_key: string;
  created_at: string;
}

export async function createLegalDocument(
  data: Omit<LegalDocumentRecord, "id" | "_id" | "created_at">,
): Promise<LegalDocumentRecord | undefined> {
  const record = {
    ...data,
    created_at: new Date().toISOString(),
  };
  const result = await upsert("legal_documents", record);
  const item = Array.isArray(result) ? result[0] : result;
  return item
    ? formatRecord(item as unknown as LegalDocumentRecord)
    : undefined;
}

export async function getLegalDocumentsByEmail(
  email: string,
): Promise<LegalDocumentRecord[]> {
  const result = await query<[LegalDocumentRecord[]]>(
    `SELECT * FROM legal_documents WHERE email = $email ORDER BY created_at DESC`,
    { email },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function getLegalDocumentById(
  id: string,
): Promise<LegalDocumentRecord | undefined> {
  const result = await query<[LegalDocumentRecord[]]>(
    `SELECT * FROM legal_documents WHERE id = $rid`,
    { rid: new RecordId("legal_documents", id) },
  );
  const record = result?.[0]?.[0];
  return record ? formatRecord(record) : undefined;
}
