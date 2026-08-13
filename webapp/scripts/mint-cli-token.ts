// One-off: mints a full-access personal access token for a human, for
// scripting/testing the CLI without an interactive browser login. Prints
// the raw token once — use as NOPAL_TOKEN alongside NOPAL_HOST.
//
// Run via: npx vite-node scripts/mint-cli-token.ts [email]
// (defaults to gerald@nopal.build)

import { getHumanByEmail } from "robustness-core/data/humans.server";
import { createPersonalAccessToken } from "robustness-core/data/apiTokens.server";

async function main() {
  const email = process.argv[2] ?? "gerald@nopal.build";
  const human = await getHumanByEmail(email);
  if (!human) {
    console.error(`No human found for ${email}`);
    process.exit(1);
  }
  const minted = await createPersonalAccessToken(human._id, "phylog-test-script");
  if (!minted) {
    console.error("Failed to mint token");
    process.exit(1);
  }
  console.log(`HUMAN_ID=${human._id}`);
  console.log(`TOKEN=${minted.token}`);
}

main().then(() => process.exit(0));
