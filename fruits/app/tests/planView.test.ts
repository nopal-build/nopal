// What each side may press on a plan (Austin, 2026-11-03: guides pause and
// end a plan from the project). Gates: a guide's pause isn't the client's
// to undo; a guide can resume a pause nobody asked to end; both can end.
import { describe, expect, it, vi } from "vitest";
vi.mock("../util/email.server", () => ({ sendEmail: async () => {} }));
import { describePlan } from "../data/billingNotices.server";

const plan = (over: Record<string, unknown>) =>
  ({ _id: "attic", level: "guide", status: "active", start_date: null, pause_at: "2026-12-01T12:00:00Z", paused_at: null, current_period_end: "2026-12-01T12:00:00Z", next_amount_cents: 300000, pending_level: null, pending_at: null, ...over }) as never;

describe("who may press what on a plan", () => {
  it("a guide's pause can be undone by the guide, not the client", () => {
    const p = plan({ status: "pause_scheduled", pause_by: "guide" });
    expect(describePlan(p, "guide").canUndoPause).toBe(true);
    expect(describePlan(p, "client").canUndoPause).toBe(false);
  });
  it("a client's pause can be undone by either", () => {
    const p = plan({ status: "pause_scheduled", pause_by: "client" });
    expect(describePlan(p, "client").canUndoPause).toBe(true);
    expect(describePlan(p, "guide").canUndoPause).toBe(true);
  });
  it("only a guide resumes a paused plan outright; a client asks", () => {
    const p = plan({ status: "paused", paused_at: "2026-11-01T12:00:00Z" });
    expect(describePlan(p, "guide").canResumeNow).toBe(true);
    expect(describePlan(p, "client").canResumeNow).toBe(false);
    expect(describePlan(p, "client").canRequestResume).toBe(true);
  });
  it("both can pause and end a running plan", () => {
    for (const side of ["guide", "client"] as const) {
      expect(describePlan(plan({}), side)).toMatchObject({ canPause: true, canCancel: true });
    }
  });
});
