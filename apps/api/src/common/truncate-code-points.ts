/** Cắt theo code point (không theo UTF-16): cắt đôi cặp surrogate của emoji để lại ký tự lẻ mà Prisma từ chối. */
export function truncateCodePoints(value: string, max: number): string {
  if (value.length <= max) return value;
  return Array.from(value).slice(0, max).join('');
}
