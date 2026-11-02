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
// details`, 2026-11-02 follow-up: "let's make this step by step thing
// more discrete"). Two ways to pick the same date, kept in sync: a
// month calendar (click a day) and a planner-style list grouped by day,
// each day showing its open time slots directly. No backend: on "Next",
// plan/date/time ride forward as search params to `/prototype/details`.
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
import { AuthShell } from "../components/AuthShell";
import {
  FunnelSteps,
  BackLink,
  ProtoNote,
  TIME_SLOTS,
  availableDates,
  formatDay,
  formatDayHeading,
  funnelQuery,
  isSameDay,
  monthKey,
  monthLabel,
  planBySlug,
} from "../components/prototype-onboarding/shared";

export const meta: MetaFunction = () => [{ title: "O.No · Schedule a call" }];

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export default function PrototypeSchedule() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const plan = planBySlug(searchParams.get("plan"));

  const [availability] = useState(() => availableDates(10));
  const monthKeys = useMemo(() => Array.from(new Set(availability.map(monthKey))), [availability]);
  const minMonth = startOfMonth(availability[0]);
  const maxMonth = startOfMonth(availability[availability.length - 1]);

  const [calendarCursor, setCalendarCursor] = useState(() => startOfMonth(availability[0]));
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

  // --- Calendar grid for the currently-displayed month ---
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const cells: (Date | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  const canGoPrev = startOfMonth(addMonths(calendarCursor, -1)) >= minMonth;
  const canGoNext = startOfMonth(addMonths(calendarCursor, 1)) <= maxMonth;

  return (
    <AuthShell maxWidth="760px">
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
          <Stack gap={3}>
            <Cluster style={{ justifyContent: "space-between" }} align="center">
              <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>{monthLabel(calendarCursor)}</p>
              <Cluster gap={1}>
                <button
                  type="button"
                  className={button({ variant: "quiet", size: "compact" })}
                  disabled={!canGoPrev}
                  onClick={() => setCalendarCursor((c) => addMonths(c, -1))}
                  aria-label="Previous month"
                >
                  {"\u2039"}
                </button>
                <button
                  type="button"
                  className={button({ variant: "quiet", size: "compact" })}
                  disabled={!canGoNext}
                  onClick={() => setCalendarCursor((c) => addMonths(c, 1))}
                  aria-label="Next month"
                >
                  {"\u203a"}
                </button>
              </Cluster>
            </Cluster>
            <div className="proto-calendar">
              {WEEKDAY_LABELS.map((w) => (
                <span key={w} className="proto-calendar__weekday">{w}</span>
              ))}
              {cells.map((date, i) => {
                if (!date) return <span key={`blank-${i}`} />;
                const available = availability.some((a) => isSameDay(a, date));
                const selected = !!selectedDate && isSameDay(selectedDate, date);
                return (
                  <button
                    key={date.toISOString()}
                    type="button"
                    className={`proto-calendar__cell${available ? " proto-calendar__cell--available" : ""}${selected ? " proto-calendar__cell--selected" : ""}`}
                    disabled={!available}
                    onClick={() => pickDate(date)}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>
            {monthKeys.length > 1 && (
              <ProtoNote>Open times span {monthKeys.length} months — use {"\u2039"}/{"\u203a"} above to see the rest.</ProtoNote>
            )}
          </Stack>
        </Surface>

        <Surface className={sprinkles({ p: 4 })}>
          <Stack gap={1}>
            <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Or pick straight from the list</p>
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
