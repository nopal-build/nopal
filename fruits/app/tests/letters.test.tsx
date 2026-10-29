/**
 * Letters (`letters.server.ts`, Austin 2026-10-06 and
 * 2026-10-21): a Guide uploads a markdown page for the client, flips its
 * link, and anyone with the link reads the finished page with no login.
 * What leaves the server is a fixed set of fields; the only files served
 * are the ones the page names; the page takes no writes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bodyOpensWithTitle,
  canManageLetters,
  letterFileIds,
  letterPage,
  letterEditedSinceSent,
  letterSendRefusal,
  sentCopyOf,
  letterShareRefusal,
  letterTitle,
  isLettersFolder,
  publicLetterBody,
  sentLetterLinks,
} from "robustness-core/data/letters.server";
import { resolveRole } from "robustness-core/data/projectSharing.server";
import { featuresOf } from "robustness-core/data/features";
import { resolveProjectTab, tabsFor } from "robustness-core/data/projectView.server";
import { SPACE_FOLDER_TYPES, canonicalFolderType, isLettersFolderType } from "robustness-core/data/vaultFolderTypes";
import { WebsitePageContent } from "stamps/WebsitePageContent";
import OxRenderer from "../components/OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";
import { LettersView, NewLetterModal, pdfLine } from "../components/LettersView";
import { LetterBrief, isLetterOnlyItsHeading, splitBriefHalves } from "../components/LetterBrief";
import { LettersTile } from "../components/LettersTile";
import { LetterSendControl, SEND_AGAIN_ASK, SEND_ASK } from "../components/LetterSendControl";
import { preparingPage } from "robustness-core/data/letterPdf.server";

const FILE = "d3l1v3r4bl3";
const PAGE = `---
title: Madison attic
description: What to do first
---
# Madison attic

Air seal before insulation.

![the hatch](/api/vault/view/ntfc5km0612jeex7fjiv)

[walkthrough](/api/vault/view/vid42?type=video)

::file{fileId="filedirective1" name="receipt.jpg"}
`;

describe("the public body", () => {
  const body = publicLetterBody(PAGE, FILE);

  it("drops the front matter and keeps the page", () => {
    expect(body).not.toContain("title: Madison attic");
    expect(body.startsWith("# Madison attic")).toBe(true);
    expect(body).toContain("Air seal before insulation.");
  });

  it("points every file at the letter's own route", () => {
    expect(body).not.toContain("/api/vault/view/");
    expect(body).toContain(`/api/letter/${FILE}/view/ntfc5km0612jeex7fjiv`);
    expect(body).toContain(`/api/letter/${FILE}/view/vid42?type=video`);
  });

  it("serves exactly the ids the page names; a ::file directive draws without its picture", () => {
    expect([...letterFileIds(PAGE)].sort()).toEqual(["ntfc5km0612jeex7fjiv", "vid42"]);
    const html = renderToStaticMarkup(
      <WebsitePageContent>
        <OxRenderer markdown={body} directives={buildWebsiteDirectiveRegistry({ dailyLogEntries: {} })} servedFileIds={{}} className="ox-no-dots ox-no-heading-marks website-page-ox" />
      </WebsitePageContent>,
    );
    expect(html).not.toContain("filedirective1");
  });

  it("a body that opens with its own heading carries the title; the page header then shows none", () => {
    expect(bodyOpensWithTitle(publicLetterBody(PAGE, FILE))).toBe(true);
    expect(bodyOpensWithTitle("Air seal first.\n\n# Later heading")).toBe(false);
    expect(bodyOpensWithTitle("#hashtag not a heading")).toBe(false);
  });

  it("the title is the front matter's, else the file name without .md", () => {
    expect(letterTitle({ name: "madison-attic.md", content: PAGE })).toBe("Madison attic");
    expect(letterTitle({ name: "madison-attic.md", content: "# no front matter" })).toBe("madison-attic");
  });
});

const SENT = { _id: FILE, name: "madison-attic.md", content: PAGE, updated_at: "2026-10-21T08:00:00Z", content_hash: "live", shared_at: "2026-10-21T09:00:00Z", sent_content: PAGE, sent_content_hash: "live", sent_at: "2026-10-22T15:00:00Z", sent_date: "2026-10-22", sent_by_human_id: "guide1", sent_count: 1 };

describe("what leaves the server", () => {
  it("is a fixed set of fields, the link keyed by the file's own id, dated by the send", () => {
    const page = letterPage(SENT, "https://o.nopal.build");
    expect(Object.keys(page).sort()).toEqual(["body", "downloadUrl", "fileName", "linkOn", "pdfUrl", "preview", "resent", "showTitle", "title", "updated", "url"]);
    expect(page.preview).toBe(false);
    expect(page.linkOn).toBe(true);
    expect(page.resent).toBe(false);
    expect(page.url).toBe(`https://o.nopal.build/public/letter/${FILE}`);
    expect(page.downloadUrl).toBe(`/api/letter/${FILE}/download`);
    expect(page.pdfUrl).toBe(`/api/letter/${FILE}/pdf`);
    expect(page.updated).toBe("Oct 22, 2026");
    expect(page.title).toBe("Madison attic");
  });
});

describe("the sent copy (2026-10-28)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const draft = { content: "# Draft", content_hash: "d1", shared_at: null };

  it("is nothing for a draft, the record's copy once sent, and the live content for a letter whose link was on before letters had a send", () => {
    expect(sentCopyOf(draft)).toBeNull();
    expect(sentCopyOf(SENT)).toEqual({ content: PAGE, hash: "live", at: "2026-10-22T15:00:00Z", date: "2026-10-22", count: 1, byHumanId: "guide1" });
    // A send from before `sent_date` (never shipped, but cheap): the instant's day.
    expect(sentCopyOf({ ...SENT, sent_date: null })?.date).toBe("2026-10-22");
    const legacy = { content: "# Old link", content_hash: "o1", shared_at: "2026-10-21T09:00:00Z" };
    expect(sentCopyOf(legacy)).toEqual({ content: "# Old link", hash: "o1", at: "2026-10-21T09:00:00Z", date: "2026-10-21", count: 1, byHumanId: null });
  });

  it("does not move when the guide edits the draft, and the letter says so", () => {
    const edited = { ...SENT, content: PAGE + "\n\nOne more line.\n", content_hash: "edited" };
    expect(sentCopyOf(edited)?.content).toBe(PAGE);
    expect(letterEditedSinceSent(SENT)).toBe(false);
    expect(letterEditedSinceSent(edited)).toBe(true);
    expect(letterEditedSinceSent(draft)).toBe(false);
  });

  it("the page is the sent copy, not the draft, and says when it was sent again", () => {
    const edited = { ...SENT, content: "# Not yet\n\nUnsent words.\n", content_hash: "edited", sent_count: 2 };
    const page = letterPage(edited, "https://o.nopal.build");
    expect(page.body).toContain("Air seal before insulation.");
    expect(page.body).not.toContain("Unsent words");
    expect(page.resent).toBe(true);
    // A preview is the draft, for a guide, before the send.
    const preview = letterPage({ ...edited, shared_at: null }, "https://o.nopal.build", true);
    expect(preview.body).toContain("Unsent words");
    expect(preview.linkOn).toBe(false);
  });

  it("the PDF and the source are offered only while the link is on", () => {
    expect(letterPage({ ...SENT, shared_at: null }, "https://o.nopal.build").linkOn).toBe(false);
    const src = readFileSync(path.join(here, "../routes/public.letter.$fileId.tsx"), "utf8");
    expect(src).toContain("{!preview && linkOn && (");
    expect(src).toContain("Sent ${updated}");
  });

  it("sending is refused outside Letters, for a non-markdown file and for anyone who doesn't manage; the link is refused on an unsent letter", () => {
    expect(letterSendRefusal({ manages: true, inLetters: true, isMarkdown: true })).toBeNull();
    expect(letterSendRefusal({ manages: true, inLetters: false, isMarkdown: true })?.status).toBe(400);
    expect(letterSendRefusal({ manages: true, inLetters: true, isMarkdown: false })?.status).toBe(400);
    expect(letterSendRefusal({ manages: false, inLetters: true, isMarkdown: true })?.status).toBe(403);
    expect(letterShareRefusal({ manages: true, inLetters: true, isMarkdown: true, sent: false, on: true })).toEqual({ status: 400, error: "Send the letter first. The link is a second step." });
    expect(letterShareRefusal({ manages: true, inLetters: true, isMarkdown: true, sent: false, on: false })).toBeNull();
    expect(letterShareRefusal({ manages: true, inLetters: true, isMarkdown: true, sent: true, on: true })).toBeNull();
  });

  it("the send route is the one writer of the sent fields, with the guides' gate; the save and replace routes no longer ask for a PDF", () => {
    const send = readFileSync(path.join(here, "../routes/api.letter.$fileId.send.tsx"), "utf8");
    expect(send).toContain("letterForManager(");
    expect(send).toContain("sendLetter(");
    for (const file of ["api.vault.$fileId.tsx", "api.vault.replace.$fileId.tsx"]) {
      expect(readFileSync(path.join(here, "../routes", file), "utf8"), file).not.toContain("enqueueLetterPdfIfShared");
    }
  });
});

describe("a Guide's preview before the link is on", () => {
  it("is the same page with the session's own file URLs, marked as a preview", () => {
    const page = letterPage({ _id: FILE, name: "madison-attic.md", content: PAGE, updated_at: "2026-10-21T08:00:00Z" }, "https://o.nopal.build", true);
    expect(page.preview).toBe(true);
    expect(page.body).toContain("/api/vault/view/ntfc5km0612jeex7fjiv");
    expect(page.body).not.toContain("/api/letter/");
    expect(page.body).not.toContain("title: Madison attic");
  });

});

describe("who manages: upload, replace, the switch", () => {
  const human = { role: null };
  it("a Guide on the project, or staff; never a Client, Crafter or Observer", () => {
    expect(canManageLetters(human, resolveRole("Guide"))).toBe(true);
    expect(canManageLetters(human, resolveRole("Owner"))).toBe(true);
    expect(canManageLetters({ role: "Admin" }, null)).toBe(true);
    expect(canManageLetters({ role: "Super" }, null)).toBe(true);
    for (const group of ["Client", "Crafter", "Observer"]) expect(canManageLetters(human, resolveRole(group))).toBe(false);
    expect(canManageLetters(human, null)).toBe(false);
  });

  it("the switch refuses a file outside the Letters folder, a non-markdown file, and a non-manager, in that order", () => {
    expect(letterShareRefusal({ manages: true, inLetters: false, isMarkdown: true })).toMatchObject({ status: 400 });
    expect(letterShareRefusal({ manages: true, inLetters: true, isMarkdown: false })).toMatchObject({ status: 400 });
    expect(letterShareRefusal({ manages: false, inLetters: true, isMarkdown: true })).toMatchObject({ status: 403 });
    expect(letterShareRefusal({ manages: true, inLetters: true, isMarkdown: true })).toBeNull();
  });

  it("a Letters folder is the type's root, not a folder that merely inherits the type", () => {
    expect(isLettersFolder({ folder_type: "letters", is_folder_type_root: true })).toBe(true);
    expect(isLettersFolder({ folder_type: "letters", is_folder_type_root: false })).toBe(false);
    expect(isLettersFolder({ folder_type: "skills", is_folder_type_root: true })).toBe(false);
    expect(isLettersFolder(null)).toBe(false);
  });

  it("a folder stored as `deliverables` before the rename (2026-10-27) is the same Letters folder, and is never offered as a type", () => {
    expect(isLettersFolder({ folder_type: "deliverables", is_folder_type_root: true })).toBe(true);
    expect(isLettersFolderType("deliverables")).toBe(true);
    expect(isLettersFolderType("letters")).toBe(true);
    expect(isLettersFolderType("skills")).toBe(false);
    expect(canonicalFolderType("deliverables")).toBe("letters");
    expect(canonicalFolderType("skills")).toBe("skills");
    expect(SPACE_FOLDER_TYPES.deliverables.legacyOf).toBe("letters");
    expect(SPACE_FOLDER_TYPES.deliverables.writable).toBe(SPACE_FOLDER_TYPES.letters.writable);
  });
});

describe("the old name keeps answering", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));

  it("the old public route sends a link already in a client's hands to the letter's page, for good", () => {
    const src = readFileSync(path.join(here, "../routes/public.deliverable.$fileId.tsx"), "utf8");
    expect(src).toMatch(/redirect\(`\/public\/letter\/\$\{params\.fileId\}`, 301\)/);
    expect(src).not.toMatch(/export\s+(async\s+)?(function|const)\s+action\b/);
    expect(src).not.toMatch(/export default/);
    expect(src).not.toMatch(/\.server"/);
  });

  it("an old ?tab=deliverables bookmark opens the Letters tab", () => {
    expect(resolveProjectTab("deliverables", ["efforts", "letters"])).toBe("letters");
    expect(resolveProjectTab("deliverables", ["efforts"])).toBeNull();
  });

  it("a Client still gets no bytes for a letter through the Vault's file routes; the cache denies it, not the features list (card 719)", () => {
    // A Client is never in `shared_with` (ADR-023), and `canReadFile`
    // opens only a photo for `photos` or a Card's attachment beyond the
    // cache. It has no branch for the letters folder, so no feature row
    // can open a draft to a Client; the brief (guides only) will need
    // the same to hold against Crafter and Observer, who are in the cache.
    const src = readFileSync(path.join(here, "../../../packages/robustness-core/src/data/featureAccess.server.ts"), "utf8");
    expect(src).toMatch(/export async function canReadFile\(/);
    expect(src).not.toMatch(/letters|isLettersFolder/);
    expect(featuresOf("Client")).not.toContain("letters");
  });
});

describe("the tab", () => {
  it("every group but a Client reads it, second after Efforts; a Client has no tab (2026-10-22)", () => {
    expect(tabsFor(featuresOf("Client"))).not.toContain("letters");
    expect(tabsFor(featuresOf("Guide")).slice(0, 2)).toEqual(["efforts", "letters"]);
    expect(tabsFor(featuresOf("Observer"))).toContain("letters");
  });

  it("the banner's tile lists what is sent, not merely shared, each with its date, and is absent with nothing sent", () => {
    const links = sentLetterLinks(rows);
    expect(links).toEqual([{ fileId: FILE, title: "Madison attic", path: `/public/letter/${FILE}`, sentDate: "2026-10-22", updated: true }]);
    const html = renderToStaticMarkup(<LettersTile links={links} />);
    expect(html).toContain("data-letters-tile");
    expect(html).toContain(`href="/public/letter/${FILE}"`);
    expect(html).toContain("sent Oct 22, 2026");
    expect(html).toContain(", updated");
    expect(html).not.toContain("draft1");
    expect(renderToStaticMarkup(<LettersTile links={sentLetterLinks([rows[1], rows[2]])} />)).toBe("");
  });

  const rows = [
    { fileId: FILE, name: "madison-attic.md", title: "Madison attic", updatedAt: "2026-10-21T08:00:00Z", size: 10, sharedAt: "2026-10-21T09:00:00Z", contentHash: "h1", purpose: "Tell Susan what the attic floor should be.", sentDate: "2026-10-22", sentCount: 2, sentHash: "h0", editedSinceSent: true, pdf: { state: "failed" as const, reason: "the public page answered 500", at: "2026-10-21T09:01:00Z" } },
    { fileId: "draft1", name: "draft.md", title: "Draft", updatedAt: "2026-10-20T08:00:00Z", size: 10, sharedAt: null, contentHash: "h2", purpose: null, sentDate: null, sentCount: 0, sentHash: null, editedSinceSent: false, pdf: null },
    // Shared with the link on but never sent can't happen from here on
    // (`letterShareRefusal`); a row like it reads as unsent.
    { fileId: "odd1", name: "odd.md", title: "Odd", updatedAt: "2026-10-20T08:00:00Z", size: 10, sharedAt: "2026-10-20T09:00:00Z", contentHash: "h3", purpose: null, sentDate: null, sentCount: 0, sentHash: null, editedSinceSent: false, pdf: null },
  ];

  it("a reader sees the list and no controls; a sent page is the client's link, an unsent one is not a link", () => {
    const html = renderToStaticMarkup(<LettersView projectFolderId="proj1" rows={rows} manage={false} openInVault={false} onChanged={() => {}} />);
    expect(html).toContain(`href="/public/letter/${FILE}"`);
    expect(html).not.toContain('href="/public/letter/draft1"');
    expect(html).not.toContain("/vault?file=");
    expect(html).not.toMatch(/Upload a letter|Share link|Stop sharing|Replace|Send it first/);
    expect(html).toContain("Sent Oct 22, 2026, updated");
    expect(html).toContain("Link on");
    expect(html).not.toContain("edited since");
    expect(html).not.toContain("PDF");
  });

  it("a manager reads what became of a shared file's PDF, in the worker's own words", () => {
    const html = renderToStaticMarkup(<LettersView projectFolderId="proj1" rows={rows} manage={true} openInVault={true} onChanged={() => {}} />);
    expect(html).toContain("PDF couldn&#x27;t be made: the public page answered 500");
    expect(html).toContain('data-pdf-state="failed"');
    expect(pdfLine({ state: "ready" })).toBe("PDF ready");
    expect(pdfLine({ state: "preparing" })).toBe("PDF preparing");
    expect(pdfLine({ state: "none" })).toMatch(/not made yet/);
  });

  it("a manager gets New letter and Upload, and per page the switch, Replace and Edit", () => {
    const html = renderToStaticMarkup(<LettersView projectFolderId="proj1" rows={rows} manage={true} openInVault={true} onChanged={() => {}} />);
    expect(html).toContain("New letter");
    expect(html).toContain("Upload a letter");
    expect(html).toContain('accept=".md,text/markdown,image/*"');
    expect(html).toContain("multiple");
    // The link switch only on a sent letter; the others say to send first.
    expect(html).toContain("Stop sharing");
    expect(html).not.toContain("Share link");
    expect((html.match(/Send it first\. The link is a second step\./g) ?? []).length).toBe(2);
    expect(html).toContain("edited since");
    expect((html.match(/>Replace</g) ?? []).length).toBe(3);
    expect((html.match(/>Edit</g) ?? []).length).toBe(3);
  });

  it("the title opens what the client sees: the public page, always for a manager, once shared for a reader", () => {
    const html = renderToStaticMarkup(<LettersView projectFolderId="proj1" rows={rows} manage={true} openInVault={true} onChanged={() => {}} />);
    // The title is the base-size link; "Edit" is the xs one. A manager's
    // title always opens the client's page, shared or not.
    expect(html).toContain(`<a href="/public/letter/${FILE}" class="typography_textSize_base`);
    expect(html).toContain(`<a href="/public/letter/draft1" class="typography_textSize_base`);
    expect(html).not.toContain(`<a href="/vault?file=${FILE}" class="typography_textSize_base`);
    const reader = renderToStaticMarkup(<LettersView projectFolderId="proj1" rows={rows} manage={false} openInVault={true} onChanged={() => {}} />);
    expect(reader).toContain(`<a href="/public/letter/${FILE}"`);
    expect(reader).not.toContain("/vault?file=draft1");
    expect(reader).not.toContain(">Edit<");
    expect(reader).not.toContain("New letter");
  });
});

describe("the purpose line (2026-10-28)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));

  it("shows under the row that has one, to anyone with the tab, and nothing under one that doesn't", () => {
    const html = renderToStaticMarkup(<LettersView projectFolderId="proj1" rows={rows} manage={false} openInVault={false} onChanged={() => {}} />);
    expect((html.match(/data-letter-purpose/g) ?? []).length).toBe(1);
    expect(html).toContain("Tell Susan what the attic floor should be.");
  });

  it("New letter asks for a title and what the letter is for, both required, and never through window.prompt", () => {
    const html = renderToStaticMarkup(<NewLetterModal open busy={false} error={null} onClose={() => {}} onStart={() => {}} />);
    expect(html).toContain('name="name"');
    expect(html).toContain("What is this letter for?");
    expect(html).toMatch(/<textarea[^>]*name="purpose"[^>]*required/);
    expect(html).toContain("Start the letter");
    expect(html).toContain("in your words");
    expect(readFileSync(path.join(here, "../components/LettersView.tsx"), "utf8")).not.toContain("window.prompt");
  });

  it("the route refuses a new letter with no purpose, keeps the line on the record, and marks it in the guide's name on their day", () => {
    const src = readFileSync(path.join(here, "../routes/api.projects.$folderId.letters.tsx"), "utf8");
    expect(src).toContain('"Say what this letter is for first."');
    expect(src).toContain("updateFileRef(fileRef._id, { purpose })");
    expect(src).toMatch(/createMark\(\{[\s\S]*authorHumanId: user\._id,[\s\S]*unit: letterPurposeMark\(fileRef\),[\s\S]*suggestion: false,/);
    expect(src).toMatch(/const date = markDate\(/);
    expect((src.match(/createMark\(/g) ?? []).length).toBe(1);
  });

  it("never leaves the server for the public page: the page's fields are the same as before", () => {
    const page = letterPage({ _id: FILE, name: "madison-attic.md", content: PAGE, updated_at: "2026-10-21T08:00:00Z", purpose: "secret-ish" } as never, "https://o.nopal.build");
    expect(Object.keys(page)).not.toContain("purpose");
    expect(JSON.stringify(page)).not.toContain("secret-ish");
  });

  const rows = [
    { fileId: FILE, name: "madison-attic.md", title: "Madison attic", updatedAt: "2026-10-21T08:00:00Z", size: 10, sharedAt: "2026-10-21T09:00:00Z", contentHash: "h1", purpose: "Tell Susan what the attic floor should be.", sentDate: null, sentCount: 0, sentHash: null, editedSinceSent: false, pdf: null },
    { fileId: "draft1", name: "draft.md", title: "Draft", updatedAt: "2026-10-20T08:00:00Z", size: 10, sharedAt: null, contentHash: "h2", purpose: null, sentDate: null, sentCount: 0, sentHash: null, editedSinceSent: false, pdf: null },
  ];
});

describe("the brief on the letter's page (2026-10-28)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));

  it("the New letter form says that starting the letter runs the model", () => {
    const html = renderToStaticMarkup(<NewLetterModal open busy={false} error={null} onClose={() => {}} onStart={() => {}} />);
    expect(html).toContain("Starting the letter writes its brief");
    expect(html).toContain("costs a run");
  });

  it("no brief yet: the first line and the button; a brief: rendered, with its citation marker and Write it again; failed: the reason", () => {
    const none = renderToStaticMarkup(<LetterBrief fileId="l1" initial={{ brief: null, job: null, talk: { draft: null, sent: null }, outline: null, outlineJob: null }} hasPurpose openByDefault />);
    expect(none).toContain("This letter has no brief yet.");
    expect(none).toContain("Write the brief");
    expect(none).toContain('data-brief-state="none"');

    const ready = renderToStaticMarkup(
      <LetterBrief
        fileId="l1"
        initial={{ brief: { content: '## The ask\n\n- The problem. :ref{name="Susan" datetime="2026-08-05T12:00:00Z" location="/vault?file=abc"}\n', writtenAt: "2026-10-28T10:00:00Z", byName: "Austin", incomplete: [] }, job: null, talk: { draft: null, sent: null }, outline: null, outlineJob: null }}
        hasPurpose
        openByDefault
      />,
    );
    expect(ready).toContain("Write it again");
    expect(ready).toContain("Written Oct 28, 2026 by Austin");
    expect(ready).toContain("The problem.");
    expect(ready).toContain("data-brief-body");
    expect(ready).toContain('data-brief-state="ready"');
    expect(ready).not.toContain("data-brief-reference");

    const failed = renderToStaticMarkup(<LetterBrief fileId="l1" initial={{ brief: null, job: { state: "failed", error: "the graph holds no nodes", startedAt: null, waitingOnAnotherRun: false }, talk: { draft: null, sent: null }, outline: null, outlineJob: null }} hasPurpose openByDefault />);
    expect(failed).toMatch(/The brief didn(&#x27;|')t get written: the graph holds no nodes/);

    const running = renderToStaticMarkup(<LetterBrief fileId="l1" initial={{ brief: null, job: { state: "active", error: null, startedAt: null, waitingOnAnotherRun: false }, talk: { draft: null, sent: null }, outline: null, outlineJob: null }} hasPurpose openByDefault />);
    expect(running).toContain("Writing the brief…");
    expect(running).not.toContain("Write the brief");
  });

  it("Reference is folded under its own twirl, closed, and the first half reads as the brief", () => {
    const content = `## The ask\n\n- The problem.\n\n---\n\n# Reference\n\n## The client's questions\n\n- A question nobody has to read.\n`;
    expect(splitBriefHalves(content)).toEqual({ first: "## The ask\n\n- The problem.", reference: "## The client's questions\n\n- A question nobody has to read." });
    expect(splitBriefHalves("## The ask\n\n- p\n")).toEqual({ first: "## The ask\n\n- p\n", reference: null });
    const html = renderToStaticMarkup(<LetterBrief fileId="l1" initial={{ brief: { content, writtenAt: "2026-10-28T10:00:00Z", byName: "Austin", incomplete: [] }, job: null, talk: { draft: null, sent: null }, outline: null, outlineJob: null }} hasPurpose openByDefault />);
    expect(html).toContain("The problem.");
    expect(html).toContain('data-brief-reference');
    expect(html).toContain("Nobody has to read it.");
    expect(html).not.toContain("A question nobody has to read.");
  });

  it("the brief and the talk-through sit side by side while both are up (Stamps' Grid, no stylesheet), the brief folds from its end, and the layout stacks once the talk is sent (2026-10-28)", () => {
    const brief = { content: "## The ask\n\n- The problem.\n", writtenAt: "2026-10-28T10:00:00Z", byName: "Austin", incomplete: [] };
    const open = renderToStaticMarkup(<LetterBrief fileId="l1" initial={{ brief, job: null, talk: { draft: null, sent: null }, outline: null, outlineJob: null }} hasPurpose openByDefault />);
    expect(open).toContain('data-chain-layout="side-by-side"');
    expect(open).toMatch(/grid-template-columns:repeat\(auto-fit, minmax\(320px, 1fr\)\)/);
    expect(open).toMatch(/data-letter-talk="true" style="position:sticky;top:12px"/);
    expect(open).toContain("data-brief-fold");
    expect(open).toContain("Fold the brief");
    const folded = renderToStaticMarkup(<LetterBrief fileId="l1" initial={{ brief, job: null, talk: { draft: null, sent: null }, outline: null, outlineJob: null }} hasPurpose openByDefault={false} />);
    expect(folded).toContain('data-chain-layout="stacked"');
    expect(folded).not.toContain("data-brief-fold");
    expect(folded).not.toContain("position:sticky");
    const talked = renderToStaticMarkup(<LetterBrief fileId="l1" initial={{ brief, job: null, talk: { draft: null, sent: { text: "Makes sense.", at: "2026-10-28T11:00:00Z", date: "2026-10-28", byName: "Austin" } }, outline: null, outlineJob: null }} hasPurpose openByDefault />);
    expect(talked).toContain('data-chain-layout="stacked"');
    // Stamps and OxMarkdown draw the chain; no stylesheet of its own.
    const src = readFileSync(path.join(here, "../components/LetterBrief.tsx"), "utf8");
    expect(src).not.toMatch(/import "\.\.\/styles\//);
    expect(readFileSync(path.join(here, "../styles/letter.css"), "utf8")).not.toContain("letter-chain");
  });

  it("the send control reads the record's three states and asks before each send", () => {
    const never = renderToStaticMarkup(<LetterSendControl fileId="l1" state={{ sentDate: null, sentCount: 0, editedSinceSent: false }} onSent={() => {}} />);
    expect(never).toContain('data-sent="never"');
    expect(never).toContain(">Send<");
    const sent = renderToStaticMarkup(<LetterSendControl fileId="l1" state={{ sentDate: "2026-10-28", sentCount: 1, editedSinceSent: false }} onSent={() => {}} />);
    expect(sent).toContain('data-sent="sent"');
    expect(sent).toContain("Sent Oct 28, 2026");
    expect(sent).not.toContain("data-send-button");
    const edited = renderToStaticMarkup(<LetterSendControl fileId="l1" state={{ sentDate: "2026-10-28", sentCount: 2, editedSinceSent: true }} onSent={() => {}} />);
    expect(edited).toContain('data-sent="edited"');
    expect(edited).toContain("Edited since you sent it");
    expect(edited).toContain(">Send again<");
    expect(SEND_ASK).toMatch(/Nothing you change after reaches them until you send again/);
    expect(SEND_AGAIN_ASK).toMatch(/marked as updated/);
    expect(SEND_ASK + SEND_AGAIN_ASK).not.toMatch(/—/);
  });

  it("the New letter form asks for a sentence or three", () => {
    const html = renderToStaticMarkup(<NewLetterModal open busy={false} error={null} onClose={() => {}} onStart={() => {}} />);
    expect(html).toContain("A sentence or three, in your words");
  });

  it("without a purpose line the button is disabled and says why", () => {
    const html = renderToStaticMarkup(<LetterBrief fileId="l1" initial={{ brief: null, job: null, talk: { draft: null, sent: null }, outline: null, outlineJob: null }} hasPurpose={false} openByDefault />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-brief-button|<button[^>]*data-brief-button[^>]*disabled=""/);
    expect(html).toContain("Say what it is for first");
  });

  it("the page hands the brief to a guide only, and the public page and the tab carry none of it", () => {
    const vault = readFileSync(path.join(here, "../routes/vault.tsx"), "utf8");
    expect(vault).toMatch(/if \(canManageLetters\(user, roleForLetter\)\) \{\s*letterBrief = /);
    expect(vault).toContain("{letterBrief && (");
    expect(readFileSync(path.join(here, "../routes/public.letter.$fileId.tsx"), "utf8")).not.toMatch(/brief/i);
    expect(readFileSync(path.join(here, "../../../packages/robustness-core/src/data/letters.server.ts"), "utf8")).not.toMatch(/letter_briefs|brief\.server/);
  });

  it("with a brief and no talk, the talk-through space and Write the outline; after the send, the talk as text and the outline's twirl", () => {
    const brief = { content: "## The ask\n\n- p\n", writtenAt: "2026-10-28T10:00:00Z", byName: "Austin", incomplete: [] };
    const before = renderToStaticMarkup(<LetterBrief fileId="l1" initial={{ brief, job: null, talk: { draft: "so far", sent: null }, outline: null, outlineJob: null }} hasPurpose openByDefault />);
    expect(before).toContain("data-letter-talk");
    expect(before).toContain("Talk it through");
    expect(before).toContain("so far");
    expect(before).toContain("when you write the outline");
    expect(before).toContain("Write the outline");
    expect(before).not.toContain("data-letter-outline");

    const sent = { text: "I'm trying to give just a limited deliverable.", at: "2026-10-28T11:00:00Z", date: "2026-10-28", byName: "Austin" };
    const writing = renderToStaticMarkup(<LetterBrief fileId="l1" initial={{ brief, job: null, talk: { draft: null, sent }, outline: null, outlineJob: { state: "active", error: null, startedAt: null, waitingOnAnotherRun: false } }} hasPurpose openByDefault />);
    expect(writing).toContain("data-letter-talk-sent");
    expect(writing).toContain("limited deliverable.");
    expect(writing).not.toContain("<textarea");
    expect(writing).toContain("Writing the outline…");
    expect(writing).toContain('data-outline-state="running"');

    const outline = { content: "## The assembly today\n\n- Position: slow, not stop.\n\n## Go do\n\n- Check the windows.\n", writtenAt: "2026-10-28T11:05:00Z", byName: "Austin", incomplete: [], editedAt: null };
    const done = renderToStaticMarkup(<LetterBrief fileId="l1" initial={{ brief, job: null, talk: { draft: null, sent }, outline, outlineJob: null }} hasPurpose openByDefault />);
    expect(done).toContain("The outline ▾");
    expect(done).toContain("slow, not stop.");
    expect(done).toContain("Check the windows.");
    expect(done).toContain("data-outline-edit");
    expect(done).toContain("Write it again");
    // The brief folds away once the outline exists; its words stay a click away.
    expect(done).toContain("The brief ▸");
    expect(done).not.toContain("data-brief-body");

    const failed = renderToStaticMarkup(<LetterBrief fileId="l1" initial={{ brief, job: null, talk: { draft: null, sent }, outline: null, outlineJob: { state: "failed", error: "the graph holds no nodes", startedAt: null, waitingOnAnotherRun: false } }} hasPurpose openByDefault />);
    expect(failed).toMatch(/The outline didn(&#x27;|')t get written: the graph holds no nodes/);
  });

  it("a letter that is only its heading opens the brief by itself", () => {
    expect(isLetterOnlyItsHeading("---\ntitle: Attic\n---\n\n# Attic\n\n")).toBe(true);
    expect(isLetterOnlyItsHeading("# Attic\n\nDear Susan,")).toBe(false);
  });
});

describe("read only", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const routes = [
    "public.letter.$fileId.tsx",
    "api.letter.$fileId.view.$id.tsx",
    "api.letter.$fileId.rendition.$id.tsx",
    "api.letter.$fileId.download.tsx",
    "api.letter.$fileId.pdf.tsx",
  ];

  it("the public routes take no writes", () => {
    for (const file of routes) {
      const src = readFileSync(path.join(here, "../routes", file), "utf8");
      expect(src, file).not.toMatch(/export\s+(async\s+)?(function|const)\s+action\b/);
    }
  });

  it("the PDF route serves nothing unless the link is on, and its waiting page has no script", () => {
    const src = readFileSync(path.join(here, "../routes/api.letter.$fileId.pdf.tsx"), "utf8");
    expect(src).toContain("resolveSharedLetter(");
    const html = preparingPage();
    expect(html).toMatch(/<meta http-equiv="refresh" content="\d+">/);
    expect(html).not.toMatch(/<script|<form|<button|<a /);
  });

  it("the PDF is the page printed: both download links sit in the wrapper the print rules hide", () => {
    const src = readFileSync(path.join(here, "../routes/public.letter.$fileId.tsx"), "utf8");
    expect(src).toContain('className="letter-actions"');
    expect(src).toContain("letter.css");
    const css = readFileSync(path.join(here, "../styles/letter.css"), "utf8");
    expect(css).toMatch(/@media print \{[^}]*\.letter-actions \{\s*display: none;/);
  });

  it("with the link off, the public route admits someone on the project once sent, else a manager as a preview", () => {
    const src = readFileSync(path.join(here, "../routes/public.letter.$fileId.tsx"), "utf8");
    const shared = src.indexOf("resolveSharedLetter(");
    const member = src.indexOf("resolveSentLetterForMember(");
    const manager = src.indexOf("resolveLetterForManager(");
    expect(shared).toBeGreaterThan(-1);
    expect(shared).toBeLessThan(member);
    expect(member).toBeLessThan(manager);
    expect(src).toContain("letterPage(sent.file, origin)");
    expect(src).toContain("letterPage(mine.file, origin, true)");
    // The letter's file routes open the same two doors.
    for (const file of ["api.letter.$fileId.view.$id.tsx", "api.letter.$fileId.rendition.$id.tsx"]) {
      expect(readFileSync(path.join(here, "../routes", file), "utf8"), file).toContain("letterPageFile(fileId, id, viewer?._id ?? null)");
    }
    const download = readFileSync(path.join(here, "../routes/api.letter.$fileId.download.tsx"), "utf8");
    expect(download).toContain("resolveSentLetterForMember(");
    expect(download).toContain("new Response(sent.content,");
  });

  it("a saved edit refreshes the content hash, so the letter knows it was edited since the send", () => {
    const src = readFileSync(path.join(here, "../routes/api.vault.$fileId.tsx"), "utf8");
    expect(src).toMatch(/updates\.content_hash = crypto\.createHash\("sha256"\)/);
  });

  it("a letter opens in the Vault's split editor, never the read-only render, under either stored folder type", () => {
    const src = readFileSync(path.join(here, "../routes/vault.tsx"), "utf8");
    const branch = src.indexOf("isLettersFolderType(fileFolderType) && isMarkdownFile(current.file) ? (");
    const syncApi = src.indexOf('fileFolderType === "sync-api" && isMarkdownFile(current.file) ? (');
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(syncApi);
    expect(src).toContain("<LetterSplitEditor");
    expect(src).toMatch(/usesMergedHeader =[\s\S]*isLettersFolderType\(fileFolderType\)/);
    expect(src).not.toMatch(/fileFolderType === "(letters|deliverables)"/);
  });

  it("the page renders with no pen, no form and nothing editable, and hands the renderer no served ids", () => {
    const src = readFileSync(path.join(here, "../routes/public.letter.$fileId.tsx"), "utf8");
    expect(src).not.toMatch(/annotations=|interactive=/);
    expect(src).toContain("servedFileIds={{}}");
    const html = renderToStaticMarkup(
      <WebsitePageContent>
        <OxRenderer markdown={publicLetterBody(PAGE, FILE)} directives={buildWebsiteDirectiveRegistry({ dailyLogEntries: {} })} servedFileIds={{}} className="ox-no-dots ox-no-heading-marks website-page-ox" />
      </WebsitePageContent>,
    );
    expect(html).not.toMatch(/<form|<button|<input|<textarea|contenteditable="true"|data-mark-unit/);
  });
});
