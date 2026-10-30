/** Buyer-report reasons, shared by the report form and the admin queue. */
export const REPORT_REASONS = [
  { value: "prohibited", label: "Prohibited item" },
  { value: "misleading", label: "Misleading photos or description" },
  { value: "counterfeit", label: "Counterfeit or fake" },
  { value: "spam", label: "Spam or duplicate listing" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

export function reportReasonLabel(value: string): string {
  return REPORT_REASONS.find((reason) => reason.value === value)?.label ?? value;
}
