/**
 * Who may pay a project's bills, the signed link a bill's email carries,
 * and sending that email (payments seed, Austin 2026-11-03).
 *
 * Any Client on the project pays; nobody else does, staff included, so a
 * guide can't pay their own bill by accident. The pay page checks this on
 * every load (cards.md: a group that can see a page can't necessarily
 * fetch what it shows), whether the visitor came by session or by link.
 *
 * The emailed link pays without logging in: it names one bill and one
 * person and is signed with the session secret. It opens that bill's pay
 * page as that person and nothing else, and is useless once the bill is
 * paid or withdrawn, or once they're no longer a Client on the project.
 * Forwarded, it lets someone else pay that one bill.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Human } from "robustness-core/data/humans.server";
import { getHumanById, getHumansById } from "robustness-core/data/humans.server";
import { getProjectSharing, listProjectsFor } from "robustness-core/data/projectSharing.server";
import { CLIENT_ROLE } from "robustness-core/data/sharingRoles.server";
import type { VaultFolder } from "robustness-core/data/vault.types";
import type { BillingCharge, ChargeAttachment } from "robustness-core/data/billing.server";
import { loadProjectFiles } from "robustness-core/data/fileFolders.server";
import { discountNote, formatUsd } from "robustness-core/data/billingRules";
import { termsFor } from "robustness-core/data/billingTerms";
import { sendEmail } from "../util/email.server";
import { PaymentRequest } from "../emails/paymentRequest";
import { displayName } from "robustness-core/data/humanNames";

/** The Clients on a project, the people who may pay its bills. */
export async function clientsOn(folder: VaultFolder): Promise<Human[]> {
  const sharing = await getProjectSharing(folder);
  return getHumansById(sharing.filter((e) => e.role === CLIENT_ROLE).map((e) => e.human));
}

/** The projects this person is a Client on: whose payments their
 * profile shows. A guide's own projects aren't here, so a guide's profile
 * has no payments (Austin, 2026-11-03). */
export async function clientProjectsFor(humanId: string): Promise<VaultFolder[]> {
  return (await listProjectsFor(humanId)).filter((m) => m.role === CLIENT_ROLE).map((m) => m.folder);
}

export type AttachableFile = ChargeAttachment & { kind: string | null; amount: string | null };

/** What a guide may attach to a bill: the project's cost files (receipts,
 * invoices, estimates, bids) and its PDFs. A receipt not in O.No yet is
 * uploaded to the project first, so it's in Costs too. */
export async function attachableFiles(folder: VaultFolder): Promise<AttachableFile[]> {
  return (await loadProjectFiles(folder))
    .filter((r) => r.folders.includes("costs") || r.contentType === "application/pdf")
    .map((r) => ({
      fileId: r.serveId,
      name: r.name,
      contentType: r.contentType,
      kind: r.filing?.kind ?? null,
      amount: r.filing?.cost ? `${r.filing.cost.amount} ${r.filing.cost.currency}` : null,
    }));
}

export async function isClientOn(folder: VaultFolder, humanId: string): Promise<boolean> {
  return (await getProjectSharing(folder)).some((e) => e.human === humanId && e.role === CLIENT_ROLE);
}

type LinkScope = "pay" | "plan";

function linkSignature(scope: LinkScope, id: string, humanId: string): string {
  const secret = process.env.SESSION_SECRET || "NOT_A_STRONG_SECRET";
  return createHmac("sha256", secret).update(`${scope}:${id}:${humanId}`).digest("base64url");
}

function signedLink(origin: string, path: string, scope: LinkScope, id: string, humanId: string): string {
  const params = new URLSearchParams({ for: humanId, sig: linkSignature(scope, id, humanId) });
  return `${origin}${path}?${params}`;
}

async function personFromLink(scope: LinkScope, id: string, url: URL): Promise<Human | null> {
  const humanId = url.searchParams.get("for");
  const sig = url.searchParams.get("sig");
  if (!humanId || !sig) return null;
  const expected = Buffer.from(linkSignature(scope, id, humanId));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return (await getHumanById(humanId)) ?? null;
}

/** The pay link for one person on one bill, as the email carries it. */
export function signedPayLink(origin: string, chargeId: string, humanId: string): string {
  return signedLink(origin, `/pay/${chargeId}`, "pay", chargeId, humanId);
}

/** The person a pay link was signed for, or null if it wasn't signed for
 * this bill. Whether they may still pay is `isClientOn`'s. */
export function personFromPayLink(chargeId: string, url: URL): Promise<Human | null> {
  return personFromLink("pay", chargeId, url);
}

/** The link that sets up (or re-banks) one project's plan, for one person. */
export function signedPlanLink(origin: string, folderId: string, humanId: string): string {
  return signedLink(origin, `/pay/plan/${folderId}`, "plan", folderId, humanId);
}

export function personFromPlanLink(folderId: string, url: URL): Promise<Human | null> {
  return personFromLink("plan", folderId, url);
}

/** Email a new bill to every Client on the project, each with their own
 * link. Returns how many it went to. */
export async function sendPaymentRequest(input: {
  charge: BillingCharge;
  folder: VaultFolder;
  guide: Human;
  origin: string;
}): Promise<number> {
  const { charge, folder, guide, origin } = input;
  const clients = await clientsOn(folder);
  const guideName = displayName(guide);
  const terms = termsFor(charge.category);
  await Promise.all(
    clients.map((client) =>
      sendEmail({
        to: [client.email],
        subject: `${guideName} sent a bill for ${folder.name}`,
        react: PaymentRequest({
          name: displayName(client),
          guideName,
          projectName: folder.name,
          label: charge.label,
          amount: formatUsd(charge.amount_cents),
          discount: discountNote(charge.list_amount_cents, charge.discount_percent),
          termsTitle: terms.title,
          payUrl: signedPayLink(origin, charge._id, client._id),
          attached: charge.attachments?.length ?? 0,
        }),
      }),
    ),
  );
  return clients.length;
}
