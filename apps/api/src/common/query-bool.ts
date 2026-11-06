/** Query string luôn là chuỗi: 'true'/'1' → true, 'false'/'0' → false; giá trị khác để IsBoolean từ chối. */
export function toQueryBool({ value }: { value: unknown }): unknown {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}
