// app/components/ProfileBilling.tsx
// The profile's Billing section (payments seed): what this person has
// been asked to pay, across every project, with a link to pay what's
// open. Subscriptions and their buttons join it later in the round.
import { Link } from "react-router";
import { Badge } from "stamps/Badge";
import { Cluster } from "stamps/Cluster";
import { Stack } from "stamps/Stack";
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

const STATUS: Record<ProfileCharge["status"], string> = {
  open: "To pay",
  processing: "Clearing",
  paid: "Paid",
  failed: "Didn't go through",
  canceled: "Withdrawn",
};

export function ProfileBilling({ charges }: { charges: ProfileCharge[] }) {
  const shown = charges.filter((c) => c.status !== "canceled");
  return (
    <Stack gap={3}>
      <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Billing</h2>
      {shown.length === 0 ? (
        <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textSubtle }}>
          Nothing to pay.
        </p>
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
