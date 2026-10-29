/**
 * How the worker reads a sent letter whose link is off, to print it.
 *
 * The worker prints the letter's page with no session
 * (`letterPdfRender.server.ts`), so before this a sent letter only had a
 * PDF while its public link was on, and a client reading it logged in
 * got none. A pass is a random value the worker writes to the database
 * just before it opens the page, for one letter, and deletes when the
 * render ends; the app's letter routes (the page, and the files it
 * names) read it from a request header. No shared secret: the worker
 * and the app already share the database, and a signing key would be
 * one more secret to set on the worker's host.
 *
 * One render is many requests (the page, then each picture and poster),
 * so a pass is good for the length of one render, not for one request:
 * it expires on its own after `RENDER_PASS_TTL_MS` and is removed in the
 * render's `finally`. It opens one letter's sent copy and nothing else;
 * the draft, the brief and every other route ignore it.
 *
 * Imported by the worker and by the app's letter routes; nothing here
 * knows a browser (ADR-021).
 */

import { randomBytes } from "node:crypto";
import { RecordId } from "surrealdb";
import { defineTable, remove, select, upsert, type Data } from "./generic.server";

/** The request header a render carries. Set by the worker only on
 * requests to the app's own origin. */
export const LETTER_RENDER_HEADER = "x-nopal-letter-render";

/** Long enough for Chromium to load the page and its pictures
 * (`page.goto` waits up to 60s), short enough that a pass left behind
 * by a crash is dead within minutes. */
export const RENDER_PASS_TTL_MS = 2 * 60 * 1000;

const TABLE = "letter_render_passes";
let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await defineTable(TABLE);
  tableEnsured = true;
}

type RenderPassRow = Data & { letter_file_id: string; expires_at: string };

/** 48 hex characters: the only shape a pass can have, checked before
 * the database is asked. */
export function isRenderPassShape(value: string | null | undefined): value is string {
  return !!value && /^[0-9a-f]{48}$/.test(value);
}

/** Whether a pass row opens this letter now. Pure, so the test reads
 * every branch. */
export function passOpens(row: Pick<RenderPassRow, "letter_file_id" | "expires_at"> | null | undefined, fileId: string, now: number = Date.now()): boolean {
  if (!row || row.letter_file_id !== fileId) return false;
  const expires = Date.parse(row.expires_at);
  return Number.isFinite(expires) && expires > now;
}

/** Opens a pass for one letter's render. The worker's half. */
export async function openRenderPass(fileId: string): Promise<string> {
  await ensureTable();
  const pass = randomBytes(24).toString("hex");
  const row = { letter_file_id: fileId, expires_at: new Date(Date.now() + RENDER_PASS_TTL_MS).toISOString() };
  const written = await upsert(new RecordId(TABLE, pass), row);
  if (!written) throw new Error("could not write the render pass");
  return pass;
}

/** Closes a pass, whatever the render did. */
export async function closeRenderPass(pass: string): Promise<void> {
  await remove(TABLE, pass);
}

/** Whether this request carries a live pass for this letter. The app's
 * half: the letter's page and file routes. */
export async function requestHasRenderPass(request: Request, fileId: string): Promise<boolean> {
  const pass = request.headers.get(LETTER_RENDER_HEADER);
  if (!isRenderPassShape(pass)) return false;
  await ensureTable();
  const row = await select<RenderPassRow>(new RecordId(TABLE, pass));
  return passOpens(row, fileId);
}
