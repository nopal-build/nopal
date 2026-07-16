import crypto from "node:crypto";
import { upsert } from "../app/data/generic.server";
async function main() {
  const raw = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  await upsert("api_tokens", {
    humanId: "super_1",
    name: "debug CLI token",
    tokenHash: crypto.createHash("sha256").update(raw).digest("hex"),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3600_000).toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  });
  console.log(raw);
}
main().catch((e) => { console.error(e); process.exit(1); });
