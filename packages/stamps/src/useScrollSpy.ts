// packages/stamps/src/useScrollSpy.ts
//
// Tracks which of a set of element ids is currently the "current" one in
// view, for highlighting the matching link in an anchor-based nav (e.g.
// `DrawerContent`'s drawer, see the Stamps guide's own category nav) as
// the page scrolls. Pure `IntersectionObserver` + DOM ids — no
// react-router dependency, and no assumption about *what* actually
// scrolls: intersection is computed against the browser viewport by
// default, which already correctly accounts for a nested scrolling
// ancestor clipping a section out of view (e.g. `AppLayout`'s own
// `main`), so this works whether the page itself scrolls or a container
// inside it does.
import { useEffect, useState } from "react";

export function useScrollSpy(ids: string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    // Ratio of each section currently inside the observed band (below),
    // keyed by id — recomputed incrementally as sections cross in/out.
    const visibleRatios = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibleRatios.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        // Whichever observed section currently has the most of itself in
        // the band wins; ties break toward the first (topmost) id, so a
        // still-mostly-below-the-fold section never outranks the one
        // you've actually scrolled to.
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const id of ids) {
          const ratio = visibleRatios.get(id) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId) setActiveId(bestId);
      },
      // A thin horizontal band starting 15% down the viewport (not the
      // whole viewport) — a section counts as "current" once it's
      // crossed a line near the top, rather than needing to fill the
      // entire screen (most sections here are taller than one viewport).
      { rootMargin: "-15% 0px -70% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // `ids` is expected to be a stable (module-level or memoized) array —
    // re-created every render would thrash the observer for no reason.
  }, [ids]);

  return activeId;
}
