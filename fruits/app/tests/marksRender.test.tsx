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

  it("loads a browser-sized rendition in the gallery while the markdown still names the original", () => {
    const html = renderToStaticMarkup(<OxRenderer markdown={PAGE} />);
    expect(html).toContain('src="/api/vault/rendition/ntfc5km0612jeex7fjiv?size=display"');
    expect(html).not.toContain('src="/api/vault/view/ntfc5km0612jeex7fjiv"');
    // The pen keys the photo off the markdown URL, which did not change.
    expect(units.find((u) => u.kind === "photo")?.attachmentId).toBe("ntfc5km0612jeex7fjiv");
  });

  it("wraps every unit the server can mark, with the server's key", () => {
    const annotations: OxAnnotations = { marks: [], viewerId: "admin_1", canMark: true, onSend: async () => null };
    const html = renderToStaticMarkup(<OxRenderer markdown={PAGE} annotations={annotations} />);
    const keys = [...html.matchAll(/data-mark-unit="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(units.map((u) => u.key).sort());
    expect(html).not.toContain("ox-mark-notes");
  });

  it("writes each sentence's notes right after that sentence, not at the end of the paragraph", () => {
    // The notes float into the margin, so where they sit in the flow is
    // where they land beside the prose. Pooling them at the end put a
    // note about the last sentence level with the first.
    const two = computeMarkUnitsFromMarkdown(PAGE).filter((u) => u.kind === "sentence").slice(0, 2);
    const annotations: OxAnnotations = {
      canMark: false,
      viewerId: "admin_1",
      marks: [
        { id: "a", unitKey: two[0].key, authorHumanId: "admin_2", authorName: "Lucas J", date: "2026-09-18", text: "FIRST NOTE" },
        { id: "b", unitKey: two[1].key, authorHumanId: "admin_2", authorName: "Lucas J", date: "2026-09-18", text: "SECOND NOTE" },
      ],
    };
    const html = renderToStaticMarkup(<OxRenderer markdown={PAGE} annotations={annotations} />);
    // Each note follows the words it is about, so the first note lands
    // before the second sentence's own text begins.
    const firstNote = html.indexOf("FIRST NOTE");
    const secondSentence = html.indexOf("Nobody is logging");
    const secondNote = html.indexOf("SECOND NOTE");
    expect(firstNote).toBeGreaterThan(-1);
    expect(firstNote).toBeLessThan(secondSentence);
    expect(secondSentence).toBeLessThan(secondNote);
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
