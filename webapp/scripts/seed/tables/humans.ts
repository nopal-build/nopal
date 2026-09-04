import type { Human } from "robustness-core/data/humans.server";
import type { SeedTable, SeedRecord } from "../index";

type HumanSeed = SeedRecord<Human>;

/**
 * Fixture humans use a RESERVED domain, never the team's real one.
 *
 * They used to be seeded at `@nopal.build` addresses, which `pull-daily-
 * logs.ts` then collided with: it upserts a row at the real PRODUCTION
 * human id carrying the same email, leaving two rows for one address, and
 * `getHumanByEmail` picked between them arbitrarily. Which identity a
 * local login bound to was a coin flip that could differ between machines
 * and between resets on the same machine — and the row it picked was
 * often not the one that owned the pulled data.
 *
 * `@seed.local` makes that collision structurally impossible rather than
 * repairable after the fact (and `db/migrations/0010_humans_email_unique.
 * surql` now forbids it outright). The only behavior change is what a
 * fresh dev types at the local login screen BEFORE they have pulled
 * anything; after a pull you log in as your real address, which is the
 * row that actually owns your data. See ADR-015.
 */
export const humansSeed: SeedTable<Human> = {
  table: "humans",
  records: [
    {
      id: "super_1",
      name: "Gerald L",
      email: "gerald@seed.local",
      role: "Super",
    },
    {
      id: "admin_1",
      name: "Austin T",
      email: "austin@seed.local",
      role: "Admin",
    },
    {
      id: "admin_2",
      name: "Lucas J",
      email: "lucas@seed.local",
      role: "Admin",
    },
    {
      id: "admin_3",
      name: "James W",
      email: "james@seed.local",
      role: "Admin",
    },
    {
      id: "admin_4",
      name: "Cam W",
      email: "cam@seed.local",
      role: "Human",
    },
    {
      id: "human_1",
      name: "Harmony Willow",
      email: "harmony.willow@gmail.com",
      role: "Human",
    },
    {
      id: "human_2",
      name: "Clara Optimist",
      email: "clara.optimist@gmail.com",
      role: "Human",
    },
    {
      id: "human_3",
      name: "Susan Brittle",
      email: "susan.brittle@gmail.com",
      role: "Human",
    },
  ] satisfies HumanSeed[],
};
