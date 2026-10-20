/**
 * The nightly runs once per project per night, however many fruits
 * machines fire the midnight cron (2026-10-20: production's two machines
 * ran every project twice; Hot box paid for both).
 */
import { describe, expect, it } from "vitest";
import { enqueueNightlyGraphLogJob, nightlyGraphLogJobId, uniqueJobId } from "robustness-core/data/graphLogQueue.server";

/** A queue that keeps jobs by id, the way BullMQ does: an add whose id is
 * already there changes nothing. Handed in, so no Redis is touched. */
function fakeQueue() {
  const jobs = new Map<string, unknown>();
  return {
    jobs,
    async getJob(id: string) {
      return jobs.has(id) ? ({ id } as never) : undefined;
    },
    async add(_name: string, data: unknown, opts?: { jobId?: string }) {
      const id = opts?.jobId ?? String(jobs.size + 1);
      if (!jobs.has(id)) jobs.set(id, data);
      return { id } as never;
    },
  };
}

describe("the nightly runs once per project per night", () => {
  it("two machines either side of midnight name the same night", () => {
    const early = nightlyGraphLogJobId("abc", new Date("2026-10-20T23:59:58Z"));
    const late = nightlyGraphLogJobId("abc", new Date("2026-10-21T00:00:03Z"));
    expect(early).toBe(late);
    expect(late).toBe("nightly-abc-2026-10-21");
    expect(nightlyGraphLogJobId("abc", new Date("2026-10-22T00:00:01Z"))).not.toBe(late);
    expect(nightlyGraphLogJobId("xyz", new Date("2026-10-21T00:00:03Z"))).not.toBe(late);
  });

  it("a second machine's enqueue is a no-op", async () => {
    const queue = fakeQueue();
    const data = { actingHumanId: "h1", projectFolderId: "p1" };
    const first = await enqueueNightlyGraphLogJob(data, new Date("2026-10-21T00:00:01Z"), queue);
    const second = await enqueueNightlyGraphLogJob(data, new Date("2026-10-21T00:00:02Z"), queue);
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ jobId: first.jobId, duplicate: true });
    expect(queue.jobs.size).toBe(1);
  });
});

describe("a run's id never repeats", () => {
  it("carries the job, the time and a random part, so a Redis wipe cannot reuse one", () => {
    const now = new Date("2026-10-20T20:45:00Z");
    const id = uniqueJobId("rerun-outputs", now);
    expect(id).toMatch(/^rerun-outputs-20261020T204500-[0-9a-f]{6}$/);
    const ids = new Set(Array.from({ length: 200 }, () => uniqueJobId("run", now)));
    expect(ids.size).toBe(200);
  });
});
