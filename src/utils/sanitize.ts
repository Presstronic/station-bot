export function sanitizeForInlineText(value: string): string {
  return value
    .replace(/`/g, "'")
    .replace(/\|/g, '/')
    .replace(/[\r\n]+/g, ' ');
}
