// packages/stamps/src/ErrorPanel.tsx
//
// Shared "access denied" / "something went wrong" card for route
// `ErrorBoundary`s — before this, every `maker_.*` route (see e.g.
// fruits/app/routes/maker_.scripts.tsx, maker_.graphlog.tsx) hand-rolled
// the identical Surface + Badge + heading + back-link block.
//
// Takes its back-link as a slot (`action`), not a fixed `<a>`/`<Link>` —
// same reasoning as `MoreMenu`'s trigger render prop: this package has no
// react-router dependency, so callers bring their own `<Link>` (styled
// with `link` from `./link.css`).
import type { ReactNode } from "react";
import { Badge } from "./Badge";
import { Surface } from "./Surface";
import { sprinkles } from "./sprinkles.css";
import { textSize } from "./typography.css";
import { semanticColors } from "./tokens";

type ErrorPanelProps = {
  /** HTTP status to show as a danger badge (403, 500, …) — omit for
   * errors that aren't a `Response` (e.g. a thrown JS `Error`). */
  status?: number;
  title: string;
  message: ReactNode;
  /** Caller-supplied back link, e.g.
   * `<Link to="/maker" className={\`${link} ${textSize.sm}\`}>← Back to Maker</Link>`. */
  action?: ReactNode;
};

export function ErrorPanel({ status, title, message, action }: ErrorPanelProps) {
  return (
    <Surface
      className={sprinkles({
        display: "flex",
        flexDirection: "column",
        gap: 3,
        p: 6,
      })}
    >
      {status != null && <Badge variant="danger">{status}</Badge>}
      <h1
        className={`${textSize.xl} ${sprinkles({ fontWeight: "bold" })}`}
        style={{ margin: 0, color: semanticColors.textPrimary }}
      >
        {title}
      </h1>
      <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textSubtle }}>
        {message}
      </p>
      {action}
    </Surface>
  );
}
