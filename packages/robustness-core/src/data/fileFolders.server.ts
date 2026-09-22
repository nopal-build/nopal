/**
 * The project's files as four folders that are views, not places.
 *
 * A file's home is the daily-log Card it was attached to, and it never
 * moves. Everything here is a projection rebuilt on every request from
 * the record and the pipeline's outputs: the Card's `::file{...}`
 * directive (original id, caption, author, day, the words around it),
 * the synced copy in `Syncs/Daily Logs/` (the id the graph cites and a
 * collaborator can open), the description sidecar and the filing record
 * in `_knowledge/`, the nodes that cite the copy and the threads and
 * efforts those nodes sit in, and the marks people have made on the
 * file. Nothing is written by this module (ADR-019); the test pins it.
 *
 * Two ids, one file. The original sits in the writer's own day folder
 * and is readable by the writer alone; daily-log-sync copies it into the
 * project's `Syncs/Daily Logs/` with a new id, and that copy is what the
 * graph cites and what a collaborator can open. Rows are keyed by the
 * original (it survives a refile; the copy's id does not) and served by
 * the copy (`serveId`) wherever one exists.
 *
 * Who decides what. Code: what kind of file (by content type), which
 * folder a kind lands in, the joins, the search. The model: the document
 * kind and a cost's values, in the filing record. A person: the latest
 * `file-as` act overrides the model's kind; a cost is confirmed only by a
 * `confirm-cost` act that names the current reading. `confirmedCosts` is
 * the only list of costs this module exports, and it never holds an
 * unconfirmed one (ADR-020).
 */

import { parseOxDocument } from "oxmarkdown-core";
import { listCardsForProject } from "./dailyLog.server";
import { syncedAttachmentFileName, syncedCardFileName } from "./dailyLogSync.server";
import { readEffortsSidecar, EFFORTS_SIDECAR_FILE_NAME } from "./effortReadings.server";
import { authorNames, listFileMarks, type FileAct, type GraphLogMark, type MarkUnitSnapshot } from "./graphLogMarks.server";
import { parseGraphLogNodes, type GraphLogNode } from "./graphNodeIndex.server";
import { nodeIdsInSection } from "./graphStructure.server";
import { splitFrontmatter, splitReadmeSections } from "./project.types";
import { findProjectGraphFolder } from "./projectN02.server";
import { filingFileName, filingValuesHash, isCostKind, readFilingRecord, type Filing, type FilingKind } from "./syncFiling.server";
import { KNOWLEDGE_FOLDER_NAME, knowledgeFileName } from "./syncKnowledge.server";
import { getFileRefListingsByIds, getFileRefsByFolderIds, listFolderChildren, type VaultFolder } from "./vault.server";

export type CardAttachment = {
  /** The original file's id, as the Card names it. */
  fileId: string;
  name: string;
  caption: string;
  /** The words nearest the file in the log: the paragraph or heading
   * just above its directive, following the rule that the log is the
   * caption. "" when the file opens the entry. */
  context: string;
  /** The Card it is attached to. */
  cardFileId: string;
  authorHumanId: string;
  date: string;
};

type AnyNode = { type: string; name?: string; value?: string; attributes?: Record<string, string | null | undefined>; children?: AnyNode[] };

function plainText(node: AnyNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  if (node.type === "leafDirective" || node.type === "textDirective") return "";
  return (node.children ?? []).map(plainText).join("");
}

/** Every `::file{...}` in a Card with the block just above it, in order:
 * the same directives `extractFileAttachments` finds (a depth-first walk,
 * so a file inside a list item is found too), each paired with the
 * nearest paragraph or heading before it at any depth. */
export function extractAttachmentsWithContext(markdown: string): Omit<CardAttachment, "cardFileId" | "authorHumanId" | "date">[] {
  const doc = parseOxDocument(markdown) as unknown as AnyNode;
  const out: Omit<CardAttachment, "cardFileId" | "authorHumanId" | "date">[] = [];
  let context = "";
  const visit = (node: AnyNode): void => {
    if (node.type === "leafDirective" && node.name === "file") {
      const attrs = node.attributes ?? {};
      if (attrs.fileId) {
        out.push({ fileId: attrs.fileId, name: attrs.name || "file", caption: (attrs.caption ?? "").trim(), context });
      }
      return;
    }
    if (node.type === "paragraph" || node.type === "heading") {
      const text = plainText(node).replace(/\s+/g, " ").trim();
      if (text) context = text;
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const child of doc.children ?? []) visit(child);
  return out;
}

/** Every attachment named by any Card of the project, in Card order. */
export async function listCardAttachments(projectFolderId: string): Promise<CardAttachment[]> {
  const cards = await listCardsForProject(projectFolderId);
  const out: CardAttachment[] = [];
  for (const card of cards) {
    for (const a of extractAttachmentsWithContext(card.content)) {
      out.push({ ...a, cardFileId: card.fileId, authorHumanId: card.humanId, date: card.date });
    }
  }
  return out;
}

/** The unit a mark on a file carries: the file by its original id, and
 * the entry it was attached to as the one citation. Server-built from a
 * row; never produced by `computeMarkUnits`. The citation's `fileId` is
 * the synced copy of that Card when one exists, so `describeRef` and the
 * page's re-anchor rules see the same shape they see on a page mark. */
export function fileMarkUnit(row: Pick<ProjectFileRow, "fileId" | "name" | "caption" | "authorName" | "authorHumanId" | "date" | "cardCopyFileId">): MarkUnitSnapshot {
  return {
    key: `file:${row.fileId}`,
    kind: "file",
    section: "",
    effort: "",
    text: row.caption || row.name,
    refs: [{ name: row.authorName, humanId: row.authorHumanId, date: row.date, fileId: row.cardCopyFileId }],
    attachmentId: row.fileId,
  };
}

// ── The projection ───────────────────────────────────────────────────────────

export const FILE_FOLDERS = ["gallery", "documents", "costs", "unsorted"] as const;
export type FileFolder = (typeof FILE_FOLDERS)[number];

export type CostStatus = "unconfirmed" | "correct" | "accepted";

export type FileActRecord = {
  id: string;
  authorHumanId: string;
  authorName: string;
  date: string;
  createdAt: string;
  text: string;
  act: FileAct | null;
};

export type ProjectFileRow = {
  /** The original id: the key. */
  fileId: string;
  /** The copy's id when one exists, else the original. What URLs use. */
  serveId: string;
  name: string;
  contentType: string;
  size: number | null;
  date: string;
  authorHumanId: string;
  authorName: string;
  caption: string;
  context: string;
  cardFileId: string;
  /** The synced copy of the Card, when one exists: what a file mark cites. */
  cardCopyFileId: string | null;
  copyFileId: string | null;
  description: string | null;
  filing: Filing | null;
  /** The kind the row is filed under, and who said so. */
  kind: FilingKind | "unfiled";
  kindSource: "person" | "model" | "none";
  reason: string | null;
  cost: null | {
    vendor: string | null;
    amount: string | null;
    currency: string | null;
    date: string | null;
    readFrom: string[];
    status: CostStatus;
    by: string | null;
    on: string | null;
  };
  nodes: { id: string; date: string; number: number }[];
  threads: string[];
  efforts: string[];
  acts: FileActRecord[];
  folders: FileFolder[];
  urls: { thumb: string; display: string; original: string; poster: string | null };
};

export type FileFoldersInput = {
  attachments: CardAttachment[];
  originals: Map<string, { content_type: string; size?: number | null }>;
  dailyFiles: { _id: string; name: string; content_type: string; size?: number | null }[];
  knowledgeFiles: { name: string; content: string | null }[];
  graphFiles: { name: string; content: string | null }[];
  marks: GraphLogMark[];
  names: Map<string, string>;
};

const VIEW_ID_RE = /\/api\/vault\/view\/([A-Za-z0-9]+)/g;
const GRAPH_DAY_RE = /^graph-log-(\d{4}-\d{2}-\d{2})\.md$/;

function isImage(contentType: string): boolean {
  return contentType.startsWith("image/");
}
function isVideo(contentType: string): boolean {
  return contentType.startsWith("video/");
}

/** Which folders a row shows in. A row can be in two: a photo of a
 * receipt is in Gallery and in Costs. `other` from the model is Unsorted
 * (it could not place it); `other` from a person is a document. */
export function foldersOf(row: Pick<ProjectFileRow, "contentType" | "kind" | "kindSource">): FileFolder[] {
  const out: FileFolder[] = [];
  if (isImage(row.contentType) || isVideo(row.contentType)) out.push("gallery");
  if (isCostKind(row.kind)) out.push("costs");
  if (row.kind === "drawing" || row.kind === "spec" || row.kind === "permit" || row.kind === "contract") out.push("documents");
  if (row.kind === "other") out.push(row.kindSource === "person" ? "documents" : "unsorted");
  if (row.kind === "unfiled" && !out.includes("gallery")) out.push("unsorted");
  if (out.length === 0) out.push("unsorted");
  return out;
}

/** Case-insensitive substring over everything a person might remember a
 * file by: its name, the caption, the words around it in the log, what
 * the model saw in it, the vendor, the lines a cost was read from. */
export function matchesQuery(row: ProjectFileRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    row.name,
    row.caption,
    row.context,
    row.description ?? "",
    row.reason ?? "",
    row.cost?.vendor ?? "",
    ...(row.cost?.readFrom ?? []),
    row.authorName,
    row.kind,
    ...row.threads,
    ...row.efforts,
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(needle);
}

/** The only list of costs this module gives out: confirmed ones. A
 * budget, when there is one, reads this and nothing else (ADR-020). */
export function confirmedCosts(rows: readonly ProjectFileRow[]): ProjectFileRow[] {
  return rows.filter((r) => r.cost !== null && r.cost.status !== "unconfirmed");
}

function graphNodes(graphFiles: FileFoldersInput["graphFiles"]): GraphLogNode[] {
  const nodes: GraphLogNode[] = [];
  for (const f of graphFiles) {
    const m = GRAPH_DAY_RE.exec(f.name);
    if (!m || !f.content) continue;
    nodes.push(...parseGraphLogNodes(m[1], splitFrontmatter(f.content).body));
  }
  return nodes;
}

export function projectFileRows(input: FileFoldersInput): ProjectFileRow[] {
  const dailyByName = new Map(input.dailyFiles.map((f) => [f.name, f]));
  const knowledgeByName = new Map(input.knowledgeFiles.map((f) => [f.name, f.content]));

  // Nodes that cite a copy, by copy id; threads by node id; efforts by thread.
  const nodesByCopy = new Map<string, GraphLogNode[]>();
  for (const node of graphNodes(input.graphFiles)) {
    for (const m of node.quote.matchAll(VIEW_ID_RE)) {
      const list = nodesByCopy.get(m[1]) ?? [];
      if (!list.includes(node)) list.push(node);
      nodesByCopy.set(m[1], list);
    }
  }
  const threadsByNode = new Map<string, string[]>();
  const structure = input.graphFiles.find((f) => f.name === "graph-structure.md")?.content;
  if (structure) {
    for (const section of splitReadmeSections(splitFrontmatter(structure).body)) {
      if (!section.heading) continue;
      for (const id of nodeIdsInSection(section)) threadsByNode.set(id, [...(threadsByNode.get(id) ?? []), section.heading]);
    }
  }
  const effortsByThread = new Map<string, string[]>();
  const efforts = readEffortsSidecar(input.graphFiles.find((f) => f.name === EFFORTS_SIDECAR_FILE_NAME)?.content) ?? [];
  for (const effort of efforts) {
    for (const t of effort.threads) {
      const key = t.toLowerCase();
      effortsByThread.set(key, [...(effortsByThread.get(key) ?? []), effort.name]);
    }
  }

  const marksByFile = new Map<string, GraphLogMark[]>();
  for (const m of input.marks) {
    const id = m.unit.attachmentId;
    if (!id) continue;
    marksByFile.set(id, [...(marksByFile.get(id) ?? []), m]);
  }

  return input.attachments.map((a) => {
    const copyName = syncedAttachmentFileName(a.date, a.authorHumanId, a.name);
    const copy = dailyByName.get(copyName) ?? null;
    const cardCopy = dailyByName.get(syncedCardFileName(a.date, a.authorHumanId)) ?? null;
    const original = input.originals.get(a.fileId);
    const contentType = copy?.content_type ?? original?.content_type ?? "application/octet-stream";
    const size = copy?.size ?? original?.size ?? null;
    const serveId = copy?._id ?? a.fileId;

    const knowledge = knowledgeByName.get(knowledgeFileName(copyName)) ?? null;
    const description = knowledge ? splitFrontmatter(knowledge).body.trim() || null : null;
    const filing = readFilingRecord(knowledgeByName.get(filingFileName(copyName)))?.filing ?? null;

    const acts: FileActRecord[] = (marksByFile.get(a.fileId) ?? [])
      .map((m) => ({
        id: m._id,
        authorHumanId: m.author_human_id,
        authorName: input.names.get(m.author_human_id) ?? m.author_human_id,
        date: m.date,
        createdAt: m.created_at,
        text: m.text,
        act: m.act ?? null,
      }))
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt));

    const filedAs = acts.find((r) => r.act?.kind === "file-as");
    const kind: ProjectFileRow["kind"] = filedAs?.act?.kind === "file-as" ? filedAs.act.fileKind : (filing?.kind ?? "unfiled");
    const kindSource: ProjectFileRow["kindSource"] = filedAs ? "person" : filing ? "model" : "none";

    let cost: ProjectFileRow["cost"] = null;
    if (isCostKind(kind)) {
      const values = filing?.cost ?? null;
      const currentHash = filing ? filingValuesHash(filing) : null;
      const confirmation = acts.find((r) => r.act?.kind === "confirm-cost");
      const stands = !!confirmation && confirmation.act?.kind === "confirm-cost" && currentHash !== null && confirmation.act.of === currentHash;
      cost = {
        vendor: values?.vendor ?? null,
        amount: values?.amount ?? null,
        currency: values?.currency ?? null,
        date: values?.date ?? null,
        readFrom: values?.readFrom ?? [],
        status: stands && confirmation.act?.kind === "confirm-cost" ? confirmation.act.verdict : "unconfirmed",
        by: stands ? confirmation.authorName : null,
        on: stands ? confirmation.date : null,
      };
    }

    const nodes = (nodesByCopy.get(serveId) ?? []).map((n) => ({ id: n.id, date: n.date, number: n.number }));
    const threads = [...new Set(nodes.flatMap((n) => threadsByNode.get(n.id) ?? []))];
    const effortNames = [...new Set(threads.flatMap((t) => effortsByThread.get(t.toLowerCase()) ?? []))];

    const row: ProjectFileRow = {
      fileId: a.fileId,
      serveId,
      name: a.name,
      contentType,
      size,
      date: a.date,
      authorHumanId: a.authorHumanId,
      authorName: input.names.get(a.authorHumanId) ?? a.authorHumanId,
      caption: a.caption,
      context: a.context,
      cardFileId: a.cardFileId,
      cardCopyFileId: cardCopy?._id ?? null,
      copyFileId: copy?._id ?? null,
      description,
      filing,
      kind,
      kindSource,
      reason: filing?.reason ?? null,
      cost,
      nodes,
      threads,
      efforts: effortNames,
      acts,
      folders: [],
      urls: {
        thumb: `/api/vault/rendition/${serveId}?size=thumb`,
        display: `/api/vault/rendition/${serveId}?size=display`,
        original: `/api/vault/view/${serveId}`,
        poster: isVideo(contentType) ? `/api/vault/rendition/${serveId}?size=poster` : null,
      },
    };
    row.folders = foldersOf(row);
    return row;
  });
}

// ── I/O ──────────────────────────────────────────────────────────────────────

/** Everything the projection needs, in about ten round trips whatever
 * the file count: the Cards, the originals, three folder listings, the
 * `_knowledge/` folder's contents, the whole `Graph/` folder, the file
 * marks, the names. Request time, no stored index: a stored one would
 * need rebuilding on every tap, refile and reseed, all outside runs. */
export async function loadProjectFiles(folder: VaultFolder): Promise<ProjectFileRow[]> {
  const attachments = await listCardAttachments(folder._id);
  const originals = new Map(
    (await getFileRefListingsByIds([...new Set(attachments.map((a) => a.fileId))])).map((f) => [f._id, { content_type: f.content_type, size: f.size }]),
  );

  let dailyFiles: FileFoldersInput["dailyFiles"] = [];
  let knowledgeFiles: FileFoldersInput["knowledgeFiles"] = [];
  const top = await listFolderChildren(folder.human_id, folder._id);
  const syncs = top.folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (syncs) {
    const daily = (await listFolderChildren(folder.human_id, syncs._id)).folders.find((f) => f.name === "Daily Logs");
    if (daily) {
      const children = await listFolderChildren(folder.human_id, daily._id);
      dailyFiles = children.files.map((f) => ({ _id: f._id, name: f.name, content_type: f.content_type, size: f.size }));
      const knowledge = children.folders.find((f) => f.name === KNOWLEDGE_FOLDER_NAME);
      if (knowledge) knowledgeFiles = (await getFileRefsByFolderIds([knowledge._id])).map((f) => ({ name: f.name, content: f.content }));
    }
  }

  const graphFolder = await findProjectGraphFolder(folder);
  const graphFiles = graphFolder ? (await getFileRefsByFolderIds([graphFolder._id])).map((f) => ({ name: f.name, content: f.content })) : [];

  const marks = await listFileMarks(folder._id);
  const names = await authorNames([...attachments.map((a) => a.authorHumanId), ...marks.map((m) => m.author_human_id)]);

  return projectFileRows({ attachments, originals, dailyFiles, knowledgeFiles, graphFiles, marks, names });
}
