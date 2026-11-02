// app/routes/prototype.schedule.tsx
//
// New, in-house scheduling step for the onboarding funnel prototype.
// Flag for Gerald: the REAL system currently keeps Calendly here (see
// `garden/2-ready/intake-creates-project.md`'s "Decided" section — "O.No
// stores nothing about the call"). This page is a forward-looking
// exploration past that decision, built because this prototype's own
// spec (2026-11-02 follow-up) explicitly asked for a real scheduling
// page — not a sign Calendly's already being replaced for real.
//
// No backend: everything here is local state. On "Next", the picked
// plan/date/time/name/email all ride forward as URL search params (see
// `prototype-onboarding/shared.tsx`'s `funnelQuery`) to
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
import { semanticColors } from "stamps/tokens";
import { AuthShell } from "../components/AuthShell";
import {
  FunnelSteps,
  BackLink,
  ProtoNote,
  TIME_SLOTS,
  formatDay,
  funnelQuery,
  planBySlug,
  upcomingWeekdays,
} from "../components/prototype-onboarding/shared";

export const meta: MetaFunction = () => [{ title: "O.No · Schedule a call" }];

export default function PrototypeSchedule() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const plan = planBySlug(searchParams.get("plan"));

  const days = upcomingWeekdays();
  const [dayIdx, setDayIdx] = useState<number | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const canContinue = dayIdx !== null && !!time && name.trim().length > 0 && email.includes("@");

  function handleNext() {
    if (!canContinue || dayIdx === null || !time) return;
    navigate(
      `/prototype/project-setup${funnelQuery({
        plan: plan?.slug,
        date: formatDay(days[dayIdx]),
        time,
        name: name.trim(),
        email: email.trim(),
      })}`,
    );
  }

  return (
    <AuthShell maxWidth="640px">
      <FunnelSteps current="schedule" />
      <BackLink to="/prototype/guides">Back to guide levels</BackLink>
      <Stack gap={6}>
        <Stack gap={1}>
          <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", mt: 4 })}`}>
            Meet with a Guide
          </h1>
          {plan && (
            <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
              Plan selected: <strong>{plan.name}</strong> ({plan.price}) — changeable later.
            </p>
          )}
        </Stack>

        <Surface className={sprinkles({ p: 4 })}>
          <Stack gap={4}>
            <Stack gap={2}>
              <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Pick a day</p>
              <div className="proto-day-grid">
                {days.map((d, i) => (
                  <Chip key={i} active={dayIdx === i} onClick={() => setDayIdx(i)}>
                    {formatDay(d)}
                  </Chip>
                ))}
              </div>
            </Stack>
            {dayIdx !== null && (
              <Stack gap={2}>
                <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Pick a time</p>
                <div className="proto-time-grid">
                  {TIME_SLOTS.map((t) => (
                    <Chip key={t} active={time === t} onClick={() => setTime(t)}>
                      {t}
                    </Chip>
                  ))}
                </div>
              </Stack>
            )}
          </Stack>
        </Surface>

        <Surface className={sprinkles({ p: 4 })}>
          <Stack gap={3}>
            <Input label="Your name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Rivera" />
            <Input label="Email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@example.com" />
          </Stack>
        </Surface>

        <Cluster style={{ justifyContent: "flex-end" }}>
          <button type="button" className={button({ variant: "primary" })} disabled={!canContinue} onClick={handleNext}>
            Next
          </button>
        </Cluster>
        <ProtoNote>
          Real system today: this step is a Calendly link, and O.No learns nothing about the
          booking (see <code>intake-creates-project</code>). This page is an exploration past
          that, not a shipped replacement.
        </ProtoNote>
      </Stack>
    </AuthShell>
  );
}
