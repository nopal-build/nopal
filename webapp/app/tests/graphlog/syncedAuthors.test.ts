/**
 * A synced Daily Log copy shows who wrote it (2026-10-05). The name stays
 * `<date>-<humanId>.md`, since sync-graph, the Logbook and Moves read the
 * writer back out of it; a listing adds `author_name` beside it.
 */
import { describe, expect, it } from "vitest";
import { syncedAuthorId, withAuthorNames } from "robustness-core/data/syncedAuthors.server";
import type { FileRefListing } from "robustness-core/data/vault.types";

const file = (name: string) => ({ _id: name, name }) as FileRefListing;
const names = new Map([["qf19nvwaou46asel8fqa", "Erica Campbell"]]);

describe("who wrote a synced copy", () => {
  it("reads the writer from a Card copy and from an attachment", () => {
    expect(syncedAuthorId("2026-10-04-qf19nvwaou46asel8fqa.md")).toBe("qf19nvwaou46asel8fqa");
    expect(syncedAuthorId("2026-09-30-admin_2-IMG_7866.jpeg")).toBe("admin_2");
    expect(syncedAuthorId("graph-structure.md")).toBeNull();
  });

  it("names the files it can and leaves the rest as they were", () => {
    const [erica, gone, other] = withAuthorNames(
      [file("2026-10-04-qf19nvwaou46asel8fqa.md"), file("2026-10-04-nobody.md"), file("readme.md")],
      names,
    );
    expect(erica.author_name).toBe("Erica Campbell");
    expect(erica.name).toBe("2026-10-04-qf19nvwaou46asel8fqa.md");
    expect(gone).not.toHaveProperty("author_name");
    expect(other).not.toHaveProperty("author_name");
  });
});
