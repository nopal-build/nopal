/**
 * "Read the full log" in the pen (2026-10-01): each Card a line came from,
 * under the Logbook's own label, its photos by the ids the file tabs load,
 * and plain words when there is nothing, or something else, behind it.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OxRenderer from "../components/OxRenderer";
import { LogEntries, type CitedLogsForPen, type RenderCard } from "../oxmarkdown/marks";

const renderCard: RenderCard = (markdown, servedFileIds) => <OxRenderer markdown={markdown} servedFileIds={servedFileIds} />;

const GERALD = `Rows going on the west wall.

::file{name="IMG_7834.jpeg" caption fileId="orig7834" contentType="image/jpeg"}
`;

const logs = (over: Partial<CitedLogsForPen>): CitedLogsForPen => ({ entries: [], other: false, fileIds: {}, ...over });

describe("the log in the pen", () => {
  it("draws each Card under the Logbook's label, its photo by the project's copy", () => {
    const html = renderToStaticMarkup(
      <LogEntries
        logs={logs({
          entries: [
            { fileId: "c1", who: "Gerald", date: "2026-09-09", seeded: false, markdown: GERALD },
            { fileId: "s1", who: "Seed", date: "2026-04-01", seeded: true, markdown: "## Lucas\n\nPermit filed." },
          ],
          fileIds: { orig7834: "copy7834" },
        })}
        renderCard={renderCard}
      />,
    );
    expect(html.match(/data-cited-log/g)?.length).toBe(2);
    expect(html).toContain("Gerald · Wed, Sep 9");
    expect(html).toContain("Seed · Wed, Apr 1 · seeded history");
    expect(html).toContain("Rows going on the west wall.");
    expect(html).toContain("Permit filed.");
    expect(html).toContain('src="/api/vault/rendition/copy7834?size=thumb"');
    expect(html).not.toContain("orig7834");
    expect(html).not.toContain("not a daily log");
  });

  it("says so when nothing on the line is a log", () => {
    const html = renderToStaticMarkup(<LogEntries logs={logs({ other: true })} renderCard={renderCard} />);
    expect(html).toContain("There&#x27;s no daily log to show for this line.");
    expect(html).not.toContain("data-cited-log");
  });

  it("says so when part of it is a note or a seeded document", () => {
    const html = renderToStaticMarkup(
      <LogEntries
        logs={logs({ entries: [{ fileId: "c1", who: "Gerald", date: "2026-09-09", seeded: false, markdown: "A day." }], other: true })}
        renderCard={renderCard}
      />,
    );
    expect(html).toContain("Part of this line comes from a note or a seeded document, not a daily log.");
  });

  it("draws the Card with no pen of its own", () => {
    const html = renderToStaticMarkup(
      <LogEntries logs={logs({ entries: [{ fileId: "c1", who: "Gerald", date: "2026-09-09", seeded: false, markdown: "A day." }] })} renderCard={renderCard} />,
    );
    expect(html).not.toContain("data-mark-unit");
  });
});
