// app/components/ProfilePayments.tsx
// The profile's Payments section (payments seed, Austin 2026-11-03): for
// a Client, each project's plan with its buttons (link a bank account,
// ask for a different level (the guide decides, 2026-11-09), pause or
// undo it, ask to resume, cancel, use another
// account), then the bills on every project they're a Client on. Guides
// have none: their controls are on the project's Maker page.
import { useState } from "react";
import { Link, useFetcher } from "react-router";
import type { PlanView } from "../data/billingNotices.server";
import type { PlanActionResult } from "../routes/api.billing.plan.$folderId";
import { Badge } from "stamps/Badge";
import { Cluster } from "stamps/Cluster";
import { Select } from "stamps/Select";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { button } from "stamps/button.css";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { semanticColors } from "stamps/tokens";
import { textSize } from "stamps/typography.css";

export type ProfileCharge = {
  id: string;
  label: string;
  amount: string;
  status: "open" | "processing" | "paid" | "failed" | "canceled";
  project: string;
};

export type ProfilePlan = { folderId: string; project: string; view: PlanView };

const STATUS: Record<ProfileCharge["status"], string> = {
  open: "To pay",
  processing: "Clearing",
  paid: "Paid",
  failed: "Didn't go through",
  canceled: "Removed",
};

function PlanCard({ plan, levels }: { plan: ProfilePlan; levels: { value: string; label: string }[] }) {
  const fetcher = useFetcher<PlanActionResult>();
  const [changing, setChanging] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const busy = fetcher.state !== "idle";
  const error = fetcher.state === "idle" && fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const action = `/api/billing/plan/${plan.folderId}`;
  const send = (intent: string, extra: Record<string, string> = {}) =>
    fetcher.submit({ intent, ...extra }, { method: "post", action });
  const v = plan.view;
  // Any level but the one billing now. The view's `level` is the plan's.
  const others = levels.filter((l) => l.value !== v.level);
  const [asked, setAsked] = useState(others[0]?.value ?? "");
  return (
    <Surface className={sprinkles({ p: 4 })}>
      <Stack gap={3}>
        <span className={`${textSize.sm} ${sprinkles({ fontWeight: "semibold" })}`}>{plan.project}</span>
        <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`}>{v.line}</p>
        {v.awaitingSetup && (
          <Link to={`/pay/plan/${plan.folderId}`} className={button({ variant: "primary" })} style={{ alignSelf: "flex-start" }}>
            Link a bank account
          </Link>
        )}
        {changing && others.length > 0 && (
          <Cluster gap={3} align="flex-end">
            <Select label="The plan you'd like" name="level" options={others} value={asked} onChange={(e) => setAsked(e.target.value)} />
            <button
              type="button"
              className={button({ variant: "secondary" })}
              disabled={busy}
              onClick={() => {
                send("request_level", { level: asked });
                setChanging(false);
              }}
            >
              Ask
            </button>
            <button type="button" className={`${link} ${textSize.xs}`} onClick={() => setChanging(false)}>
              Never mind
            </button>
          </Cluster>
        )}
        {changing && (
          <p className={`${textSize.xs} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textSubtle }}>
            Your guide confirms a new plan with you. It starts at your next billing date, or the one after if that's less than 7 days away.
          </p>
        )}
        {confirmCancel ? (
          <Cluster gap={3} align="center">
            <span className={textSize.sm}>End the plan? It ends on the first renewal date at least 30 days from today.</span>
            <button type="button" className={button({ variant: "secondary", tint: "danger" })} disabled={busy} onClick={() => send("cancel")}>
              End the plan
            </button>
            <button type="button" className={`${link} ${textSize.xs}`} onClick={() => setConfirmCancel(false)}>
              Keep it
            </button>
          </Cluster>
        ) : (
          <Cluster gap={4} align="center">
            {v.canRequestLevel && !changing && (
              <button type="button" className={`${link} ${textSize.sm}`} disabled={busy} onClick={() => setChanging(true)}>
                {v.levelRequested ? "Ask for a different plan instead" : "Ask for a different plan"}
              </button>
            )}
            {v.canPause && (
              <button type="button" className={`${link} ${textSize.sm}`} disabled={busy} onClick={() => send("pause")}>
                Pause from the next billing date
              </button>
            )}
            {v.canUndoPause && (
              <button type="button" className={`${link} ${textSize.sm}`} disabled={busy} onClick={() => send("undo_pause")}>
                Don't pause
              </button>
            )}
            {v.canRequestResume && (
              <button type="button" className={`${link} ${textSize.sm}`} disabled={busy} onClick={() => send("request_resume")}>
                Ask to resume
              </button>
            )}
            {v.canUpdateBank && (
              <Link to={`/pay/plan/${plan.folderId}?bank=1`} className={`${link} ${textSize.sm}`}>
                Use another bank account
              </Link>
            )}
            {v.canCancel && (
              <button type="button" className={`${link} ${textSize.sm}`} disabled={busy} onClick={() => setConfirmCancel(true)}>
                Cancel
              </button>
            )}
          </Cluster>
        )}
        {error && (
          <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textDanger }}>
            {error}
          </p>
        )}
      </Stack>
    </Surface>
  );
}

export function ProfilePayments({
  charges,
  plans,
  levels,
}: {
  charges: ProfileCharge[];
  plans: ProfilePlan[];
  levels: { value: string; label: string }[];
}) {
  const shown = charges.filter((c) => c.status !== "canceled");
  return (
    <Stack gap={3}>
      <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Payments</h2>
      {plans.map((p) => (
        <PlanCard key={p.folderId} plan={p} levels={levels} />
      ))}
      {shown.length === 0 ? (
        plans.length === 0 && (
          <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textSubtle }}>
            Nothing to pay.
          </p>
        )
      ) : (
        shown.map((c) => (
          <Cluster key={c.id} gap={3} align="baseline">
            <strong>{c.amount}</strong>
            <span>{c.label}</span>
            <span className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
              {c.project}
            </span>
            <Badge>{STATUS[c.status]}</Badge>
            {(c.status === "open" || c.status === "failed") && (
              <Link to={`/pay/${c.id}`} className={`${link} ${textSize.sm}`}>
                Pay →
              </Link>
            )}
          </Cluster>
        ))
      )}
    </Stack>
  );
}
