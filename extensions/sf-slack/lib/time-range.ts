/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Deterministic Slack time-range normalization.
 *
 * Slack exposes two different time syntaxes:
 * - conversations.history uses Unix timestamp strings with six decimals
 * - search uses date operators such as after:YYYY-MM-DD before:YYYY-MM-DD
 *
 * This module keeps that conversion in code so the model only needs to pass a
 * human time expression such as "last week" or "2026-04-13 to 2026-04-20".
 */

export type WeekStart = "monday" | "sunday";
export type CalendarMode = "calendar" | "rolling";
export type ExplicitEndMode = "exclusive" | "inclusive";

export interface SlackTimeRangeInput {
  expression: string;
  timezone?: string;
  week_starts_on?: WeekStart;
  anchor?: string;
  calendar_mode?: CalendarMode;
  explicit_end?: ExplicitEndMode;
}

export interface SlackTimeRangeResult {
  ok: true;
  expression: string;
  timezone: string;
  week_starts_on: WeekStart;
  calendar_mode: CalendarMode;
  anchor_iso: string;
  range: {
    start_iso: string;
    end_iso: string;
    end_exclusive: true;
    oldest: string;
    latest: string;
    duration_seconds: number;
  };
  slack: {
    history: {
      oldest: string;
      latest: string;
    };
    search: {
      after: string;
      before: string;
      query_suffix: string;
    };
    research: {
      since: string;
      before: string;
    };
  };
  notes: string[];
}

interface PlainDate {
  year: number;
  month: number;
  day: number;
}

interface RangeComputation {
  start: Date;
  end: Date;
  kind: "calendar" | "rolling";
  notes: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** Resolve a human time expression into Slack history/search boundaries. */
export function resolveSlackTimeRange(input: SlackTimeRangeInput): SlackTimeRangeResult {
  const expression = input.expression?.trim();
  if (!expression) {
    throw new Error("expression is required");
  }

  const timezone = resolveTimeZone(input.timezone);
  const weekStartsOn = input.week_starts_on === "sunday" ? "sunday" : "monday";
  const calendarMode = input.calendar_mode === "rolling" ? "rolling" : "calendar";
  const anchor = parseAnchor(input.anchor, timezone);
  const anchorDate = plainDateInZone(anchor, timezone);
  const range = computeRange(expression, {
    timezone,
    weekStartsOn,
    anchor,
    anchorDate,
    calendarMode,
    explicitEnd: input.explicit_end === "inclusive" ? "inclusive" : "exclusive",
  });

  if (range.end.getTime() <= range.start.getTime()) {
    throw new Error("Time range end must be after start");
  }

  const oldest = slackTimestamp(range.start);
  const latest = slackTimestamp(range.end);
  const after = formatPlainDate(plainDateInZone(range.start, timezone));
  const beforeDate = searchBeforeDate(range.end, timezone);
  const before = formatPlainDate(beforeDate);
  const notes = [...range.notes];

  if (!isLocalMidnight(range.start, timezone) || !isLocalMidnight(range.end, timezone)) {
    notes.push(
      "Slack search date operators are day-granular, so query_suffix may be broader than the exact oldest/latest timestamps.",
    );
  }

  return {
    ok: true,
    expression,
    timezone,
    week_starts_on: weekStartsOn,
    calendar_mode: calendarMode,
    anchor_iso: formatZonedIso(anchor, timezone),
    range: {
      start_iso: formatZonedIso(range.start, timezone),
      end_iso: formatZonedIso(range.end, timezone),
      end_exclusive: true,
      oldest,
      latest,
      duration_seconds: Math.round((range.end.getTime() - range.start.getTime()) / 1000),
    },
    slack: {
      history: { oldest, latest },
      search: {
        after,
        before,
        query_suffix: `after:${after} before:${before}`,
      },
      research: {
        since: after,
        before,
      },
    },
    notes,
  };
}

function computeRange(
  expression: string,
  context: {
    timezone: string;
    weekStartsOn: WeekStart;
    anchor: Date;
    anchorDate: PlainDate;
    calendarMode: CalendarMode;
    explicitEnd: ExplicitEndMode;
  },
): RangeComputation {
  const normalized = expression.trim().toLowerCase().replace(/\s+/g, " ");
  const explicit = parseExplicitDateRange(normalized, context);
  if (explicit) return explicit;

  const singleDate = parsePlainDate(normalized);
  if (singleDate) {
    return calendarRange(
      singleDate,
      addDays(singleDate, 1),
      context.timezone,
      `Resolved single date ${formatPlainDate(singleDate)} as one local day.`,
    );
  }

  if (normalized === "today") {
    return calendarRange(
      context.anchorDate,
      addDays(context.anchorDate, 1),
      context.timezone,
      "Resolved today as the current local calendar day.",
    );
  }

  if (normalized === "yesterday") {
    const start = addDays(context.anchorDate, -1);
    return calendarRange(
      start,
      context.anchorDate,
      context.timezone,
      "Resolved yesterday as the previous local calendar day.",
    );
  }

  if (normalized === "this week" || normalized === "current week") {
    const start = startOfWeek(context.anchorDate, context.weekStartsOn);
    return calendarRange(
      start,
      addDays(start, 7),
      context.timezone,
      "Resolved this week as the current local calendar week.",
    );
  }

  if (normalized === "last week" || normalized === "previous week") {
    if (context.calendarMode === "rolling") {
      return rollingRange(
        context.anchor,
        7 * MS_PER_DAY,
        "Resolved last week as a rolling 7-day window because calendar_mode=rolling.",
      );
    }
    const currentWeekStart = startOfWeek(context.anchorDate, context.weekStartsOn);
    const start = addDays(currentWeekStart, -7);
    return calendarRange(
      start,
      currentWeekStart,
      context.timezone,
      "Resolved last week as the previous local calendar week.",
    );
  }

  if (normalized === "this month" || normalized === "current month") {
    const start = { year: context.anchorDate.year, month: context.anchorDate.month, day: 1 };
    return calendarRange(
      start,
      addMonths(start, 1),
      context.timezone,
      "Resolved this month as the current local calendar month.",
    );
  }

  if (normalized === "last month" || normalized === "previous month") {
    const currentMonth = { year: context.anchorDate.year, month: context.anchorDate.month, day: 1 };
    const start = addMonths(currentMonth, -1);
    return calendarRange(
      start,
      currentMonth,
      context.timezone,
      "Resolved last month as the previous local calendar month.",
    );
  }

  if (normalized === "this year" || normalized === "current year") {
    const start = { year: context.anchorDate.year, month: 1, day: 1 };
    return calendarRange(
      start,
      { year: context.anchorDate.year + 1, month: 1, day: 1 },
      context.timezone,
      "Resolved this year as the current local calendar year.",
    );
  }

  if (normalized === "last year" || normalized === "previous year") {
    const start = { year: context.anchorDate.year - 1, month: 1, day: 1 };
    const end = { year: context.anchorDate.year, month: 1, day: 1 };
    return calendarRange(
      start,
      end,
      context.timezone,
      "Resolved last year as the previous local calendar year.",
    );
  }

  const rolling = normalized.match(
    /^(?:last|past|previous)\s+(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks)$/,
  );
  if (rolling) {
    const amount = Number(rolling[1]);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Invalid rolling range amount in "${expression}"`);
    }
    const unit = rolling[2];
    const multiplier = unit.startsWith("minute")
      ? MS_PER_MINUTE
      : unit.startsWith("hour")
        ? MS_PER_HOUR
        : unit.startsWith("week")
          ? 7 * MS_PER_DAY
          : MS_PER_DAY;
    return rollingRange(
      context.anchor,
      amount * multiplier,
      `Resolved ${normalized} as a rolling window ending at the anchor time.`,
    );
  }

  throw new Error(
    `Unsupported Slack time expression "${expression}". Examples: today, yesterday, last week, this week, last 7 days, last month, 2026-04-13, 2026-04-13 to 2026-04-20.`,
  );
}

function parseExplicitDateRange(
  normalized: string,
  context: {
    timezone: string;
    explicitEnd: ExplicitEndMode;
  },
): RangeComputation | undefined {
  const match = normalized.match(
    /^(?:from\s+)?(\d{4}-\d{2}-\d{2})\s*(to|until|through|thru|\.\.|\s[-–—]\s)\s*(\d{4}-\d{2}-\d{2})$/,
  );
  if (!match) return undefined;

  const start = parsePlainDate(match[1]);
  const end = parsePlainDate(match[3]);
  if (!start || !end) return undefined;

  const delimiter = match[2].trim();
  const inclusive =
    delimiter === "through" || delimiter === "thru" || context.explicitEnd === "inclusive";
  const exclusiveEnd = inclusive ? addDays(end, 1) : end;
  const note = inclusive
    ? `Resolved explicit date range ${formatPlainDate(start)} through ${formatPlainDate(end)} with an inclusive end date.`
    : `Resolved explicit date range ${formatPlainDate(start)} to ${formatPlainDate(end)} with an exclusive end date.`;
  return calendarRange(start, exclusiveEnd, context.timezone, note);
}

function calendarRange(
  startDate: PlainDate,
  endDateExclusive: PlainDate,
  timezone: string,
  note: string,
): RangeComputation {
  return {
    start: zonedDateTimeToUtc(startDate, timezone),
    end: zonedDateTimeToUtc(endDateExclusive, timezone),
    kind: "calendar",
    notes: [note, "Range end is exclusive."],
  };
}

function rollingRange(end: Date, durationMs: number, note: string): RangeComputation {
  return {
    start: new Date(end.getTime() - durationMs),
    end,
    kind: "rolling",
    notes: [note, "Range end is exclusive."],
  };
}

function parseAnchor(anchor: string | undefined, timezone: string): Date {
  if (!anchor?.trim()) return new Date();
  const trimmed = anchor.trim();
  const dateOnly = parsePlainDate(trimmed);
  if (dateOnly) {
    // Noon avoids ambiguous/nonexistent local midnight in rare timezone transitions
    // while still providing a stable local calendar date for relative periods.
    return zonedDateTimeToUtc(dateOnly, timezone, 12);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid anchor "${anchor}". Use an ISO date or timestamp.`);
  }
  return parsed;
}

function resolveTimeZone(explicit: string | undefined): string {
  const candidate =
    explicit?.trim() ||
    process.env.PI_SLACK_TIMEZONE?.trim() ||
    process.env.TZ?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";

  try {
    getPartsFormatter(candidate).format(new Date());
    return candidate;
  } catch {
    throw new Error(`Invalid IANA timezone "${candidate}". Examples: UTC, America/Los_Angeles.`);
  }
}

function getPartsFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = PART_FORMATTERS.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  PART_FORMATTERS.set(timezone, formatter);
  return formatter;
}

function zonedDateTimeToUtc(date: PlainDate, timezone: string, hour = 0): Date {
  const localMs = Date.UTC(date.year, date.month - 1, date.day, hour, 0, 0, 0);
  let offset = offsetMs(new Date(localMs), timezone);
  let utcMs = localMs - offset;

  const nextOffset = offsetMs(new Date(utcMs), timezone);
  if (nextOffset !== offset) {
    offset = nextOffset;
    utcMs = localMs - offset;
  }

  return new Date(utcMs);
}

function plainDateInZone(date: Date, timezone: string): PlainDate {
  const parts = zonedParts(date, timezone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function isLocalMidnight(date: Date, timezone: string): boolean {
  const parts = zonedParts(date, timezone);
  return parts.hour === 0 && parts.minute === 0 && parts.second === 0;
}

function searchBeforeDate(end: Date, timezone: string): PlainDate {
  const localEndDate = plainDateInZone(end, timezone);
  return isLocalMidnight(end, timezone) ? localEndDate : addDays(localEndDate, 1);
}

function zonedParts(
  date: Date,
  timezone: string,
): PlainDate & { hour: number; minute: number; second: number } {
  const parts = getPartsFormatter(timezone).formatToParts(date);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute" ||
      part.type === "second"
    ) {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function offsetMs(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );
  return localAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function parsePlainDate(value: string): PlainDate | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const roundTrip = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (
    roundTrip.getUTCFullYear() !== date.year ||
    roundTrip.getUTCMonth() + 1 !== date.month ||
    roundTrip.getUTCDate() !== date.day
  ) {
    return undefined;
  }
  return date;
}

function formatPlainDate(date: PlainDate): string {
  const year = String(date.year).padStart(4, "0");
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function slackTimestamp(date: Date): string {
  return (date.getTime() / 1000).toFixed(6);
}

function formatZonedIso(date: Date, timezone: string): string {
  const parts = zonedParts(date, timezone);
  const offsetMinutes = Math.round(offsetMs(date, timezone) / (60 * 1000));
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${formatPlainDate(parts)}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}${offset}`;
}

function addDays(date: PlainDate, days: number): PlainDate {
  return plainDateFromOrdinal(ordinal(date) + days);
}

function addMonths(date: PlainDate, months: number): PlainDate {
  const zeroBased = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  return { year, month, day: 1 };
}

function startOfWeek(date: PlainDate, weekStartsOn: WeekStart): PlainDate {
  const startDay = weekStartsOn === "sunday" ? 0 : 1;
  const diff = (dayOfWeek(date) - startDay + 7) % 7;
  return addDays(date, -diff);
}

function dayOfWeek(date: PlainDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function ordinal(date: PlainDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / MS_PER_DAY);
}

function plainDateFromOrdinal(value: number): PlainDate {
  const date = new Date(value * MS_PER_DAY);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}
