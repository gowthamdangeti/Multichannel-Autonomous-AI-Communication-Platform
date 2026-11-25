import type { AgentPerformanceMetric } from "@/client/types.gen";

// A radar needs three spokes before it encloses any area.
export const MIN_RADAR_AXES = 3;

// Voice agents score from run logs, chat agents from stored replies and
// conversation lengths; both radars read this one label registry. Keys are
// distinct per pipeline where the unit differs (voice `speed` counts responses
// across the pipeline, chat `reply_speed` counts chat replies).
const AXES: Record<string, { label: string; unit: string }> = {
  resolution: { label: "Resolution", unit: "scored calls" },
  speed: { label: "Speed", unit: "responses" },
  kb_recall: { label: "KB Recall", unit: "lookups" },
  tool_accuracy: { label: "Tool Accuracy", unit: "tool calls" },
  context_rate: { label: "Context Rate", unit: "reports" },
  reliability: { label: "Reliability", unit: "calls" },
  engagement: { label: "Engagement", unit: "conversations" },
  depth: { label: "Depth", unit: "conversations" },
  reply_speed: { label: "Speed", unit: "replies" },
};

export interface RadarRow {
  label: string;
  score: number;
  sampleLabel: string;
}

const labelOf = (key: string) => AXES[key]?.label ?? key;

export function toRadarRows(metrics: AgentPerformanceMetric[]): RadarRow[] {
  return metrics.flatMap((metric) =>
    metric.score === null
      ? []
      : [
          {
            label: labelOf(metric.key),
            score: metric.score,
            sampleLabel: `${metric.sample} ${AXES[metric.key]?.unit ?? "samples"}`,
          },
        ],
  );
}

export function toUnmeasuredLabels(metrics: AgentPerformanceMetric[]): string[] {
  return metrics.filter((metric) => metric.score === null).map((metric) => labelOf(metric.key));
}
