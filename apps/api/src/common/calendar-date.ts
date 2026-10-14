import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

/** "YYYY-MM-DD" là ngày có thật: new Date() tự dồn 2026-02-31 sang 03/03 mà không báo lỗi. */
export function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function IsCalendarDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} phải là ngày có thật dạng YYYY-MM-DD.`, ...options },
      validator: { validate: isCalendarDate },
    });
  };
}
