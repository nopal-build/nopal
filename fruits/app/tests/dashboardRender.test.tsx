/**
 * The dashboard as rendered (2026-09-23 round). Gates the markup half of
 * tests 1 and 2 (the meter and the log box are on the landing screen for
 * every seat) and test 3 (a steep note has no alarm in it). The tap half
 * of 1 and 2 is a Playwright walk on a phone-sized viewport against the
 * local stack, and Austin's phone in production.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DashboardView } from "../components/DashboardView";
import type { Dashboard, DashboardRow } from "robustness-core/data/dashboard.server";

const counts = { active: 2, completed: 0, trashed: 0 };
const row = (over: Partial<DashboardRow>): DashboardRow => ({
  id: "a1b2c3d4e5f6g7h8i9j0",
  name: "Crouch Casita",
  seat: "guide",
  status: "active",
  statusAt: null,
  ask: "Pick the window supplier this week.",
  read: null,
  notes: [],
  canTap: true,
  mine: null,
  ...over,
});

// A data router, since today's log (TodayLog) uses fetchers and revalidation.
function render(dashboard: Dashboard) {
  const element = (
    <DashboardView
      activeStatus="active"
      dashboard={dashboard}
      log={{ entries: [], cardsByDate: {}, projectFolders: [] }}
    />
  );
  const router = createMemoryRouter([{ path: "/", element }]);
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

const clientDash: Dashboard = {
  counts: null,
  view: "client",
  rows: [row({ seat: "client", ask: null, read: "Framing is on track." })],
  topMeterProjectId: "a1b2c3d4e5f6g7h8i9j0",
};
const guideDash: Dashboard = {
  counts,
  view: "guide",
  rows: [
    row({
      notes: [{ who: "Dana", position: "oh-crap", date: "2026-09-23", previous: "uphill" }],
    }),
    row({ id: "q9w8e7r6t5y4u3i2o1p0", name: "Coronado ADU", ask: null }),
  ],
  topMeterProjectId: null,
};
const observerDash: Dashboard = {
  counts,
  view: "guide",
  rows: [row({ seat: "observer", canTap: false })],
  topMeterProjectId: null,
};

describe("the ritual is on the landing screen (tests 1 and 2, markup)", () => {
  it("a client: the log box, then the meter, before anything else", () => {
    const html = render(clientDash);
    const meter = html.indexOf("data-steep-meter");
    const box = html.indexOf("data-log-box");
    const project = html.indexOf("data-project-row");
    expect(box).toBeGreaterThan(-1);
    expect(meter).toBeGreaterThan(box);
    expect(project).toBeGreaterThan(meter);
  });

  it("a guide on two projects: the log box on top, a meter on each row", () => {
    const html = render(guideDash);
    expect(html.indexOf("data-log-box")).toBeLessThan(html.indexOf("data-project-row"));
    expect(html.match(/data-steep-meter=/g)?.length).toBe(2);
  });

  it("an observer: the log box, and no meter", () => {
    const html = render(observerDash);
    expect(html).toContain("data-log-box");
    expect(html).not.toContain("data-steep-meter");
  });
});

describe("no freak-out (test 3, markup)", () => {
  it("an Oh crap reading is one plain line, with nothing that reads as an alarm", () => {
    const html = render(guideDash);
    const note = html.slice(html.indexOf("data-steep-note"), html.indexOf("</p>", html.indexOf("data-steep-note")));
    expect(note).toContain("Dana: Oh crap on Sep 23, was Uphill");
    expect(note).not.toMatch(/danger|warning|alert|red|error|badge/i);
  });
});

describe("a client is never counted or nagged", () => {
  it("no status tabs, no counts, no 'last logged'", () => {
    const html = render(clientDash);
    expect(html).not.toMatch(/\(\d+\)/);
    expect(html).not.toMatch(/Active|Completed|Trashed/);
    expect(html).not.toMatch(/streak|days since|last logged/i);
    expect(html).toContain("Framing is on track.");
  });
});

describe("the Steep-o-meter is a gauge with the words on it", () => {
  it("five words around the dial, each a button, none chosen before a tap, nothing coloured", async () => {
    const { SteepGauge } = await import("../components/SteepGauge");
    const html = renderToStaticMarkup(<SteepGauge projectFolderId="a1b2c3d4e5f6g7h8i9j0" mine={null} />);
    for (const word of ["Flat", "Rolling", "Uphill", "Steep", "Oh crap"]) expect(html).toContain(`>${word}</button>`);
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(5);
    expect(html).toContain("How steep is this stretch?");
    expect(html).not.toMatch(/danger|warning|alert|red|#[0-9a-f]{3,6}/i);
  });
});
