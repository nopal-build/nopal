/**
 * The mailbox and the desk on the page (2026-11-05). `letterHouses.test.ts`
 * holds who is shown what; this holds what is drawn: a mailbox that is
 * always there and never carries a number, a list that marks only the
 * reader's own unopened mail, the choice of house at Send with no default,
 * the desk's two groups, and one letter alone on its page. What only a
 * person can read (whether it looks like a mailbox, the words) is the
 * walk's.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { canManageLetters, letterShareRefusal } from "robustness-core/data/letters.server";
import { resolveRole } from "robustness-core/data/projectSharing.server";
import { Mailbox } from "../components/stamps-candidates/Mailbox";
import { MailList, MAILBOX_EMPTY, MAILBOX_LABEL, MAILBOX_SAYS_NEW, MAILBOX_SAYS_QUIET } from "../components/ProjectMailbox";
import { LetterSendControl, sendAsk } from "../components/LetterSendControl";
import { DESK_DRAFTS, DESK_LETTERS, LETTER_DELETE_DRAFT_ASK, LETTER_FOR_ASK, LETTER_FOR_LABEL, LETTER_START, LettersView, NewLetterModal, deskGroups, letterStartFromLine, type LetterTabRow } from "../components/LettersView";
import { LetterReflection, ReflectionTwirl, REFLECT_HINT, REFLECT_KEEP, REFLECT_KEEP_ASK, REFLECT_KEPT_NOTE, REFLECT_KEPT_SUGGESTION, REFLECT_LABEL, REFLECT_PROMPTS, REFLECT_WRITE_BACK } from "../components/LetterReflection";
import { HOUSE_NOT_CHOSEN } from "robustness-core/data/letterHouses";
import { existsSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const route = (name: string) => readFileSync(path.join(here, "../routes", name), "utf8");
const core = (name: string) => readFileSync(path.join(here, "../../../packages/robustness-core/src/data", name), "utf8");

const mail = [
  { fileId: "l2", title: "The attic floor", path: "/public/letter/l2", sentDate: "2026-11-04", updated: false, from: "Lucas", unopened: true },
  { fileId: "l1", title: "Porch screens", path: "/public/letter/l1", sentDate: "2026-10-28", updated: true, from: "Gerald", unopened: false },
  { fileId: "old", title: "Before houses", path: "/public/letter/old", sentDate: "2026-10-12", updated: false, from: null, unopened: false },
];

describe("the mailbox", () => {
  const draw = (flagUp: boolean) => renderToStaticMarkup(<Mailbox flagUp={flagUp} onOpen={() => {}} label={MAILBOX_LABEL} description={flagUp ? MAILBOX_SAYS_NEW : MAILBOX_SAYS_QUIET} />);

  it("is drawn with nothing in it, flag down, and with mail, flag up: the same box either way", () => {
    const quiet = draw(false);
    const withMail = draw(true);
    expect(quiet).toContain('data-flag="down"');
    expect(quiet).toContain('data-mailbox-flag="down"');
    expect(withMail).toContain('data-flag="up"');
    expect(withMail).toContain('data-mailbox-flag="up"');
    for (const html of [quiet, withMail]) {
      expect(html).toContain("<svg");
      expect(html).toContain(`>${MAILBOX_LABEL}<`);
      expect(html).toContain('stroke-linecap="round"');
    }
    // What a screen reader hears says which, in words.
    expect(quiet).toContain(`aria-label="${MAILBOX_SAYS_QUIET}"`);
    expect(withMail).toContain(`aria-label="${MAILBOX_SAYS_NEW.replace("'", "&#x27;")}"`);
  });

  it("carries no number: nothing to put a count in, and no digit in its words", () => {
    const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "");
    expect(text(draw(true))).toBe(MAILBOX_LABEL);
    expect(text(draw(false))).toBe(MAILBOX_LABEL);
    expect(MAILBOX_SAYS_NEW + MAILBOX_SAYS_QUIET + MAILBOX_LABEL).not.toMatch(/\d/);
    const src = readFileSync(path.join(here, "../components/stamps-candidates/Mailbox.tsx"), "utf8");
    expect(src).not.toMatch(/count|badge|length/i);
    expect(readFileSync(path.join(here, "../components/ProjectMailbox.tsx"), "utf8")).not.toMatch(/mail\.length\s*[^=!\s]|\{mail\.length\}|Badge/);
  });

  it("is always on the project's page: mounted with no condition around it, in place of the tile", () => {
    const page = route("newspaper.$folderId.tsx");
    expect(page).toContain("<ProjectMailbox mail={mail} />");
    expect(page).not.toMatch(/&&\s*<ProjectMailbox/);
    expect(page).not.toContain("LettersTile");
    expect(page).not.toMatch(/\(steep \|\| seeding\?\.mine[^)]*\) && \(\s*<Cluster/);
  });

  it("opened and empty, says so in a line", () => {
    const html = renderToStaticMarkup(<MailList mail={[]} />);
    expect(html).toContain("data-mailbox-empty");
    expect(html).toContain(MAILBOX_EMPTY);
  });

  it("lists each letter with who wrote it and its day, marks only the unopened ones, and says nothing of how many", () => {
    const html = renderToStaticMarkup(<MailList mail={mail} />);
    expect((html.match(/data-unopened/g) ?? []).length).toBe(1);
    expect(html).toMatch(/data-mail="l2" data-unopened/);
    expect(html).toContain("from Lucas");
    expect(html).toContain("from Gerald");
    expect(html).toContain("Nov 4, 2026");
    expect(html).toContain("Oct 28, 2026, updated");
    // A letter from before houses names nobody.
    expect(html).not.toMatch(/Before houses<\/a><span[^>]*> · from/);
    // Each opens that letter alone, in its own tab.
    expect((html.match(/target="_blank"/g) ?? []).length).toBe(3);
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/\b3\b|\b1 new\b|unread/i);
  });

  it("shows nobody who has or hasn't opened a letter: the page is given the viewer's own flags and no other", () => {
    const page = route("newspaper.$folderId.tsx");
    expect((page.match(/flaggedLetterIds\(/g) ?? []).length).toBe(1);
    expect(page).toContain("flaggedLetterIds(folder._id, user._id)");
    const flagsModule = core("letterFlags.server.ts");
    // Nothing reads flags by letter, and nothing but opening a letter lowers one.
    expect(flagsModule).not.toMatch(/WHERE letter_file_id/);
    for (const name of ["letters.server.ts", "letterSend.server.ts", "letterHouses.server.ts"]) expect(core(name), name).not.toContain("lowerLetterFlag(");
    expect((core("letterReading.server.ts").match(/lowerLetterFlag\(/g) ?? []).length).toBe(1);
  });
});

describe("who a letter is for, picked when it is started", () => {
  const modal = (asksHouse: boolean) => renderToStaticMarkup(<NewLetterModal open busy={false} error={null} asksHouse={asksHouse} onClose={() => {}} onStart={() => {}} />);

  it("the New letter form asks with the title and the purpose: the clients or the team, nothing picked for them, no list of people", () => {
    const html = modal(true);
    expect(html).toContain("data-letter-for");
    expect(html).toContain(LETTER_FOR_ASK);
    expect(html.indexOf("What is this letter for?")).toBeLessThan(html.indexOf(LETTER_FOR_ASK));
    expect(html).toContain(LETTER_FOR_LABEL.clients);
    expect(html).toContain(LETTER_FOR_LABEL.guides);
    expect(LETTER_FOR_LABEL).toEqual({ clients: "The clients", guides: "The team" });
    expect((html.match(/type="radio"/g) ?? []).length).toBe(2);
    expect(html).not.toMatch(/<input[^>]*type="radio"[^>]*checked/);
    expect(html).not.toMatch(/<select|<option/);
  });

  it("on a project with no clients the form doesn't ask", () => {
    expect(modal(false)).not.toContain("data-letter-for");
  });

  it("the route refuses a new letter with nobody picked, keeps the pick on the draft, and is the only writer of it besides Send; a client's goes to the team and says who it is from", () => {
    const src = route("api.projects.$folderId.letters.tsx");
    expect(src).toMatch(/: houseAtStart\(\{ projectHasClients: [^}]*asked: form\.get\("to"\) \}\);\s*if \(!address\.ok\) return Response\.json\(\{ error: address\.error \}, \{ status: address\.status \}\);/);
    expect(src).toContain('{ ok: true, toHouse: "guides" } as const');
    expect(src).toContain('await merge("file_refs", fileRef._id, { to_house: address.toHouse, ...(asClient ? { from_human_id: user._id } : {}) });');
    expect((src.match(/to_house/g) ?? []).length).toBe(1);
    expect(src).not.toMatch(/from_house/);
    expect(readFileSync(path.join(here, "../components/LettersView.tsx"), "utf8")).toContain('if (to) form.append("to", to);');
  });
});

describe("the house at Send", () => {
  const control = (state: Parameters<typeof LetterSendControl>[0]["state"]) => renderToStaticMarkup(<LetterSendControl fileId="l1" state={state} onSent={() => {}} />);

  it("a draft with no address (an upload, or one from before the form asked) is asked at Send: two buttons, no default, no list of people", () => {
    const html = control({ sentDate: null, sentCount: 0, editedSinceSent: false, asksHouse: true, toHouse: null });
    expect((html.match(/data-send-button/g) ?? []).length).toBe(2);
    expect(html).toContain(">Send to the clients<");
    expect(html).toContain(">Send to the team<");
    expect(html).not.toMatch(/<select|<option|type="radio"|checked/);
  });

  it("with the house decided there is one button, and a sent letter says where it went", () => {
    const html = control({ sentDate: null, sentCount: 0, editedSinceSent: false, asksHouse: false, toHouse: "guides" });
    expect((html.match(/data-send-button/g) ?? []).length).toBe(1);
    expect(html).toContain(">Send<");
    // Picked when the letter was started; where it is going comes after
    // the button, so the two read as a sentence.
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("Send to the team");
    expect(html.indexOf("data-send-button")).toBeLessThan(html.indexOf("data-send-to-note"));
    const again = control({ sentDate: "2026-11-05", sentCount: 1, editedSinceSent: true, toHouse: "clients" });
    expect(again.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("Send again to the clients");
    expect(control({ sentDate: "2026-11-05", sentCount: 1, editedSinceSent: false, toHouse: "clients" }).replace(/<[^>]+>/g, "")).toContain("Sent Nov 5, 2026 to the clients");
  });

  it("asks before each send, naming the house, and says a send again raises the flag again", () => {
    expect(sendAsk(false, "clients")).toMatch(/^Send this letter to the clients\?/);
    expect(sendAsk(false, "guides")).toMatch(/^Send this letter to the team\?/);
    expect(sendAsk(true, "clients")).toMatch(/^Send the update to the clients\?.*flag goes up again/);
    expect(sendAsk(false, null)).toMatch(/^Send this letter\?/);
  });

  it("the send route hands the choice to sendLetter, and no save, replace or other module writes a letter's houses", () => {
    expect(route("api.letter.$fileId.send.tsx")).toContain("toHouse: body.to");
    // The editor's save names the keys it takes; a house isn't one.
    for (const name of ["api.vault.$fileId.tsx", "api.vault.replace.$fileId.tsx"]) {
      expect(route(name), name).not.toMatch(/to_house|from_house|from_human_id/);
    }
    for (const name of ["letters.server.ts", "letterReading.server.ts", "letterSync.server.ts", "fileReplace.server.ts", "letterFlags.server.ts"]) {
      expect(core(name), name).not.toMatch(/\b(to_house|from_house):\s/);
    }
    expect((core("letterSend.server.ts").match(/to_house: /g) ?? []).length).toBe(1);
    // The one-time backfill for letters from before the send gives no house.
    expect(core("letters.server.ts").match(/export async function ensureSentCopy[\s\S]*?\n}/)?.[0]).not.toMatch(/house|from_human_id/);
  });
});

describe("the desk", () => {
  const row = (over: Partial<LetterTabRow>): LetterTabRow => ({
    fileId: "x", name: "x.md", title: "X", updatedAt: "2026-11-05T08:00:00Z", size: 10, sharedAt: null, contentHash: "h", purpose: null,
    sentDate: null, sentCount: 0, sentHash: null, editedSinceSent: false, houses: null, fromHumanId: null, toHouse: null, writes: true, pdf: null, ...over,
  });
  const rows = [
    row({ fileId: "d1", title: "Being written" }),
    row({ fileId: "s1", title: "The Hales attic", sentDate: "2026-11-04", sentCount: 1, from: "Lucas", houses: { fromHumanId: "guideA", fromHouse: "guides", toHouse: "clients" } }),
    row({ fileId: "s2", title: "From a client", sentDate: "2026-11-05", sentCount: 1, editedSinceSent: true, from: "Susan", houses: { fromHumanId: "clientA", fromHouse: "clients", toHouse: "guides" } }),
    row({ fileId: "r1", title: "Addressed and not sent", toHouse: "clients" }),
    row({ fileId: "old", title: "Before houses", sentDate: "2026-10-12", sentCount: 1 }),
  ];

  it("is two groups and nothing more: what is being written, and the letters sent and received", () => {
    expect(deskGroups(rows).drafts.map((r) => r.fileId)).toEqual(["d1", "r1"]);
    // Edited since it was sent, it is still a letter that went.
    expect(deskGroups(rows).letters.map((r) => r.fileId)).toEqual(["s1", "s2", "old"]);
    const html = renderToStaticMarkup(<LettersView projectFolderId="p" rows={rows} manage={false} writes={false} onChanged={() => {}} />);
    expect((html.match(/data-desk-group/g) ?? []).length).toBe(2);
    expect(html.indexOf(DESK_DRAFTS)).toBeLessThan(html.indexOf("Being written"));
    expect(html.indexOf("Being written")).toBeLessThan(html.indexOf(`>${DESK_LETTERS}<`));
    expect(html.indexOf(`>${DESK_LETTERS}<`)).toBeLessThan(html.indexOf("The Hales attic"));
    expect(html).not.toMatch(/<select|Sort|Filter/);
  });

  it("each letter says who it is from and where it went; a draft says where it is going; a letter from before houses says neither", () => {
    const html = renderToStaticMarkup(<LettersView projectFolderId="p" rows={rows} manage={false} writes={false} onChanged={() => {}} />);
    expect(html).toContain("From Lucas, to the clients");
    expect(html).toContain("From Susan, to the team");
    expect(html).toMatch(/Addressed and not sent[\s\S]*?data-letter-houses[^>]*>To the clients</);
    expect((html.match(/data-letter-houses/g) ?? []).length).toBe(3);
  });

  it("a crafter and an observer read the desk and get no way to start, send or share a letter; the server refuses each of those anyway", () => {
    const html = renderToStaticMarkup(<LettersView projectFolderId="p" rows={rows.map((r) => ({ ...r, writes: false }))} manage={false} writes={false} onChanged={() => {}} />);
    expect(html).not.toMatch(/New letter|Upload a letter|>Replace<|>Edit<|Share link/);
    for (const group of ["Crafter", "Observer", "Client"]) {
      expect(canManageLetters({ role: "Human" }, resolveRole(group)), group).toBe(false);
      expect(letterShareRefusal({ manages: false, inLetters: true, isMarkdown: true, sent: true, on: true })).toMatchObject({ status: 403 });
    }
    // Starting a letter is a Guide's or a client's (`mayStartLetter`);
    // the talk box, the outline, the recording and the send sit behind
    // the writer's gate (`letterForWriter`, `mayWriteLetter`: nothing
    // for a Crafter or an Observer); the brief's own writing stays the
    // manager's.
    expect(route("api.projects.$folderId.letters.tsx")).toMatch(/if \(!mayStartLetter\(viewer\)\) \{\s*return Response\.json\(\{ error: LETTER_START_REFUSED \}, \{ status: 403 \}\);/);
    for (const name of ["talk", "outline", "recording", "send"]) {
      expect(route(`api.letter.$fileId.${name}.tsx`), name).toMatch(/letterForWriter\(request, (params\.)?fileId\)/);
    }
    expect(route("api.letter.$fileId.brief.tsx")).toMatch(/export async function action[\s\S]*letterForManager\(request, params\.fileId\)/);
    // And the side door: writing any file in the Letters folder is a Guide's.
    expect(core("projectSharing.server.ts")).toContain("if (project) return writesInFolder(await getProjectRole(project, actingHumanId), folder!);");
  });
});

describe("one letter, alone", () => {
  const page = route("public.letter.$fileId.tsx");

  it("renders one letter's body: one renderer, fed the loader's one body, with nothing listed under it", () => {
    expect((page.match(/<OxRenderer/g) ?? []).length).toBe(1);
    expect(page).toContain("markdown={body}");
    // Nothing on the page loops over letters: one body, no list.
    expect(page).not.toMatch(/\.map\(/);
  });

  it("opening it is what lowers the flag: once the link-on door or the member's door has let the reader in, never for a render, a preview, a prefetch or an admin looking as someone", () => {
    expect(page).toContain("if (shared) return opened(shared, await resolveLetterPage(shared.file, origin), user, person, asThemself);");
    expect(page).toContain("if (sent) return opened(sent, await resolveLetterPage(sent.file, origin), user, person, asThemself);");
    expect(page).toContain("if (printing) return opened(printing, await resolveLetterPage(printing.file, origin), null, false, false);");
    expect(page).toContain("const user = rendering ? null : await getUser(request);");
    expect(page).toContain("const asThemself = !!user && !(await isImpersonating(request));");
    expect(page).toMatch(/const person = asThemself && request\.method === "GET" && [^;]*prefetch[^;]*;/);
    expect(page).toContain("return { ...(await resolveLetterPage(mine.file, origin, true)), ...NO_READING, writeAt: letterDeskPath(mine.project._id, mine.file._id) as string | null };");
  });

  it("has no Reply: writing back is a new letter started at the desk, never a button on the letter (Austin, 2026-11-05)", () => {
    expect(page).not.toMatch(/<button|Reply<|\/reply|canReply/);
    expect(existsSync(path.join(here, "../routes/api.letter.$fileId.reply.tsx"))).toBe(false);
    for (const name of ["letterHouses.ts", "letterSend.server.ts", "letters.server.ts", "vault.types.ts"]) expect(core(name), name).not.toMatch(/answers_file_id|replyOffered|startReply/);
  });

  it("the reader's own talk-through is the one thing beside the letter: a line under the header, the box after the letter, both out of print, and only when the loader hands one over (2026-11-06)", () => {
    expect(page).toContain("{reflection && <ReflectionTwirl open={reflecting} keptDate={keptOn} onToggle={() => setReflecting((o) => !o)} />}");
    expect(page).toMatch(/\{reflection && fileId && \(\s*<div className=\{`\$\{hideInPrint\}[^>]*data-reflection-column>\s*<LetterReflection /);
    // The box is outside the reading column, which is capped and has no room in it.
    expect(page.indexOf("</WebsitePageContent>")).toBeLessThan(page.indexOf("data-reflection-column"));
    expect(page).toContain("return { ...page, ...(await readLetter(found.file, found.project, viewer, { lowers: person, reflects: asThemself })), writeAt: null as string | null };");
    expect(page).toContain("const NO_READING: LetterReading = { from: null, toHouse: null, reflection: null, writeBackIn: null };");
    // Still no action on the page: the reflection's writes are its own route's.
    expect(page).not.toMatch(/export (async )?function action/);
    expect(route("api.letter.$fileId.reflection.tsx")).toContain("letterForReader(request, params.fileId)");
    expect(route("api.dictation.start.tsx")).toMatch(/if \(body\.reflectOn\) \{\s*const got = await letterForReader\(request, body\.reflectOn\);/);

    const none = { draft: null, kept: null };
    const line = renderToStaticMarkup(<ReflectionTwirl open={false} keptDate={null} onToggle={() => {}} />);
    expect(line).toContain("Talk it through ▸");
    expect(line).not.toContain("Kept");
    expect(renderToStaticMarkup(<ReflectionTwirl open={false} keptDate="2026-11-06" onToggle={() => {}} />)).toContain("Kept Nov 6, 2026");
    // Closed, the box draws nothing; open, both prompts, the box and Keep it.
    expect(renderToStaticMarkup(<LetterReflection fileId="l1" initial={none} writeBackIn={null} open={false} onKept={() => {}} />)).toBe("");
    const open = renderToStaticMarkup(<LetterReflection fileId="l1" initial={{ draft: "so far", kept: null }} writeBackIn="proj" open onKept={() => {}} />);
    for (const prompt of REFLECT_PROMPTS) expect(open).toContain(prompt.replaceAll("'", "&#x27;"));
    expect(open).toContain("so far");
    expect(open).toContain("data-reflection-keep");
    expect(open).not.toContain("data-reflection-write-back");
    // Kept: their words and, for someone who may write letters, the way to start one. Nobody else gets the link.
    const kept = { draft: null, kept: { text: "The fan matters more than the floor.", date: "2026-11-06", suggestion: false } };
    const mine = renderToStaticMarkup(<LetterReflection fileId="l1" initial={kept} writeBackIn="proj" open onKept={() => {}} />);
    expect(mine).toContain("The fan matters more than the floor.");
    expect(mine).toContain('href="/newspaper/proj?tab=letters&amp;from=l1"');
    expect(mine).not.toContain("<textarea");
    const clients = renderToStaticMarkup(<LetterReflection fileId="l1" initial={{ draft: null, kept: { ...kept.kept, suggestion: true } }} writeBackIn={null} open onKept={() => {}} />);
    expect(clients).not.toContain("data-reflection-write-back");
    expect(clients).toContain(REFLECT_KEPT_SUGGESTION);
    for (const words of [REFLECT_LABEL, ...REFLECT_PROMPTS, REFLECT_HINT, REFLECT_KEEP, REFLECT_KEEP_ASK, REFLECT_KEPT_NOTE, REFLECT_KEPT_SUGGESTION, REFLECT_WRITE_BACK, letterStartFromLine({ letterFileId: "l1", title: "The attic floor", from: "Lucas" }), LETTER_START]) {
      expect(words).not.toMatch(/—|\breply\b|\bhouse\b/i);
    }
  });

  it("a letter started from a kept talk-through opens the same form: what it comes from, the same three questions with nothing picked, one button and no brief", () => {
    const html = renderToStaticMarkup(<NewLetterModal open busy={false} error={null} asksHouse startFrom={{ letterFileId: "l1", title: "The attic floor", from: "Lucas" }} onClose={() => {}} onStart={() => {}} />);
    expect(html).toContain("Starting from what you said about &quot;The attic floor&quot;, from Lucas.");
    expect(html).toContain("data-letter-start");
    expect(html).toContain("Start the letter");
    expect(html).not.toMatch(/Write the brief first|Go straight to the letter|data-brief-run-note|a brief is written from it/);
    expect(html).toContain("What is this letter for?");
    expect(html).toContain("data-letter-for");
    expect(html).not.toMatch(/checked=""/);
    // The plain form is as it was.
    const plain = renderToStaticMarkup(<NewLetterModal open busy={false} error={null} asksHouse onClose={() => {}} onStart={() => {}} />);
    expect(plain).toContain("Write the brief first");
    expect(plain).toContain("and a brief is written from it.");
    expect(plain).not.toContain("data-letter-start-from");
    const view = readFileSync(path.join(here, "../components/LettersView.tsx"), "utf8");
    expect(view).toContain('if (from) form.append("from", from.letterFileId);');
    expect(view).toContain('if (!withBrief || from) form.append("brief", "skip");');
  });

  it("at the desk, a letter's writer gets Edit on the row and Delete on a draft only; a reader gets neither (2026-11-06)", () => {
    const row = (over: Partial<LetterTabRow>): LetterTabRow => ({
      fileId: "x", name: "x.md", title: "X", updatedAt: "2026-11-05T08:00:00Z", size: 10, sharedAt: null, contentHash: "h", purpose: null,
      sentDate: null, sentCount: 0, sentHash: null, editedSinceSent: false, houses: null, fromHumanId: null, toHouse: null, writes: true, pdf: null, ...over,
    });
    const draftRow = row({ fileId: "d1", title: "Still writing", toHouse: "clients" });
    const sentRow = row({ fileId: "s1", title: "Went out", sentDate: "2026-11-04", sentCount: 1, from: "Lucas", houses: { fromHumanId: "guideA", fromHouse: "guides", toHouse: "clients" } });
    const manager = renderToStaticMarkup(<LettersView projectFolderId="p" rows={[draftRow, sentRow]} manage writes onChanged={() => {}} />);
    expect((manager.match(/data-letter-edit/g) ?? []).length).toBe(2);
    expect(manager).toContain('href="/newspaper/p/letter/d1"');
    expect(manager).toContain('href="/newspaper/p/letter/s1"');
    expect((manager.match(/data-letter-delete/g) ?? []).length).toBe(1);
    expect(manager.indexOf("data-letter-delete")).toBeLessThan(manager.indexOf('data-letter="s1"'));
    // A link that was ever on is a letter someone may hold: no Delete.
    const linked = renderToStaticMarkup(<LettersView projectFolderId="p" rows={[row({ fileId: "k1", sharedAt: "2026-10-20T10:00:00Z" })]} manage writes onChanged={() => {}} />);
    expect(linked).not.toContain("data-letter-delete");
    const reader = renderToStaticMarkup(<LettersView projectFolderId="p" rows={[draftRow, sentRow].map((r) => ({ ...r, writes: false }))} manage={false} writes={false} onChanged={() => {}} />);
    expect(reader).not.toMatch(/data-letter-edit|data-letter-delete|\/letter\/d1/);
    expect(LETTER_DELETE_DRAFT_ASK).not.toMatch(/—/);
  });

  it("the words around a letter are plain", () => {
    for (const words of [HOUSE_NOT_CHOSEN, MAILBOX_EMPTY, MAILBOX_SAYS_NEW, MAILBOX_SAYS_QUIET, DESK_DRAFTS, LETTER_FOR_ASK, sendAsk(false, "clients"), sendAsk(true, "guides")]) {
      expect(words).not.toMatch(/—|\bhouse\b/);
    }
  });
});

describe("layout that broke on a real screen (2026-11-05)", () => {
  it("the New letter form's three buttons wrap as whole buttons: a wrapping row, no label broken across lines", () => {
    const src = readFileSync(path.join(here, "../components/LettersView.tsx"), "utf8");
    const footer = src.slice(src.indexOf("Cancel") - 400, src.indexOf("Write the brief first") + 200);
    expect(footer).toContain("<Cluster gap={3}");
    // Two side by side on a plain new letter; the third is the one button
    // a letter started from a kept talk-through gets in their place.
    expect((footer.match(/whiteSpace: "nowrap"/g) ?? []).length).toBe(3);
    expect(src).toContain('title="New letter" maxWidth={620}');
    // The two choices are one size: same padding, told apart by colour.
    expect(footer).toContain('className={button({ variant: "purple" })} style={{ whiteSpace: "nowrap", padding: "8px 16px" }}');
    expect(footer).not.toContain('variant: "primary"');
  });

  it("a mailbox row is the title, then who and when under it", () => {
    const html = renderToStaticMarkup(<MailList mail={mail} />);
    expect(html).toMatch(/The attic floor<\/a><span[^>]*data-letter-sent[^>]*>from Lucas · Nov 4, 2026<\/span>/);
    expect(html).toMatch(/flex-direction:column/);
  });

  it("the letter's header sits inside the letter's own column", () => {
    const src = route("public.letter.$fileId.tsx");
    const open = src.indexOf("<WebsitePageContent>");
    expect((src.match(/<WebsitePageContent>/g) ?? []).length).toBe(1);
    expect(open).toBeLessThan(src.indexOf("<header"));
    expect(src.indexOf("<OxRenderer")).toBeLessThan(src.indexOf("</WebsitePageContent>"));
  });
});
