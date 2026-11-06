// packages/stamps/src/Stepper.tsx
//
// A thin horizontal progress strip for a multi-page wizard/funnel —
// e.g. "Schedule → Your info → Name it → Setting up → Your project".
// Purely presentational: it doesn't navigate anywhere itself (steps
// aren't clickable links — most funnels this fits don't let you skip
// ahead), just shows where you are. First built for the project-map
// onboarding funnel prototype (fruits/app/routes/prototype.*.tsx),
// which previously hand-rolled an identical `FunnelSteps` component.
import { list, item } from "./stepper.css";

export type StepperStep = { key: string; label: string };

export function Stepper({ steps, currentKey }: { steps: StepperStep[]; currentKey: string }) {
  const currentIndex = steps.findIndex((s) => s.key === currentKey);
  return (
    <div className={list} aria-hidden="true">
      {steps.map((step, i) => (
        <span key={step.key} className={item({ state: i === currentIndex ? "current" : i < currentIndex ? "done" : "upcoming" })}>
          {step.label}
        </span>
      ))}
    </div>
  );
}
