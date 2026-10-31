/**
 * A file that stops the worker is skipped after its second time
 * (2026-10-30): a GraphLog run that dies on a file is retried, keeps
 * what it finished, and reaches the same file again, so without this
 * every later run on that project dies there too.
 */
import { describe, expect, it } from "vitest";
import { poisonFileKey, poisonFiles, STRIKES_TO_SKIP, type PoisonFileStore } from "robustness-core/data/poisonFiles.server";

function memoryStore(): PoisonFileStore & { keys: Map<string, string> } {
  const keys = new Map<string, string>();
  return {
    keys,
    async get(k) { return keys.get(k) ?? null; },
    async set(k, v) { keys.set(k, v); return "OK"; },
    async del(k) { keys.delete(k); return 1; },
    async incr(k) { const n = (Number(keys.get(k)) || 0) + 1; keys.set(k, String(n)); return n; },
    async pexpire() { return 1; },
  };
}

const file = poisonFileKey("f1", "hash-a");

describe("a file the worker dies on", () => {
  it("a pass that ends normally leaves no strike", async () => {
    const store = memoryStore();
    const run1 = poisonFiles(store, "p1");
    expect(await run1.countLeftInFlight()).toBeNull();
    await run1.start(file);
    await run1.finish();
    expect(await poisonFiles(store, "p1").countLeftInFlight()).toBeNull();
    expect(await run1.strikes(file)).toBe(0);
  });

  it("each death on it is a strike, and the second reaches the skip", async () => {
    const store = memoryStore();
    for (let death = 1; death <= STRIKES_TO_SKIP; death++) {
      const pass = poisonFiles(store, "p1");
      await pass.countLeftInFlight();
      await pass.start(file); // ...and the process dies here.
    }
    const next = poisonFiles(store, "p1");
    expect(await next.countLeftInFlight()).toEqual({ file, strikes: STRIKES_TO_SKIP });
    expect(await next.strikes(file)).toBeGreaterThanOrEqual(STRIKES_TO_SKIP);
  });

  it("one death is not enough", async () => {
    const store = memoryStore();
    await poisonFiles(store, "p1").start(file);
    const next = poisonFiles(store, "p1");
    expect(await next.countLeftInFlight()).toEqual({ file, strikes: 1 });
    expect(await next.strikes(file)).toBeLessThan(STRIKES_TO_SKIP);
  });

  it("a replaced file starts clean, and another project's death isn't counted here", async () => {
    const store = memoryStore();
    for (let i = 0; i < STRIKES_TO_SKIP; i++) {
      await poisonFiles(store, "p1").start(file);
      await poisonFiles(store, "p1").countLeftInFlight();
    }
    expect(await poisonFiles(store, "p1").strikes(poisonFileKey("f1", "hash-b"))).toBe(0);
    await poisonFiles(store, "p2").start(poisonFileKey("f9", "h"));
    expect(await poisonFiles(store, "p1").countLeftInFlight()).toBeNull();
  });
});
