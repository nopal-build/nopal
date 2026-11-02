// app/routes/prototype.project-setup.hold.tsx
//
// "This might take longer than 5 seconds" holding page — cycles through
// `PROJECT_SETUP_PHASES` (an easily-edited array; Gerald explicitly
// expects the labels to change later) then auto-redirects to
// `/prototype/seed`. No backend call actually happens — purely a client-
// side timer standing in for the real create-project + notify-guides
// work.
import { useEffect, useState } from "react";
import type { MetaFunction } from "react-router";
import { useNavigate, useSearchParams } from "react-router";
import { Stack } from "stamps/Stack";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { AuthShell } from "../components/AuthShell";
import { PROJECT_SETUP_PHASES, funnelQuery } from "../components/prototype-onboarding/shared";

export const meta: MetaFunction = () => [{ title: "O.No · Setting up your project" }];

const PHASE_DURATION_MS = 1100;

export default function PrototypeProjectSetupHold() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [phaseIdx, setPhaseIdx] = useState(0);

  useEffect(() => {
    if (phaseIdx >= PROJECT_SETUP_PHASES.length - 1) {
      const redirectTimer = setTimeout(() => {
        navigate(
          `/prototype/seed${funnelQuery({
            plan: searchParams.get("plan"),
            date: searchParams.get("date"),
            time: searchParams.get("time"),
            name: searchParams.get("name"),
            email: searchParams.get("email"),
            projectName: searchParams.get("projectName"),
          })}`,
          { replace: true },
        );
      }, PHASE_DURATION_MS);
      return () => clearTimeout(redirectTimer);
    }
    const timer = setTimeout(() => setPhaseIdx((i) => i + 1), PHASE_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseIdx]);

  return (
    <AuthShell maxWidth="480px">
      <div className="proto-hold">
        <div className="proto-hold-spinner" aria-hidden="true" />
        <Stack gap={1} align="center">
          <p className={`${textSize.lg} ${sprinkles({ fontWeight: "bold" })}`}>Setting up your project</p>
          <p className={textSize.sm}>This can take a moment — hang tight.</p>
        </Stack>
        <div className="proto-hold-phases">
          {PROJECT_SETUP_PHASES.map((phase, i) => (
            <span
              key={phase}
              className={`proto-hold-phase${i === phaseIdx ? " proto-hold-phase--current" : i < phaseIdx ? " proto-hold-phase--done" : ""}`}
            >
              {i < phaseIdx ? "\u2713 " : ""}
              {phase}
            </span>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}
