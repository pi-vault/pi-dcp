/**
 * Compact token formatting shared by DCP reports and notifications.
 *
 * Below 1,000 the value is truncated to an integer. Otherwise the unit is chosen
 * from the original value, rounded to one decimal, and stripped of a trailing
 * `.0`. Units are never promoted after rounding, so 999,999 renders as `1000k`.
 * Estimates receive a `~` prefix; exact counts stay bare.
 */
export function formatDcpTokens(tokens: number, estimated = false): string {
  const prefix = estimated ? "~" : "";
  if (tokens < 1_000) return `${prefix}${Math.trunc(tokens)}`;
  const unit = tokens < 1_000_000 ? "k" : "M";
  const divisor = unit === "k" ? 1_000 : 1_000_000;
  const value = (tokens / divisor).toFixed(1).replace(/\.0$/, "");
  return `${prefix}${value}${unit}`;
}

/** Collapse whitespace, including CR/LF and tabs, into single spaces and trim. */
export function flattenDcpLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
