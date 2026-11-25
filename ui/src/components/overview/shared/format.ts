/** Formatting shared by every channel of the overview page. */

export const titleCase = (value: string) =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

export const fmtPercent = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${Math.round(value)}%`;

export const fmtNumber = (value: number) => value.toLocaleString("en");

export function fmtMinutes(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours).toLocaleString("en")} h`;
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function fmtRelative(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "Never";
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "Just now";
}

/** Percent change against the previous period; null when there is nothing to compare. */
export function percentDelta(current: number, previous: number | null | undefined) {
  if (previous === null || previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Headline under a volume KPI, e.g. "Up 12% on the period before". */
export function deltaHeadline(delta: number | null, hasPrevious: boolean) {
  if (!hasPrevious) return "Since the first recorded activity";
  if (delta === null) return "Nothing the period before";
  if (delta > 0) return `Up ${delta}% on the period before`;
  if (delta < 0) return `Down ${Math.abs(delta)}% on the period before`;
  return "Level with the period before";
}

/** Relabel and merge counts that share a label, busiest first. */
export function mergeCounts<T>(rows: T[], label: (row: T) => string, value: (row: T) => number) {
  const merged = new Map<string, number>();
  for (const row of rows) {
    const name = label(row);
    merged.set(name, (merged.get(name) ?? 0) + value(row));
  }
  return [...merged].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
