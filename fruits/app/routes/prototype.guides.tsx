// app/routes/prototype.guides.tsx
//
// Minimal stand-in for the real `/guides` marketing page (that page is
// Vault/OxMarkdown content, `projects/nopal-web/guides.md`, rendered by
// `webapp`'s `_website.$.tsx` — not a React component, so there's
// nothing to reuse code-wise, and rebuilding it faithfully is out of
// scope here). Just enough — the 4 real plans, a "Meet with a Guide"
// button each — to give the funnel below a real starting point instead
// of beginning at an arbitrary URL. See `prototype-onboarding/shared.tsx`
// for the full plan data + its own caveats.
import type { MetaFunction } from "react-router";
import { useNavigate } from "react-router";
import { Surface } from "stamps/Surface";
import { Badge } from "stamps/Badge";
import { Stack } from "stamps/Stack";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { button } from "stamps/button.css";
import { semanticColors } from "stamps/tokens";
import { AuthShell } from "../components/AuthShell";
import { PLANS, funnelQuery } from "../components/prototype-onboarding/shared";

export const meta: MetaFunction = () => [{ title: "O.No · Guides (prototype stand-in)" }];

export default function PrototypeGuides() {
  const navigate = useNavigate();

  return (
    <AuthShell maxWidth="960px">
      <div className={sprinkles({ textAlign: "center", mb: 8 })}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, fontStyle: "italic" }}>
          Prototype stand-in for nopal.build/guides — real plan copy, not a rebuild of that
          page's design.
        </p>
        <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", mt: 2 })}`}>
          Pick a level of help
        </h1>
      </div>
      <div className="proto-plan-grid">
        {PLANS.map((plan) => (
          <Surface key={plan.slug} className="proto-plan-card">
            <Stack gap={1}>
              {plan.comingSoon && <Badge variant="warning">Coming soon</Badge>}
              <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold" })}`}>{plan.name}</h2>
              <p className={`${textSize.xl} ${sprinkles({ fontWeight: "bold" })}`} style={{ color: semanticColors.textBrand }}>
                {plan.price}
              </p>
            </Stack>
            <ul className="proto-plan-card__bullets">
              {plan.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <button
              type="button"
              className={button({ variant: "primary" })}
              onClick={() => navigate(`/prototype/schedule${funnelQuery({ plan: plan.slug })}`)}
            >
              Meet with a Guide
            </button>
          </Surface>
        ))}
      </div>
      <p className={`${textSize.sm} ${sprinkles({ textAlign: "center", mt: 8 })}`} style={{ color: semanticColors.textSubtle }}>
        Or skip straight to{" "}
        <button
          type="button"
          className={button({ variant: "quiet" })}
          onClick={() => navigate("/prototype/schedule")}
        >
          scheduling, no plan selected
        </button>
        .
      </p>
    </AuthShell>
  );
}
