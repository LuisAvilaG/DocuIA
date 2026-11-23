// Day, week and month boundaries in a client's time zone. The server runs in
// UTC, so "today" taken from its own clock starts in the afternoon for a
// client in Mexico or Colombia.

const FALLBACK_ZONE = "America/Mexico_City";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HALF_DAY_MS = 12 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

/** The zone itself when the runtime knows it, otherwise the default one. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return FALLBACK_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_ZONE;
  }
}

function wallClock(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", weekday: "short", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    day: Number(get("day")), hour: Number(get("hour")), minute: Number(get("minute")), second: Number(get("second")),
    weekday: Math.max(0, WEEKDAYS.indexOf(get("weekday"))), // 0 = Monday
  };
}

/** Midnight of the current day in the zone, as an instant. */
export function startOfDayIn(timeZone: string, now = new Date()): Date {
  const c = wallClock(now, timeZone);
  const start = new Date(now.getTime() - ((c.hour * 60 + c.minute) * 60 + c.second) * 1000 - now.getMilliseconds());
  // On the day the clocks change, the wall-clock time since midnight is an hour
  // more or less than the time elapsed: what the result reads there says by how much.
  const at = wallClock(start, timeZone);
  const off = (at.hour * 60 + at.minute) * 60_000;
  return off === 0 ? start : new Date(start.getTime() + (off > HALF_DAY_MS ? DAY_MS - off : -off));
}

// Going back whole days can land an hour off across a clock change; taking the
// midnight of the day that noon falls in corrects it.
function midnightDaysBefore(timeZone: string, from: Date, days: number): Date {
  return startOfDayIn(timeZone, new Date(from.getTime() - days * DAY_MS + HALF_DAY_MS));
}

/** Monday 00:00 of the current week in the zone. */
export function startOfWeekIn(timeZone: string, now = new Date()): Date {
  return midnightDaysBefore(timeZone, startOfDayIn(timeZone, now), wallClock(now, timeZone).weekday);
}

/** The 1st at 00:00 of the current month in the zone. */
export function startOfMonthIn(timeZone: string, now = new Date()): Date {
  return midnightDaysBefore(timeZone, startOfDayIn(timeZone, now), wallClock(now, timeZone).day - 1);
}

/**
 * The zone's wall-clock time as a Date in this process's own zone, for code
 * that compares against dates built with `new Date(year, month, day)`.
 */
export function wallClockIn(timeZone: string, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** Day of the week in the zone, 0 = Monday. */
export function weekdayIn(timeZone: string, now = new Date()): number {
  return wallClock(now, timeZone).weekday;
}

/** The calendar day in the zone, as YYYY-MM-DD. */
export function dayIn(timeZone: string, now = new Date()): string {
  const at = wallClockIn(timeZone, now);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}
