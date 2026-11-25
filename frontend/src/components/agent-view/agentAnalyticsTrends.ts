import type { AgentCount, AgentDailyTrend } from "@/client/types.gen";

const OUTCOME_SERIES_LIMIT = 4;

export const OTHER_OUTCOMES = "other";

export interface CacheRow {
  date: string;
  cacheRate: number | null;
}

export type OutcomeRow = { date: string } & Record<string, number | string>;

export function formatHour(hour: number): string {
  const label = hour % 12 || 12;
  return `${label}${hour < 12 ? "am" : "pm"}`;
}

// A day with no prompt tokens has no rate, which differs from a real 0%.
export function toCacheRows(trends: AgentDailyTrend[]): CacheRow[] {
  return trends.map((row) => ({
    date: row.date,
    cacheRate: row.prompt_tokens ? Math.round((row.cache_read_tokens / row.prompt_tokens) * 100) : null,
  }));
}

// The most common outcomes keep their own series; the rest fold into "other".
export function toOutcomeSeries(outcomes: AgentCount[]): string[] {
  const names = outcomes.slice(0, OUTCOME_SERIES_LIMIT).map((outcome) => outcome.name);
  return outcomes.length > OUTCOME_SERIES_LIMIT ? [...names, OTHER_OUTCOMES] : names;
}

export function toOutcomeRows(trends: AgentDailyTrend[], series: string[]): OutcomeRow[] {
  return trends.map((row) => {
    const counts: OutcomeRow = { date: row.date };
    for (const name of series) counts[name] = 0;
    for (const [name, count] of Object.entries(row.outcomes)) {
      const key = series.includes(name) ? name : OTHER_OUTCOMES;
      counts[key] = Number(counts[key] ?? 0) + count;
    }
    return counts;
  });
}
