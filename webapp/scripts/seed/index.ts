// =============================================================================
// Seed Runner
// Run via: npm run seed:data
// =============================================================================

import { RecordId } from "surrealdb";
import { getDb } from "../../app/data/db.server";
import { humansSeed } from "./tables/humans";
import { projectsSeed } from "./tables/projects";
import { provisionNewUserVault } from "../../app/data/dailyLog.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The shape of one record as it goes into the seed — no auto-generated fields.
 * `id` is required so seeds are deterministic and idempotent (upsert by key).
 */
export type SeedRecord<T> = Omit<T, "id" | "_id"> & { id: string };

/**
 * A self-contained seed definition for one SurrealDB table.
 *
 * @example
 * const humansSeed: SeedTable<Human> = {
 *   table: "humans",
 *   records: [{ id: "super_1", name: "Ada", email: "ada@example.com", role: "Super" }],
 * };
 */
export type SeedTable<T = Record<string, unknown>> = {
  /** SurrealDB table name, e.g. "humans" */
  table: string;
  /** Rows to upsert. Each `id` becomes `table:id` in SurrealDB. */
  records: SeedRecord<T>[];
};

// ---------------------------------------------------------------------------
// Registry — add new SeedTable imports and list them here
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const seeds: SeedTable<any>[] = [humansSeed, projectsSeed];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runSeed() {
  console.log("🌱 Starting database seed…");

  const db = await getDb();

  try {
    for (const { table, records } of seeds) {
      console.log(`\n  Table: ${table} (${records.length} record(s))`);

      for (const { id, ...data } of records) {
        const thing = new RecordId(table, id);
        await db.upsert(thing, data);
        console.log(`    ✓  ${table}:${id}`);
      }
    }

    // Provision the daily-logs vault folder + sample entry for every seeded human
    console.log("\n  Provisioning vault for seeded humans…");
    for (const human of humansSeed.records) {
      await provisionNewUserVault(human.id);
      console.log(`    ✓  vault provisioned for humans:${human.id}`);
    }

    console.log("\n✅  Seed complete.\n");
  } catch (err) {
    console.error("\n❌  Seed failed:", err);
    process.exit(1);
  } finally {
    await db.close();
  }
}

runSeed();
