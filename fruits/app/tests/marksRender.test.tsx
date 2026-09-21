/**
 * The pen in OxRenderer (`oxmarkdown/marks.tsx`): every markable unit is
 * wrapped and keyed the same way the server keys it, marks land in the
 * margin beside their unit, and a render without `annotations` is exactly
 * what it was before.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { computeMarkUnitsFromMarkdown } from "oxmarkdown-core";
import OxRenderer from "../components/OxRenderer";
import type { OxAnnotations } from "../oxmarkdown/marks";

const ref = (name: string, file: string) =>
  `:ref{name="${name}" human-id="x" datetime="2026-09-09T12:00:00Z" location="/vault?file=${file}"}`;
const PAGE = `# Crouch

We are at the end of the climb. Nobody is logging the eaves.
## On the bench
### Gerald · Cladding · M

- Now: rows going on ${ref("Gerald L", "meo")}
  - last two rows on the west wall ${ref("Gerald L", "meo")}

:::gallery{}
![northwest corner](/api/vault/view/ntfc5km0612jeex7fjiv)
:::
`;

describe("the pen", () => {
  const units = computeMarkUnitsFromMarkdown(PAGE);
  const now = units.find((u) => u.text.startsWith("Now:"))!;

  it("changes nothing when it is off", () => {
    const off = renderToStaticMarkup(<OxRenderer markdown={PAGE} />);
    expect(off).not.toContain("data-mark-unit");
    expect(off).not.toContain("ox-mark");
  });

  it("wraps every unit the server can mark, with the server's key", () => {
    const annotations: OxAnnotations = { marks: [], viewerId: "admin_1", canMark: true, onSend: async () => null };
    const html = renderToStaticMarkup(<OxRenderer markdown={PAGE} annotations={annotations} />);
    const keys = [...html.matchAll(/data-mark-unit="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(units.map((u) => u.key).sort());
    expect(html).not.toContain("ox-mark-notes");
  });

  it("puts marks in the margin beside their unit, stacked", () => {
    const annotations: OxAnnotations = {
      canMark: false,
      viewerId: "admin_1",
      marks: [
        { id: "a", unitKey: now.key, authorHumanId: "admin_2", authorName: "Lucas J", date: "2026-09-18", text: "Eaves started Monday." },
        { id: "b", unitKey: now.key, authorHumanId: "admin_3", authorName: "james@seed.local", date: "2026-09-19", text: "Plywood on site?" },
      ],
    };
    const html = renderToStaticMarkup(<OxRenderer markdown={PAGE} annotations={annotations} />);
    expect(html).toContain("Eaves started Monday.");
    expect(html).toContain("Lucas, Sep 18");
    expect(html).toContain("James, Sep 19");
    expect(html.match(/class="ox-mark-note"/g)?.length).toBe(2);
    expect(html).toContain("ox-markable--marked");
  });
});
