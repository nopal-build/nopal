/**
 * The Payments tile in the project's banner (payments seed, Austin
 * 2026-11-03): a bill the guide sent shows here, beside the
 * Steep-o-meter, for the project's Clients, only while it is open. A
 * placeholder; the same bills are on the Client's profile, which is
 * where plans live too.
 *
 * Who decides what. A person: the guide raises the bill; the Client pays
 * it. Code: only Clients see the tile, and the pay page checks that
 * again on its own.
 */
import { Link } from "react-router";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export type OpenBill = { id: string; label: string; amount: string; failed: boolean };

export function PaymentsTile({ bills }: { bills: OpenBill[] }) {
  if (bills.length === 0) return null;
  return (
    <Surface data-payments-tile className={sprinkles({ padding: 5 })} style={{ width: "100%", maxWidth: 440, marginLeft: "auto" }}>
      <Stack gap={3}>
        <span className={`${textSize.sm} ${sprinkles({ fontWeight: "semibold" })}`}>To pay</span>
        <ul className={textSize.sm} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {bills.map((b) => (
            <li key={b.id}>
              <strong>{b.amount}</strong> {b.label}
              {b.failed && (
                <span className={textSize.xs} style={{ color: semanticColors.textDanger }}>
                  {" · "}last try didn't go through
                </span>
              )}
              {" · "}
              <Link to={`/pay/${b.id}`} className={link}>
                Pay
              </Link>
            </li>
          ))}
        </ul>
      </Stack>
    </Surface>
  );
}
