// app/routes/prototype.project-setup.tsx
//
// Second step of the onboarding funnel prototype: name the project.
// "Generate name" is a deliberately rough placeholder — Gerald flagged
// naming as genuinely hard and unresolved (2026-11-02 follow-up); see
// `generateProjectName` in `prototype-onboarding/shared.tsx` for the
// caveat. On "Next", everything collected so far (plan/date/time/name/
// email) plus the project name rides forward to
// `/prototype/project-setup/hold`.
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
import { semanticColors } from "stamps/tokens";
import { AuthShell } from "../components/AuthShell";
import {
  FunnelSteps,
  BackLink,
  ProtoNote,
  funnelQuery,
  generateProjectName,
  planBySlug,
} from "../components/prototype-onboarding/shared";

export const meta: MetaFunction = () => [{ title: "O.No · Name your project" }];

export default function PrototypeProjectSetup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const plan = planBySlug(searchParams.get("plan"));
  const date = searchParams.get("date");
  const time = searchParams.get("time");
  const name = searchParams.get("name") ?? "";
  const email = searchParams.get("email") ?? "";
  const firstName = name.split(" ")[0];

  const [projectName, setProjectName] = useState("");

  function handleNext() {
    if (!projectName.trim()) return;
    navigate(
      `/prototype/project-setup/hold${funnelQuery({
        plan: plan?.slug,
        date: date ?? undefined,
        time: time ?? undefined,
        name,
        email,
        projectName: projectName.trim(),
      })}`,
    );
  }

  return (
    <AuthShell maxWidth="560px">
      <FunnelSteps current="project-setup" />
      <BackLink to={`/prototype/schedule${funnelQuery({ plan: plan?.slug })}`}>Back</BackLink>
      <Stack gap={6}>
        <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", mt: 4 })}`}>
          Give your project a name
        </h1>

        <Cluster gap={2} wrap>
          {plan && <Chip>{plan.name}</Chip>}
          {date && time && <Chip>{date} at {time}</Chip>}
          {name && <Chip>{name}</Chip>}
        </Cluster>

        <Surface className={sprinkles({ p: 4 })}>
          <Stack gap={3}>
            <Input
              label="Project name"
              name="project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Granite Overlook"
              autoFocus
            />
            <Cluster>
              <button
                type="button"
                className={button({ variant: "outline", size: "compact" })}
                onClick={() => setProjectName(generateProjectName(firstName))}
              >
                {"\u2728"} Generate name
              </button>
            </Cluster>
            <ProtoNote>
              Naming is hard — this generator is a rough first pass (adjective + trail/peak
              word), not a settled design.
            </ProtoNote>
          </Stack>
        </Surface>

        <Cluster style={{ justifyContent: "flex-end" }}>
          <button type="button" className={button({ variant: "primary" })} disabled={!projectName.trim()} onClick={handleNext}>
            Next
          </button>
        </Cluster>
      </Stack>
    </AuthShell>
  );
}
