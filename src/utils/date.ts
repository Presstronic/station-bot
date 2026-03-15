/**
 * Formats an ISO 8601 timestamp to YYYY-MM-DD for user-facing display.
 * Returns 'n/a' for null/undefined/empty values.
 */
export function toDateString(value: string | null | undefined): string {
  if (!value) return 'n/a';
  return value.slice(0, 10);
}
