// app/routes/prototype.details.tsx
//
// Its own discrete step (split out of `prototype.schedule`, 2026-11-02
// follow-up: "let's make this step by step thing more discrete") — just
// name + email, now that a date/time is already picked. On "Next",
// everything collected so far rides forward as search params to
// `/prototype/project-setup`.
import { useState } from "react";
import type { MetaFunction } from "react-router";
import { useNavigate, useSearchParams } from "react-router";
import { Surface } from "stamps/Surface";
import { Chip } from "stamps/Chip";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import { Input } from "stamps/Input";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { button } from "stamps/button.css";
import { Stepper } from "stamps/Stepper";
import { AuthShell } from "../components/AuthShell";
import { BackLink, FUNNEL_MAX_WIDTH, FUNNEL_STEPS, funnelQuery, planBySlug } from "../components/prototype-onboarding/shared";

export const meta: MetaFunction = () => [{ title: "O.No · Your info" }];

export default function PrototypeDetails() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const plan = planBySlug(searchParams.get("plan"));
  const date = searchParams.get("date");
  const time = searchParams.get("time");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const canContinue = name.trim().length > 0 && email.includes("@");

  function handleNext() {
    if (!canContinue) return;
    navigate(
      `/prototype/project-setup${funnelQuery({
        plan: plan?.slug,
        date: date ?? undefined,
        time: time ?? undefined,
        name: name.trim(),
        email: email.trim(),
      })}`,
    );
  }

  return (
    <AuthShell maxWidth={FUNNEL_MAX_WIDTH}>
      <Stepper steps={FUNNEL_STEPS} currentKey="details" />
      <BackLink to={`/prototype/schedule${funnelQuery({ plan: plan?.slug })}`}>Back</BackLink>
      <Stack gap={6}>
        <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", mt: 4 })}`}>
          Who should we send the invite to?
        </h1>

        <Cluster gap={2} wrap>
          {plan && <Chip>{plan.name}</Chip>}
          {date && time && <Chip>{date} at {time}</Chip>}
        </Cluster>

        <Surface className={sprinkles({ p: 4 })}>
          <Stack gap={3}>
            <Input label="Your name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Rivera" autoFocus />
            <Input label="Email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@example.com" />
          </Stack>
        </Surface>

        <Cluster style={{ justifyContent: "flex-end" }}>
          <button type="button" className={button({ variant: "primary" })} disabled={!canContinue} onClick={handleNext}>
            Next
          </button>
        </Cluster>
      </Stack>
    </AuthShell>
  );
}
