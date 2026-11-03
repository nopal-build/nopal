// A project's payments, on its Maker page (payments seed, Austin
// 2026-11-03): bill the project for a one-off and see where each bill
// stands. The guide's one place to act on a project's billing; the
// Maker's Payments page only lists, and links here. Posts to
// `/maker/projects/:id/billing`.
import { useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import type { BillingActionResult } from "../routes/maker_.projects_.$folderId_.billing";
import type { PlanView } from "../data/billingNotices.server";
import type { AttachableFile } from "../data/payments.server";
import { Checkbox } from "stamps/Checkbox";
import { Cluster } from "stamps/Cluster";
import { CopyField } from "stamps/CopyField";
import { Input } from "stamps/Input";
import { Select } from "stamps/Select";
import { Stack } from "stamps/Stack";
import { Badge } from "stamps/Badge";
import { button } from "stamps/button.css";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { discounted, formatUsd, parseDiscountPercent } from "robustness-core/data/billingRules";

/** A menu item with its fixed price; null for an amount the guide types. */
export type PricedOption = { value: string; label: string; cents: number | null };

export type ChargeStatusView = "open" | "processing" | "paid" | "failed" | "canceled";

export type ProjectChargeView = {
  id: string;
  label: string;
  amount: string;
  discount: string | null;
  status: ChargeStatusView;
  category: string;
  paidBy: string | null;
  payLink: string;
  attachments: string[];
};

export const CHARGE_STATUS_LABEL: Record<ChargeStatusView, string> = {
  open: "Waiting",
  processing: "Paying (bank transfer clears in a few days)",
  paid: "Paid",
  failed: "Payment failed",
  canceled: "Withdrawn",
};

function Notice({ tone, children }: { tone: "danger" | "subtle"; children: ReactNode }) {
  return (
    <p
      className={`${textSize.sm} ${sprinkles({ m: 0 })}`}
      style={{ color: tone === "danger" ? semanticColors.textDanger : semanticColors.textSubtle }}
    >
      {children}
    </p>
  );
}

/** The project's receipts and PDFs, loaded when the guide asks for them
 * so the page doesn't read every project's files up front. Each ticked
 * one posts as a `files` field. */
function AttachFiles({ action }: { action: string }) {
  const files = useFetcher<{ files: AttachableFile[] }>();
  const [picked, setPicked] = useState<string[]>([]);
  const list = files.data?.files;
  if (!list) {
    return (
      <button
        type="button"
        className={`${link} ${textSize.sm}`}
        style={{ alignSelf: "flex-start" }}
        disabled={files.state !== "idle"}
        onClick={() => files.load(`${action}?files=1`)}
      >
        {files.state !== "idle" ? "Finding the project's receipts…" : "Attach receipts or PDFs from the project"}
      </button>
    );
  }
  if (list.length === 0) {
    return (
      <Notice tone="subtle">
        This project has no receipts or PDFs yet. Add one to the project first and it will show here.
      </Notice>
    );
  }
  return (
    <Stack gap={2}>
      <span className={`${textSize.sm} ${sprinkles({ fontWeight: "semibold" })}`}>Attach</span>
      {list.map((f) => (
        <Checkbox
          key={f.fileId}
          label={`${f.name}${f.amount ? ` · ${f.amount}` : ""}${f.kind ? ` · ${f.kind}` : ""}`}
          checked={picked.includes(f.fileId)}
          onChange={(on) => setPicked((p) => (on ? [...p, f.fileId] : p.filter((id) => id !== f.fileId)))}
        />
      ))}
      {picked.map((id) => (
        <input key={id} type="hidden" name="files" value={id} />
      ))}
    </Stack>
  );
}

/** A one-off's fixed price, a discount box, and what the client pays
 * (Austin, 2026-11-03: the price is locked in; the guide may take a
 * percent off a one-hour decision or a letter to get someone started). */
function PriceAndDiscount({
  cents,
  per,
  discount,
  onDiscount,
}: {
  cents: number | null;
  per?: string;
  discount: string;
  onDiscount: (v: string) => void;
}) {
  if (cents == null) return null;
  const pct = parseDiscountPercent(discount);
  const each = per ? ` ${per}` : "";
  return (
    <Stack gap={2}>
      <span className={textSize.sm}>
        Price: <strong>{formatUsd(cents)}</strong>
        {each}
      </span>
      <Input label="Discount, % (optional)" name="discount" type="number" min={1} max={99} step={1} value={discount} onChange={(e) => onDiscount(e.target.value)} placeholder="0" />
      {pct === "invalid" ? (
        <Notice tone="danger">A discount is a whole percent, 1 to 99.</Notice>
      ) : (
        pct && (
          <Notice tone="subtle">
            The client pays {formatUsd(discounted(cents, pct))}
            {each}.
          </Notice>
        )
      )}
    </Stack>
  );
}

function BillThisProject({
  action,
  kinds,
  typedKinds,
  hasClients,
}: {
  action: string;
  kinds: PricedOption[];
  typedKinds: string[];
  hasClients: boolean;
}) {
  const fetcher = useFetcher<BillingActionResult>();
  const [kind, setKind] = useState("custom");
  const [discount, setDiscount] = useState("");
  const priced = kinds.find((k) => k.value === kind)?.cents ?? null;
  const busy = fetcher.state !== "idle";
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  return (
    <fetcher.Form method="post" action={action}>
      <input type="hidden" name="intent" value="bill" />
      <Stack gap={3}>
        <h3 className={`${textSize.base} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Bill this project</h3>
        <Select label="For" name="kind" options={kinds} value={kind} onChange={(e) => setKind(e.target.value)} required />
        {typedKinds.includes(kind) ? (
          <Input label="Amount (dollars)" name="amount" placeholder="1000" required />
        ) : (
          <PriceAndDiscount cents={priced} discount={discount} onDiscount={setDiscount} />
        )}
        <Input label="What it's for, as the client will see it" name="note" placeholder="Attic beam sizing, with a letter" required />
        <AttachFiles action={action} />
        {!hasClients && <Notice tone="subtle">Nobody on this project is a Client yet. Add one above to send a bill.</Notice>}
        {result && "error" in result && <Notice tone="danger">{result.error}</Notice>}
        {result && "ok" in result && result.message && <Notice tone="subtle">{result.message}</Notice>}
        <Cluster gap={3}>
          <button type="submit" className={button({ variant: "secondary" })} disabled={busy || !hasClients}>
            {busy ? "Sending…" : "Send"}
          </button>
        </Cluster>
      </Stack>
    </fetcher.Form>
  );
}

/** The project's plan: its level, or None, with its monthly rate as a
 * reminder (no discount: every client pays the same), and the monthly
 * billing day the guide must set (Austin, 2026-11-03). Once
 * a client has linked a bank account, a new level is a plan change at
 * the next billing date, and None ends the plan when the month closes. */
function PlanPicker({
  action,
  plan,
  levels,
  hasClients,
}: {
  action: string;
  plan: PlanView;
  levels: PricedOption[];
  hasClients: boolean;
}) {
  const fetcher = useFetcher<BillingActionResult>();
  const resume = useFetcher<BillingActionResult>();
  const [level, setLevel] = useState(plan.status === "canceled" || plan.status === "canceling" ? "none" : (plan.level ?? "none"));
  const levelCents = levels.find((l) => l.value === level)?.cents ?? null;
  const busy = fetcher.state !== "idle";
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  const resumed = resume.state === "idle" ? resume.data : undefined;
  const notStarted = plan.status === "none" || plan.status === "canceled" || plan.awaitingSetup;
  return (
    <Stack gap={3}>
      <Cluster gap={3} align="baseline">
        <h3 className={`${textSize.base} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Plan</h3>
        {plan.onHold && <Badge>Work on hold</Badge>}
      </Cluster>
      <Notice tone="subtle">{plan.line}</Notice>
      {plan.canApproveResume && (
        <Cluster gap={3} align="center">
          <button
            type="button"
            className={button({ variant: "primary" })}
            disabled={resume.state !== "idle"}
            onClick={() => resume.submit({ intent: "approve_resume" }, { method: "post", action })}
          >
            Approve the resume
          </button>
          <Notice tone="subtle">Billing starts again today, on a new monthly date.</Notice>
        </Cluster>
      )}
      {resumed && "error" in resumed && <Notice tone="danger">{resumed.error}</Notice>}
      {resumed && "ok" in resumed && resumed.message && <Notice tone="subtle">{resumed.message}</Notice>}
      <fetcher.Form method="post" action={action}>
        <input type="hidden" name="intent" value="plan" />
        <Stack gap={3}>
          <Select
            label="Plan level"
            name="level"
            options={[{ value: "none", label: "None" }, ...levels.map(({ value, label }) => ({ value, label }))]}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            required
          />
          {level !== "none" && levelCents != null && (
            <span className={textSize.sm}>
              Bills <strong>{formatUsd(levelCents)}</strong> a month
            </span>
          )}
          {notStarted && level !== "none" && <Input label="Monthly billing day" name="start" type="date" required />}
          {result && "error" in result && <Notice tone="danger">{result.error}</Notice>}
          {result && "ok" in result && result.message && <Notice tone="subtle">{result.message}</Notice>}
          <Cluster gap={3}>
            <button type="submit" className={button({ variant: "secondary" })} disabled={busy || !hasClients}>
              {busy ? "Saving…" : "Save the plan"}
            </button>
          </Cluster>
        </Stack>
      </fetcher.Form>
    </Stack>
  );
}

function ChargeRow({ charge, action }: { charge: ProjectChargeView; action: string }) {
  const fetcher = useFetcher<BillingActionResult>();
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const unpaid = charge.status === "open" || charge.status === "failed";
  return (
    <Stack gap={2}>
      <Cluster gap={3} align="baseline">
        <strong>{charge.amount}</strong>
        <span>{charge.label}</span>
        {charge.discount && (
          <span className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
            {charge.discount}
          </span>
        )}
        <Badge>{CHARGE_STATUS_LABEL[charge.status]}</Badge>
        {charge.attachments.length > 0 && (
          <span className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
            {charge.attachments.length === 1 ? charge.attachments[0] : `${charge.attachments.length} files`}
          </span>
        )}
        {charge.paidBy && (
          <span className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
            by {charge.paidBy}
          </span>
        )}
      </Cluster>
      {unpaid && (
        <Cluster gap={3} align="center">
          <CopyField value={charge.payLink} ariaLabel={`Pay link for ${charge.label}`} copyLabel="Copy link" />
          <button
            type="button"
            className={`${link} ${textSize.xs}`}
            disabled={fetcher.state !== "idle"}
            onClick={() => fetcher.submit({ intent: "withdraw", chargeId: charge.id }, { method: "post", action })}
          >
            Withdraw
          </button>
        </Cluster>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </Stack>
  );
}

export function ProjectPayments({
  projectId,
  configured,
  hasClients,
  kinds,
  typedKinds,
  charges,
  plan,
  levels,
}: {
  projectId: string;
  configured: boolean;
  hasClients: boolean;
  kinds: PricedOption[];
  typedKinds: string[];
  charges: ProjectChargeView[];
  plan: PlanView;
  levels: PricedOption[];
}) {
  const action = `/maker/projects/${projectId}/billing`;
  return (
    <Stack gap={5}>
      <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Payments</h2>
      {!configured ? (
        <Notice tone="subtle">Stripe isn't set up on this server yet.</Notice>
      ) : (
        <>
          <PlanPicker action={action} plan={plan} levels={levels} hasClients={hasClients} />
          <BillThisProject action={action} kinds={kinds} typedKinds={typedKinds} hasClients={hasClients} />
        </>
      )}
      {charges.length > 0 && (
        <Stack gap={4}>
          {charges.map((c) => (
            <ChargeRow key={c.id} charge={c} action={action} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
