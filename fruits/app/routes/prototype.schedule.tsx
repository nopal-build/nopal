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
// Date/time only — name/email moved to its own step (`prototype.
// details`). Two ways to pick the same date, kept in sync: a small
// `stamps/MiniCalendar` sidebar (2026-11-02 follow-up: "too big... small
// and to the right of the times... can all live in the same box") and a
// planner-style list grouped by day, each day showing its open time
// slots directly. No backend: on "Next", plan/date/time ride forward as
// search params to `/prototype/details`.
import { useMemo, useRef, useState } from "react";
import type { MetaFunction } from "react-router";
import { useNavigate, useSearchParams } from "react-router";
import { Surface } from "stamps/Surface";
import { Chip } from "stamps/Chip";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { button } from "stamps/button.css";
import { semanticColors } from "stamps/tokens";
import { Stepper } from "stamps/Stepper";
import { MiniCalendar, isSameDay } from "stamps/MiniCalendar";
import { AuthShell } from "../components/AuthShell";
import {
  BackLink,
  FUNNEL_MAX_WIDTH,
  FUNNEL_STEPS,
  ProtoNote,
  TIME_SLOTS,
  availableDates,
  formatDay,
  formatDayHeading,
  funnelQuery,
  monthKey,
  planBySlug,
} from "../components/prototype-onboarding/shared";

export const meta: MetaFunction = () => [{ title: "O.No · Schedule a call" }];

export default function PrototypeSchedule() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const plan = planBySlug(searchParams.get("plan"));

  const [availability] = useState(() => availableDates(10));
  const monthKeys = useMemo(() => Array.from(new Set(availability.map(monthKey))), [availability]);

  const [calendarMonth, setCalendarMonth] = useState(availability[0]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [time, setTime] = useState<string | null>(null);

  const dayRefs = useRef(new Map<string, HTMLDivElement>());

  const canContinue = !!selectedDate && !!time;

  function pickDate(date: Date) {
    setSelectedDate(date);
    const key = date.toDateString();
    requestAnimationFrame(() => {
      dayRefs.current.get(key)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function pickSlot(date: Date, slot: string) {
    setSelectedDate(date);
    setTime(slot);
  }

  function handleNext() {
    if (!canContinue || !selectedDate || !time) return;
    navigate(
      `/prototype/details${funnelQuery({
        plan: plan?.slug,
        date: formatDay(selectedDate),
        time,
      })}`,
    );
  }

  return (
    <AuthShell maxWidth={FUNNEL_MAX_WIDTH}>
      <Stepper steps={FUNNEL_STEPS} currentKey="schedule" />
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
          <div className="proto-schedule-box">
            <div className="proto-schedule-box__planner">
              <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Pick a time</p>
              <div className="proto-planner">
                {availability.map((date) => {
                  const isSelectedDay = !!selectedDate && isSameDay(selectedDate, date);
                  return (
                    <div
                      key={date.toISOString()}
                      ref={(el) => {
                        if (el) dayRefs.current.set(date.toDateString(), el);
                      }}
                      className={`proto-planner__day${isSelectedDay ? " proto-planner__day--selected" : ""}`}
                    >
                      <p className="proto-planner__day-heading">{formatDayHeading(date)}</p>
                      <div className="proto-time-grid">
                        {TIME_SLOTS.map((t) => (
                          <Chip key={t} active={isSelectedDay && time === t} onClick={() => pickSlot(date, t)}>
                            {t}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="proto-schedule-box__calendar">
              <MiniCalendar
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                selected={selectedDate}
                onSelect={pickDate}
                isAvailable={(date) => availability.some((a) => isSameDay(a, date))}
                minMonth={availability[0]}
                maxMonth={availability[availability.length - 1]}
              />
              {monthKeys.length > 1 && (
                <p className={textSize.sm} style={{ color: semanticColors.textSubtle, marginTop: 6 }}>
                  Spans {monthKeys.length} months.
                </p>
              )}
            </div>
          </div>
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
