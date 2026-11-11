// app/components/CampMap.tsx
//
// A horizontal, in-sequence strip of every Camp for one anchor (an Org
// or a project to start) — "a place we are headed to," shown at a
// glance. Embedded at the top of `/org` (org.tsx) and the top of a
// project's Newspaper (newspaper.$folderId.tsx). See
// `garden/3-growing/camps-and-log-books.md`.
//
// Presentation-only: callers fetch `camps`/`focusedCampFolderId`
// server-side (via `listCampsForAnchor`/`getFocusedCampFolderId` in
// `camps.server.ts`) in their own loader and pass the already-resolved
// data in — this component never calls `.server` code itself, so it's
// safe in any client-rendered route.
import { Link } from "react-router";
import { Surface } from "stamps/Surface";
import { Badge } from "stamps/Badge";
import { Stack } from "stamps/Stack";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors, colors } from "stamps/tokens";

export type CampMapEntry = {
  folderId: string;
  /** The folder's own name (`camp-1`, `camp-2`, ...) — used only as a
   * fallback label when there's no statement yet. */
  name: string;
  statement: string | null;
  targetArrival: string | null;
  completed: boolean;
};

function formatArrival(date: string | null): string | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function CampMap({
  camps,
  focusedCampFolderId,
  newCampHref,
}: {
  camps: CampMapEntry[];
  focusedCampFolderId: string | null;
  /** Where "+ New Camp" should go (pre-filled with this anchor via a
   * query param) — omit to hide the add action (e.g. a read-only
   * viewer). */
  newCampHref?: string;
}) {
  if (camps.length === 0 && !newCampHref) return null;

  return (
    <div
      className={sprinkles({ display: "flex", gap: 3 })}
      style={{ overflowX: "auto", paddingBottom: 4 }}
    >
      {camps.map((camp, i) => {
        const focused = camp.folderId === focusedCampFolderId;
        const arrival = formatArrival(camp.targetArrival);
        return (
          <Link
            key={camp.folderId}
            to={`/camp/${camp.folderId}`}
            style={{ textDecoration: "none", color: "inherit", flex: "0 0 auto" }}
          >
            <Surface
              hoverable
              className={sprinkles({ p: 3 })}
              style={{
                width: 200,
                borderColor: focused ? colors.purple : undefined,
                borderWidth: focused ? 2 : undefined,
              }}
            >
              <Stack gap={1.5}>
                <div className={sprinkles({ display: "flex" })} style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
                    Camp {i + 1}
                  </span>
                  {camp.completed && <Badge variant="success">Arrived</Badge>}
                </div>
                <p
                  className={`${textSize.sm} ${sprinkles({ m: 0, fontWeight: "bold" })}`}
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {camp.statement?.trim() || camp.name}
                </p>
                {arrival && (
                  <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
                    Target: {arrival}
                  </span>
                )}
              </Stack>
            </Surface>
          </Link>
        );
      })}
      {newCampHref && (
        <Link to={newCampHref} style={{ textDecoration: "none", color: "inherit", flex: "0 0 auto" }}>
          <Surface
            hoverable
            className={sprinkles({ p: 3, display: "flex" })}
            style={{ width: 200, height: "100%", alignItems: "center", justifyContent: "center", minHeight: 76 }}
          >
            <span className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`} style={{ color: semanticColors.textBrand }}>
              + New Camp
            </span>
          </Surface>
        </Link>
      )}
    </div>
  );
}
