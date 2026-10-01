/**
 * The dashboard as rendered. My Projects is projects only (2026-09-28):
 * no log box, no meter. Test 3 (a steep note has no alarm in it) stands.
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
  role: "Guide",
  status: "active",
  statusAt: null,
  read: null,
  ask: "Pick the window supplier this week.",
  notes: [],
  canTap: true,
  mine: null,
  ...over,
});

// A data router, since the rows are links.
function render(dashboard: Dashboard) {
  const element = <DashboardView activeStatus="active" dashboard={dashboard} />;
  const router = createMemoryRouter([{ path: "/", element }]);
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

const clientDash: Dashboard = {
  counts: null,
  view: "client",
  rows: [row({ role: "Client", ask: null })],
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
const watcherDash: Dashboard = {
  counts,
  view: "guide",
  rows: [row({ role: "Observer" })],
  topMeterProjectId: "a1b2c3d4e5f6g7h8i9j0",
};

describe("My Projects is projects only (2026-09-28)", () => {
  it("no log box and no meter, for anyone: the log is on the Daily Log page, the meter on the project", () => {
    for (const dash of [clientDash, guideDash, watcherDash]) {
      const html = render(dash);
      expect(html).not.toContain("data-log-box");
      expect(html).not.toContain("data-steep-meter");
    }
  });

  it("a client: each project, named, a way in", () => {
    const html = render({
      ...clientDash,
      rows: [row({ role: "Client", ask: null }), row({ id: "q9w8e7r6t5y4u3i2o1p0", name: "Coronado ADU", role: "Client", ask: null })],
    });
    expect(html).toContain("/newspaper/a1b2c3d4e5f6g7h8i9j0");
    expect(html).toContain("/newspaper/q9w8e7r6t5y4u3i2o1p0");
    expect(html).not.toContain("window supplier");
  });

  it("client on one project inside a guide's screen: both rows lead to their page", () => {
    const html = render({
      ...guideDash,
      rows: [guideDash.rows[0], row({ id: "q9w8e7r6t5y4u3i2o1p0", name: "Campbell", role: "Client", ask: null })],
    });
    expect(html).toContain("/newspaper/a1b2c3d4e5f6g7h8i9j0");
    expect(html).toContain("/newspaper/q9w8e7r6t5y4u3i2o1p0");
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
