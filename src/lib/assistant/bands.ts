/**
 * Confidence bands, shown instead of (or next to) a bare percentage so people can tell at a
 * glance how sure the Assistant is. Findings below 0.5 are never reported.
 */
export type ConfidenceBand = "clear" | "likely" | "possible";

export const CONFIDENCE_BANDS: Record<ConfidenceBand, { label: string; explanation: string; min: number }> = {
  clear: {
    label: "Clear",
    min: 0.85,
    explanation: "Shown directly by the board, like an empty note or two items on top of each other.",
  },
  likely: {
    label: "Likely",
    min: 0.65,
    explanation: "Strongly suggested by the wording or layout, but worth a quick check.",
  },
  possible: {
    label: "Possible",
    min: 0.5,
    explanation: "A pattern worth a look. It may be fine as it is.",
  },
};

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_BANDS.clear.min) return "clear";
  if (confidence >= CONFIDENCE_BANDS.likely.min) return "likely";
  return "possible";
}
