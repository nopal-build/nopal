/**
 * A short-lived signed ticket that carries an authorised dictation start
 * from the app (`app/routes/api.dictation.start.tsx`, which can read the
 * session and the Card's project) to the socket relay beside `server.js`
 * (which runs outside the app build and can't). HMAC-SHA256 over the JSON
 * payload with SESSION_SECRET; nothing is stored.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TICKET_TTL_MS = 60_000;

function secret() {
  return `dictation:${process.env.SESSION_SECRET || "NOT_A_STRONG_SECRET"}`;
}

function sign(body) {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

/** `payload` is `{ humanId, context }`; the expiry is added here. */
export function signTicket(payload, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + TICKET_TTL_MS })).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The payload, or null if the ticket is forged, malformed or expired. */
export function verifyTicket(ticket, now = Date.now()) {
  if (typeof ticket !== "string") return null;
  const [body, mac] = ticket.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}
