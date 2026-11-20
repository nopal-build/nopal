// The terms a payment carries, shown above its pay button (payments seed,
// Austin 2026-11-03: "by paying you agree to the contract terms and
// conditions"). The text and its version come from billingTerms.ts.
import { Stack } from "stamps/Stack";
import { Badge } from "stamps/Badge";
import { Cluster } from "stamps/Cluster";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export type PaymentTermsView = { preamble: string; title: string; text: string[]; draft: boolean };

/** "Payment: Payment is due…" → a bold section title and its text. A
 * line with no short title before a colon is all text. */
export function splitSection(line: string): { title: string | null; body: string } {
  const m = line.match(/^([A-Z][A-Za-z ,&]{2,60}): (.+)$/s);
  return m ? { title: m[1], body: m[2] } : { title: null, body: line };
}

export function PaymentTerms({ terms }: { terms: PaymentTermsView }) {
  return (
    <Stack gap={2}>
      <Cluster gap={2} align="baseline">
        <p className={`${textSize.sm} ${sprinkles({ m: 0, fontWeight: "bold" })}`}>{terms.preamble}</p>
        {terms.draft && <Badge>Draft terms</Badge>}
      </Cluster>
      <Stack gap={1}>
        {terms.text.map((line) => {
          const { title, body } = splitSection(line);
          return (
            <p key={line} className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textSubtle }}>
              {title && <strong style={{ color: semanticColors.textPrimary }}>{title}: </strong>}
              {body}
            </p>
          );
        })}
      </Stack>
    </Stack>
  );
}
