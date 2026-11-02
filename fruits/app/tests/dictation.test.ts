/**
 * The record button (record-in-daily-log seed, built 2026-11-02 without
 * kept audio). What code can check: words come back while audio is still
 * going out, fillers go and nothing else does, the terms put the Card's
 * project first and fit Soniox's context, a start is refused where typing
 * would be, silence keeps the stream alive, and settled words that
 * arrived before a failure still reach the entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import { createFinalTextBuffer, removeFillers } from "../../dictation/fillers.js";
import { signTicket, verifyTicket } from "../../dictation/ticket.js";
import { attachDictationRelay, DICTATION_PATH } from "../../dictation/relay.js";
import { buildDictationContext } from "../modules/dictationTerms";
import { insertFinal } from "../oxmarkdown/DictateButtonPlugin";

// ── The start route's checks ───────────────────────────────────────────────
const state = vi.hoisted(() => ({
  user: { _id: "h1" } as { _id: string } | null,
  cards: [] as { fileName: string; fileId: string; projectFolderId: string }[],
  features: ["dailyLog", "feeds"] as string[],
}));
vi.mock("../modules/auth/auth.server", () => ({ getUser: vi.fn(async () => state.user) }));
vi.mock("robustness-core/data/dailyLog.server", () => ({ getDailyLogCards: vi.fn(async () => state.cards) }));
vi.mock("robustness-core/data/vault.server", () => ({
  getFolderById: vi.fn(async (id: string) => ({ _id: id, name: id === "p1" ? "Crouch Residence" : "Coronado" })),
}));
vi.mock("robustness-core/data/projectSharing.server", () => ({
  getProjectRole: vi.fn(async () => ({ features: state.features })),
  getProjectSharing: vi.fn(async () => []),
  listProjectsFor: vi.fn(async () => []),
}));
vi.mock("../data/projectPeople.server", () => ({
  peopleOnMany: vi.fn(async (projects: { folder: { _id: string; name: string } }[]) =>
    projects.map(({ folder }) => ({ id: folder._id, name: folder.name, members: [{ name: "Gerald Bowen" }] })),
  ),
}));
import { action as startAction } from "../routes/api.dictation.start";

const startRequest = (body: unknown) =>
  startAction({
    request: new Request("http://x/api/dictation/start", { method: "POST", body: JSON.stringify(body) }),
  } as Parameters<typeof startAction>[0]);

describe("starting a recording", () => {
  beforeEach(() => {
    state.user = { _id: "h1" };
    state.cards = [{ fileName: "card-p1.md", fileId: "f1", projectFolderId: "p1" }];
    state.features = ["dailyLog", "feeds"];
  });

  it("is refused with no session", async () => {
    state.user = null;
    expect((await startRequest({ date: "2026-11-02" })).status).toBe(401);
  });

  it("is refused for a Card that isn't the person's, or a project they no longer write to", async () => {
    expect((await startRequest({ date: "2026-11-02", cardFile: "card-p9.md" })).status).toBe(404);
    state.features = ["files"];
    expect((await startRequest({ date: "2026-11-02", cardFile: "card-p1.md" })).status).toBe(403);
  });

  it("hands back a ticket carrying the Card's project and its people", async () => {
    const res = await startRequest({ date: "2026-11-02", cardFile: "card-p1.md" });
    const { ticket } = await res.json();
    const payload = verifyTicket(ticket);
    expect(payload.humanId).toBe("h1");
    expect(payload.context.terms).toEqual(["Crouch Residence", "Gerald Bowen"]);
  });
});

// ── Fillers ────────────────────────────────────────────────────────────────
describe("filler removal", () => {
  it("drops the listed fillers and their stretched forms", () => {
    expect(removeFillers("Um, so we set the forms. Uhh the pour is Thursday.")).toBe(
      "So we set the forms. The pour is Thursday.",
    );
    expect(removeFillers("we hit, ummm, ledge rock and hmm had to stop")).toBe("we hit, ledge rock and had to stop");
    expect(removeFillers("Er the drywall, ah, came late, errr, again")).toBe("The drywall, came late, again");
  });

  it("keeps everything else, including words that carry meaning", () => {
    const kept = "So it was like, you know, the err of the inspector. Ahead of the umbrella hum.";
    expect(removeFillers(kept)).toBe(kept);
  });

  it("judges a filler split across pieces as one word", () => {
    const buf = createFinalTextBuffer();
    const out = [buf.push("We "), buf.push("u"), buf.push("m "), buf.push("poured"), buf.push(" today."), buf.flush()];
    expect(out.join("")).toBe("We poured today.");
  });

  it("capitalises a sentence that a filler opened in a later piece", () => {
    const buf = createFinalTextBuffer();
    const out = [buf.push("Forms are up. "), buf.push("Um, the "), buf.push("rebar is next. "), buf.flush()];
    expect(out.join("")).toBe("Forms are up. The rebar is next. ");
  });
});

// ── Terms ──────────────────────────────────────────────────────────────────
describe("terms for the engine", () => {
  it("puts the first project first, drops repeats, and stops at the budget", () => {
    const ctx = buildDictationContext(
      [
        { name: "Crouch Residence", people: ["Gerald Bowen", "Austin T"] },
        { name: "Coronado", people: ["Gerald Bowen", "Lucas M"] },
      ],
      120,
    );
    expect(ctx.terms[0]).toBe("Crouch Residence");
    expect(ctx.terms.filter((t) => t === "Gerald Bowen")).toHaveLength(1);
    expect(JSON.stringify(ctx).length).toBeLessThan(120 + 40);
    expect(ctx.terms).not.toContain("Lucas M");
  });
});

// ── Tickets ────────────────────────────────────────────────────────────────
describe("tickets", () => {
  it("refuses a forged or expired ticket", () => {
    const t = signTicket({ humanId: "h1" }, 0);
    expect(verifyTicket(t, 1)).toMatchObject({ humanId: "h1" });
    expect(verifyTicket(t, 120_000)).toBeNull();
    const [body] = t.split(".");
    expect(verifyTicket(`${body}.forged`, 1)).toBeNull();
  });
});

// ── The relay against a fake Soniox ────────────────────────────────────────
type Fake = {
  url: string;
  configs: Record<string, unknown>[];
  frames: Buffer[];
  texts: string[];
  onAudio: (ws: WebSocket, frame: Buffer) => void;
  server: WebSocketServer;
};

function fakeSoniox(): Promise<Fake> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port: 0 });
    const fake: Fake = { url: "", configs: [], frames: [], texts: [], onAudio: () => {}, server };
    server.on("connection", (ws) => {
      ws.on("message", (data, isBinary) => {
        if (isBinary) {
          fake.frames.push(data as Buffer);
          fake.onAudio(ws, data as Buffer);
          return;
        }
        const text = data.toString();
        fake.texts.push(text);
        if (text === "") {
          ws.send(JSON.stringify({ tokens: [], finished: true }));
          ws.close();
          return;
        }
        const msg = JSON.parse(text);
        if (msg.model) fake.configs.push(msg);
      });
    });
    server.on("listening", () => {
      fake.url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve(fake);
    });
  });
}

let http: Server;
let fake: Fake;
let relayUrl: string;

async function startRelay(options: Record<string, unknown> = {}) {
  fake = await fakeSoniox();
  http = createServer();
  attachDictationRelay(http, { apiKey: "test", sonioxUrl: fake.url, ...options });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  relayUrl = `ws://127.0.0.1:${(http.address() as AddressInfo).port}${DICTATION_PATH}`;
}

function openClient() {
  const ws = new WebSocket(relayUrl);
  clients.push(ws);
  const messages: { type: string; text?: string; message?: string }[] = [];
  const waiters: (() => void)[] = [];
  ws.on("message", (d) => {
    messages.push(JSON.parse(d.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  const until = (pred: () => boolean) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out; got ${JSON.stringify(messages)}`)), 3000);
      const check = () => {
        if (pred()) {
          clearTimeout(timer);
          resolve();
        } else waiters.push(check);
      };
      check();
    });
  return { ws, messages, until, opened: new Promise((r) => ws.on("open", r)) };
}

const clients: WebSocket[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.terminate());
  if (http) {
    http.closeAllConnections();
    await new Promise((r) => http.close(r));
  }
  if (fake) {
    fake.server.clients.forEach((c) => c.terminate());
    await new Promise((r) => fake.server.close(r));
  }
  http = undefined as unknown as Server;
  fake = undefined as unknown as Fake;
});

describe("the relay", () => {
  it("sends settled words back before the last chunk of audio has gone out", async () => {
    await startRelay();
    fake.onAudio = (ws) => {
      if (fake.frames.length === 1) {
        ws.send(JSON.stringify({ tokens: [{ text: "Poured", is_final: true }, { text: " the", is_final: true }, { text: " slab", is_final: false }] }));
      }
    };
    const c = openClient();
    await c.opened;
    c.ws.send(JSON.stringify({ type: "start", ticket: signTicket({ humanId: "h1", context: { text: "x", terms: ["Viscon"] } }) }));
    c.ws.send(Buffer.alloc(3200));
    await c.until(() => c.messages.some((m) => m.type === "final"));
    expect(fake.frames).toHaveLength(1);
    expect(c.messages.find((m) => m.type === "final")?.text).toBe("Poured ");
    expect(c.messages.filter((m) => m.type === "provisional").at(-1)?.text).toBe(" slab");

    c.ws.send(Buffer.alloc(3200));
    c.ws.send(JSON.stringify({ type: "stop" }));
    await c.until(() => c.messages.some((m) => m.type === "done"));
    const finals = c.messages.filter((m) => m.type === "final").map((m) => m.text).join("");
    expect(finals).toBe("Poured the");
    expect(fake.configs[0]).toMatchObject({
      model: "stt-rt-v5",
      audio_format: "pcm_s16le",
      sample_rate: 16000,
      language_hints: ["en", "es"],
      context: { terms: ["Viscon"] },
    });
    // The stream was ended with an empty TEXT frame.
    expect(fake.texts.at(-1)).toBe("");
  });

  it("refuses a start without a valid ticket", async () => {
    await startRelay();
    const c = openClient();
    await c.opened;
    c.ws.send(JSON.stringify({ type: "start", ticket: "nope.nope" }));
    await c.until(() => c.messages.some((m) => m.type === "error"));
    expect(fake.configs).toHaveLength(0);
  });

  it("keeps the engine's stream alive while no audio arrives", async () => {
    await startRelay({ keepaliveMs: 60 });
    const c = openClient();
    await c.opened;
    c.ws.send(JSON.stringify({ type: "start", ticket: signTicket({ humanId: "h1" }) }));
    await c.until(() => c.messages.some((m) => m.type === "ready"));
    await new Promise((r) => setTimeout(r, 250));
    expect(fake.texts.some((t) => t.includes('"keepalive"'))).toBe(true);
  });

  it("delivers held words before reporting an engine failure", async () => {
    await startRelay();
    fake.onAudio = (ws) => {
      ws.send(JSON.stringify({ tokens: [{ text: "Framing", is_final: true }, { text: " inspection", is_final: true }] }));
      ws.send(JSON.stringify({ error_code: 500, error_message: "Engine fell over." }));
    };
    const c = openClient();
    await c.opened;
    c.ws.send(JSON.stringify({ type: "start", ticket: signTicket({ humanId: "h1" }) }));
    c.ws.send(Buffer.alloc(3200));
    await c.until(() => c.messages.some((m) => m.type === "error"));
    const finals = c.messages.filter((m) => m.type === "final").map((m) => m.text).join("");
    expect(finals).toBe("Framing inspection");
  });

  it("stops at the length cap and says so", async () => {
    await startRelay({ maxRecordingMs: 80 });
    const c = openClient();
    await c.opened;
    c.ws.send(JSON.stringify({ type: "start", ticket: signTicket({ humanId: "h1" }) }));
    await c.until(() => c.messages.some((m) => m.type === "done"));
    expect(c.messages.some((m) => m.type === "capped")).toBe(true);
  });
});

// ── Where the words land ───────────────────────────────────────────────────
describe("inserting settled words", () => {
  function editorWith(text: string) {
    const editor = createEditor({ onError: (e) => { throw e; } });
    editor.update(
      () => {
        const p = $createParagraphNode();
        p.append($createTextNode(text));
        $getRoot().append(p);
      },
      { discrete: true },
    );
    return editor;
  }
  const textOf = (editor: ReturnType<typeof createEditor>) => editor.getEditorState().read(() => $getRoot().getTextContent());
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("continues from where the last words went, joined with one space", async () => {
    const editor = editorWith("Site walk:");
    const key = editor.getEditorState().read(() => $getRoot().getFirstDescendant()!.getKey());
    const point = { current: { key, offset: "Site walk:".length, type: "text" as const } };
    insertFinal(editor, point, " Poured the");
    await flush();
    insertFinal(editor, point, " slab.");
    await flush();
    expect(textOf(editor)).toBe("Site walk: Poured the slab.");
  });

  it("goes at the end of the entry when its starting point was deleted", async () => {
    const editor = editorWith("First line");
    const point = { current: { key: "gone", offset: 0, type: "text" as const } };
    insertFinal(editor, point, " Second words");
    await flush();
    expect(textOf(editor)).toBe("First line Second words");
  });
});
