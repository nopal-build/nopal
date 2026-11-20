// A receipt attached to a bill (payments seed, 2026-11-03). Gates: a
// Client on the project opens it, by session or by their signed link; a
// guide, a stranger, or a link signed for someone else doesn't; and only a
// file on this bill can be opened through it, never another project file.
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "unit-secret";
});

const session = vi.hoisted(() => ({ user: null as { _id: string } | null }));
vi.mock("../modules/auth/auth.server", () => ({ getUser: async () => session.user }));
vi.mock("robustness-core/data/projectSharing.server", () => ({
  getProjectSharing: async () => [
    { human: "guide", role: "Guide" },
    { human: "sue", role: "Client" },
  ],
  listProjectsFor: async () => [],
}));
vi.mock("robustness-core/data/humans.server", () => ({
  getHumanById: async (id: string) => ({ _id: id, email: `${id}@example.com` }),
  getHumansById: async () => [],
}));
vi.mock("robustness-core/data/billing.server", () => ({
  getCharge: async (id: string) =>
    id === "bill1"
      ? { _id: "bill1", project_folder_id: "attic", attachments: [{ fileId: "receipt1", name: "Lumber.pdf", contentType: "application/pdf" }] }
      : null,
}));
vi.mock("robustness-core/data/vault.server", () => ({
  getFolderById: async () => ({ _id: "attic", name: "Attic" }),
  getFileRefById: async (id: string) => ({ _id: id, s3_key: `keys/${id}`, content_type: "application/pdf" }),
}));
vi.mock("robustness-core/data/file.server", () => ({ getPresignedViewUrl: async (key: string) => `https://s3.test/${key}` }));
vi.mock("robustness-core/data/fileFolders.server", () => ({ loadProjectFiles: async () => [] }));
vi.mock("../util/email.server", () => ({ sendEmail: async () => {} }));

import { loader } from "../routes/pay.$chargeId_.file.$fileId";
import { signedPayLink } from "../data/payments.server";

async function open(path: string, as: string | null) {
  session.user = as ? { _id: as } : null;
  const url = new URL(path, "http://localhost");
  const [, , chargeId, , fileId] = url.pathname.split("/");
  try {
    const res = (await loader({ request: new Request(url), params: { chargeId, fileId }, context: {} } as never)) as Response;
    return res.status === 302 ? (res.headers.get("Location") ?? "") : String(res.status);
  } catch (err) {
    return String((err as { init?: { status?: number } }).init?.status ?? err);
  }
}

describe("an attached receipt", () => {
  it("opens for a Client by session", async () => {
    expect(await open("/pay/bill1/file/receipt1", "sue")).toBe("https://s3.test/keys/receipt1");
  });

  it("opens through the Client's signed link with no session", async () => {
    const link = new URL(signedPayLink("http://localhost", "bill1", "sue"));
    expect(await open(`/pay/bill1/file/receipt1${link.search}`, null)).toBe("https://s3.test/keys/receipt1");
  });

  it("is refused to the guide and to a stranger", async () => {
    expect(await open("/pay/bill1/file/receipt1", "guide")).toBe("404");
    expect(await open("/pay/bill1/file/receipt1", "stranger")).toBe("404");
  });

  it("won't open a project file that isn't on the bill", async () => {
    expect(await open("/pay/bill1/file/other-project-file", "sue")).toBe("404");
  });

  it("won't take a link signed for another bill", async () => {
    const link = new URL(signedPayLink("http://localhost", "bill2", "sue"));
    expect(await open(`/pay/bill1/file/receipt1${link.search}`, null)).toBe("404");
  });
});
