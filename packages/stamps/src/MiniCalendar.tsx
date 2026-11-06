// packages/stamps/src/MiniCalendar.tsx
//
// A compact month calendar for picking ONE date — not a date-range
// picker, not a full-page calendar. First built for the project-map
// onboarding funnel prototype's scheduling step
// (fruits/app/routes/prototype.schedule.tsx), which hand-rolled this
// exact grid before being pulled out here. The component only draws
// the grid and handles month navigation; availability is entirely the
// caller's business via `isAvailable`, so this has no opinion about
// what "available" means (business hours, existing bookings, etc.).
import { CircleButton } from "./CircleButton";
import { header, grid, weekday, cell } from "./miniCalendar.css";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export type MiniCalendarProps = {
  /** Any date within the month currently displayed — only its year/month matter. */
  month: Date;
  onMonthChange: (next: Date) => void;
  selected?: Date | null;
  onSelect: (date: Date) => void;
  /** Defaults to "every day is available" — pass this to gray out/disable
   * weekends, past days, days with no open slots, etc. */
  isAvailable?: (date: Date) => boolean;
  /** Prev/next are disabled once they'd leave this month. Omit either
   * for no limit in that direction. */
  minMonth?: Date;
  maxMonth?: Date;
};

export function MiniCalendar({
  month,
  onMonthChange,
  selected = null,
  onSelect,
  isAvailable = () => true,
  minMonth,
  maxMonth,
}: MiniCalendarProps) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const firstWeekday = new Date(year, m, 1).getDay();
  const cells: (Date | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, m, i + 1)),
  ];
  const canGoPrev = !minMonth || startOfMonth(addMonths(month, -1)) >= startOfMonth(minMonth);
  const canGoNext = !maxMonth || startOfMonth(addMonths(month, 1)) <= startOfMonth(maxMonth);

  const monthLabel = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div>
      <div className={header}>
        <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{monthLabel}</span>
        <span style={{ display: "flex", gap: 2 }}>
          <CircleButton size={22} disabled={!canGoPrev} onClick={() => onMonthChange(addMonths(month, -1))} aria-label="Previous month">
            {"\u2039"}
          </CircleButton>
          <CircleButton size={22} disabled={!canGoNext} onClick={() => onMonthChange(addMonths(month, 1))} aria-label="Next month">
            {"\u203a"}
          </CircleButton>
        </span>
      </div>
      <div className={grid}>
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className={weekday}>{w}</span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} />;
          const available = isAvailable(date);
          const isSelected = !!selected && isSameDay(selected, date);
          return (
            <button
              key={date.toISOString()}
              type="button"
              className={cell({ available, selected: isSelected })}
              disabled={!available}
              onClick={() => onSelect(date)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
