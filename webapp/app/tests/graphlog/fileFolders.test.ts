/**
 * The files view (2026-09-22): four folders that are projections over
 * the daily logs' attachments. Rows are keyed by the original id and
 * served by the synced copy; a kind is the person's if they filed it,
 * else the model's; a cost is confirmed only by an act that names the
 * current reading. Nothing here writes (ADR-019) and nothing unconfirmed
 * reaches the confirmed list (ADR-020).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  confirmedCosts,
  extractAttachmentsWithContext,
  foldersOf,
  matchesQuery,
  projectFileRows,
  type FileFoldersInput,
} from "robustness-core/data/fileFolders.server";
import { buildFilingContent, filingValuesHash, type Filing } from "robustness-core/data/syncFiling.server";
import type { GraphLogMark } from "robustness-core/data/graphLogMarks.server";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const CARD = `## Electrical
The new switch that was supposed to be installed, but was not.

::file{name="IMG_6953.jpeg" caption="The plan with the switch circled" fileId="origplan" contentType="image/jpeg"}

Picked up screws and poly tube at Ace on the way in.

::file{name="IMG_6959.jpeg" caption fileId="origreceipt" contentType="image/jpeg"}
::file{name="IMG_9999.jpeg" caption fileId="orignew" contentType="image/jpeg"}
`;

const receiptFiling: Filing = {
  kind: "receipt",
  reason: "A printed store receipt with a total line.",
  cost: { vendor: "Ace Hardware", amount: "25.16", currency: "USD", date: "2026-06-19", readFrom: ["TOTAL: $ 25.16"] },
};
const planFiling: Filing = { kind: "drawing", reason: "A reflected ceiling plan with fixture symbols.", cost: null };

const filingFile = (name: string, filing: Filing) => ({
  name,
  content: buildFilingContent({ sourceFileId: "x", hash: "h", skillFingerprint: "fp", describedFrom: "image", filing }),
});

const mark = (over: Partial<GraphLogMark> & { unit: GraphLogMark["unit"] }): GraphLogMark =>
  ({
    _id: "m1",
    project_folder_id: "p",
    author_human_id: "admin_1",
    date: "2026-09-22",
    created_at: "2026-09-22T10:00:00Z",
    text: "",
    page_hash: null,
    kind: null,
    read_at: null,
    read_date: null,
    move_id: null,
    act: null,
    ...over,
  }) as unknown as GraphLogMark;

const fileUnit = (id: string): GraphLogMark["unit"] => ({ key: `file:${id}`, kind: "file", section: "", effort: "", text: id, refs: [], attachmentId: id });

function input(over: Partial<FileFoldersInput> = {}): FileFoldersInput {
  const attachments = extractAttachmentsWithContext(CARD).map((a) => ({ ...a, cardFileId: "card1", authorHumanId: "admin_2", date: "2026-08-19" }));
  return {
    attachments,
    originals: new Map([
      ["origplan", { content_type: "image/jpeg", size: 100 }],
      ["origreceipt", { content_type: "image/jpeg", size: 200 }],
      ["orignew", { content_type: "image/jpeg", size: 300 }],
    ]),
    // Two copies exist; the third file has not been synced yet. The Card's
    // own copy is what a file mark cites.
    dailyFiles: [
      { _id: "cardcopy0819", name: "2026-08-19-admin_2.md", content_type: "text/markdown", size: 10 },
      { _id: "copyplan", name: "2026-08-19-admin_2-IMG_6953.jpeg", content_type: "image/jpeg", size: 100 },
      { _id: "copyreceipt", name: "2026-08-19-admin_2-IMG_6959.jpeg", content_type: "image/jpeg", size: 200 },
    ],
    knowledgeFiles: [
      { name: "2026-08-19-admin_2-IMG_6953.knowledge.md", content: "---\nsource: x\n---\n\nA plan with a switch circled in green." },
      filingFile("2026-08-19-admin_2-IMG_6953.filing.md", planFiling),
      filingFile("2026-08-19-admin_2-IMG_6959.filing.md", receiptFiling),
    ],
    graphFiles: [
      {
        name: "graph-log-2026-08-19.md",
        content: `---\ndate: 2026-08-19\n---\n\n### Node 6\n==Photo of the plan==\n\n![plan](/api/vault/view/copyplan)\n:ref{name="Lucas J" human-id="admin_2" datetime="2026-08-19T12:00:00Z" location="/vault?file=c"}\n`,
      },
      { name: "graph-structure.md", content: "---\nx: y\n---\n\n## Electrical rough-in\nWeight: 1\n- 2026-08-19 Node 6 (Lucas J) — the plan\n" },
      { name: "efforts.md", content: "x\n\n```json\n{\"efforts\":[{\"name\":\"Lucas · Electrical · M\",\"person\":\"Lucas\",\"threads\":[\"Electrical rough-in\"]}]}\n```" },
    ],
    marks: [],
    names: new Map([
      ["admin_2", "Lucas J"],
      ["admin_1", "Austin"],
    ]),
    ...over,
  };
}

describe("the record side: a Card's attachments with the words around them", () => {
  it("finds a file inside a list item, with the item's words as its context", () => {
    const a = extractAttachmentsWithContext("- Picked up the permit today\n\n  ::file{name=\"permit.pdf\" fileId=\"abc123\" contentType=\"application/pdf\"}\n");
    expect(a).toHaveLength(1);
    expect(a[0].context).toBe("Picked up the permit today");
  });

  it("pairs each file with the block above it, in order", () => {
    const a = extractAttachmentsWithContext(CARD);
    expect(a.map((x) => x.fileId)).toEqual(["origplan", "origreceipt", "orignew"]);
    expect(a[0].context).toBe("The new switch that was supposed to be installed, but was not.");
    expect(a[0].caption).toBe("The plan with the switch circled");
    expect(a[1].context).toBe("Picked up screws and poly tube at Ace on the way in.");
    expect(a[2].context).toBe(a[1].context);
  });
});

describe("rows: keyed by the original, served by the copy", () => {
  const rows = projectFileRows(input());
  const plan = rows.find((r) => r.fileId === "origplan")!;
  const receipt = rows.find((r) => r.fileId === "origreceipt")!;
  const fresh = rows.find((r) => r.fileId === "orignew")!;

  it("serves a synced file by its copy and an unsynced one by its original", () => {
    expect(plan.serveId).toBe("copyplan");
    expect(plan.cardCopyFileId).toBe("cardcopy0819");
    expect(plan.urls.display).toBe("/api/vault/rendition/copyplan?size=display");
    expect(fresh.serveId).toBe("orignew");
    expect(fresh.copyFileId).toBeNull();
  });

  it("carries the model's reading and the description", () => {
    expect(plan.kind).toBe("drawing");
    expect(plan.kindSource).toBe("model");
    expect(plan.description).toBe("A plan with a switch circled in green.");
    expect(fresh.kind).toBe("unfiled");
    expect(fresh.kindSource).toBe("none");
  });

  it("finds the nodes that cite the copy, and their thread and effort", () => {
    expect(plan.nodes).toEqual([{ id: "2026-08-19#6", date: "2026-08-19", number: 6 }]);
    expect(plan.threads).toEqual(["Electrical rough-in"]);
    expect(plan.efforts).toEqual(["Lucas · Electrical · M"]);
    expect(receipt.nodes).toEqual([]);
  });

  it("puts a receipt photo in Gallery and in Costs, and it is one row", () => {
    expect(receipt.folders).toEqual(["gallery", "costs"]);
    expect(rows.filter((r) => r.fileId === "origreceipt")).toHaveLength(1);
    expect(plan.folders).toEqual(["gallery", "documents"]);
    expect(fresh.folders).toEqual(["gallery"]);
  });

  it("reads a cost as unconfirmed until a person confirms the current reading", () => {
    expect(receipt.cost).toMatchObject({ vendor: "Ace Hardware", amount: "25.16", status: "unconfirmed", by: null });
  });
});

describe("a person's acts override and confirm", () => {
  it("the latest file-as wins over the model", () => {
    const rows = projectFileRows(
      input({
        marks: [
          mark({ _id: "a", created_at: "2026-09-22T09:00:00Z", unit: fileUnit("origplan"), act: { kind: "file-as", fileKind: "spec" }, text: "Filed as spec." }),
          mark({ _id: "b", created_at: "2026-09-22T11:00:00Z", unit: fileUnit("origplan"), act: { kind: "file-as", fileKind: "permit" }, text: "Filed as permit." }),
        ],
      }),
    );
    const plan = rows.find((r) => r.fileId === "origplan")!;
    expect(plan.kind).toBe("permit");
    expect(plan.kindSource).toBe("person");
    expect(plan.acts.map((a) => a.text)).toEqual(["Filed as permit.", "Filed as spec."]);
  });

  it("a confirmation stands only while it names the current reading", () => {
    const of = filingValuesHash(receiptFiling);
    const confirm = (hash: string) =>
      mark({
        _id: "c",
        unit: fileUnit("origreceipt"),
        act: { kind: "confirm-cost", verdict: "correct", of: hash, vendor: "Ace Hardware", amount: "25.16", currency: "USD", date: "2026-06-19" },
        text: "Confirmed correct: Ace Hardware, 25.16 USD, 2026-06-19.",
      });
    const confirmed = projectFileRows(input({ marks: [confirm(of)] })).find((r) => r.fileId === "origreceipt")!;
    expect(confirmed.cost).toMatchObject({ status: "correct", by: "Austin", on: "2026-09-22" });
    const stale = projectFileRows(input({ marks: [confirm("someolderhash")] })).find((r) => r.fileId === "origreceipt")!;
    expect(stale.cost?.status).toBe("unconfirmed");
  });

  it("a person filing a photo as a receipt makes a cost with nothing read yet", () => {
    const rows = projectFileRows(input({ marks: [mark({ unit: fileUnit("orignew"), act: { kind: "file-as", fileKind: "receipt" }, text: "Filed as receipt." })] }));
    const fresh = rows.find((r) => r.fileId === "orignew")!;
    expect(fresh.folders).toEqual(["gallery", "costs"]);
    expect(fresh.cost).toMatchObject({ vendor: null, amount: null, status: "unconfirmed" });
  });
});

describe("folders and search", () => {
  it("sends the model's `other` to Unsorted and a person's `other` to Documents", () => {
    expect(foldersOf({ contentType: "application/pdf", kind: "other", kindSource: "model" })).toEqual(["unsorted"]);
    expect(foldersOf({ contentType: "application/pdf", kind: "other", kindSource: "person" })).toEqual(["documents"]);
    expect(foldersOf({ contentType: "application/pdf", kind: "unfiled", kindSource: "none" })).toEqual(["unsorted"]);
    expect(foldersOf({ contentType: "video/quicktime", kind: "video", kindSource: "model" })).toEqual(["gallery"]);
  });

  it("finds a file by what it is about, not its name", () => {
    const rows = projectFileRows(input());
    const receipt = rows.find((r) => r.fileId === "origreceipt")!;
    expect(matchesQuery(receipt, "ace")).toBe(true); // vendor, and the log line
    expect(matchesQuery(receipt, "TOTAL: $ 25")).toBe(true); // a read-from line
    expect(matchesQuery(rows.find((r) => r.fileId === "origplan")!, "switch circled")).toBe(true); // description
    expect(matchesQuery(receipt, "cladding")).toBe(false);
    expect(matchesQuery(receipt, "")).toBe(true);
  });
});

describe("ADR-020: nothing reaches a budget unconfirmed", () => {
  it("confirmedCosts drops every row whose latest act is not a confirmation of the current values", () => {
    const of = filingValuesHash(receiptFiling);
    const rows = projectFileRows(
      input({
        marks: [mark({ unit: fileUnit("origreceipt"), act: { kind: "confirm-cost", verdict: "accepted", of, vendor: "Ace Hardware", amount: "25.16", currency: "USD", date: "2026-06-19" }, text: "Accepted: …" })],
      }),
    );
    expect(confirmedCosts(rows).map((r) => r.fileId)).toEqual(["origreceipt"]);
    expect(confirmedCosts(projectFileRows(input()))).toEqual([]);
  });
});

describe("ADR-019: a folder is a projection; a file never moves", () => {
  it("the files module has no write path", () => {
    const src = readFileSync(path.join(REPO_ROOT, "packages/robustness-core/src/data/fileFolders.server.ts"), "utf8");
    for (const forbidden of ["updateFileRef", "createFileRef", "deleteFileRef", "moveVaultFolder", "copyFileIntoFolder", "upsert(", "uploadPrivateFileToS3"]) {
      expect(src.includes(forbidden), `fileFolders.server.ts mentions ${forbidden}`).toBe(false);
    }
  });
});
