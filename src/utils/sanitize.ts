export function sanitizeForInlineText(value: string): string {
  return value
    .replace(/`/g, "'")
    .replace(/\|/g, '/')
    .replace(/[\r\n]+/g, ' ');
}

export function sanitizeForInlineCode(value: string): string {
  return value
    .replace(/`/g, "'")
    .replace(/[\r\n]+/g, ' ');
}
