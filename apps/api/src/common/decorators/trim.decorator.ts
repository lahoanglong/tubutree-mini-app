import { Transform } from 'class-transformer';

/** Cắt khoảng trắng hai đầu chuỗi trước khi kiểm (IsNotEmpty sau Trim chặn chuỗi toàn khoảng trắng). */
export const Trim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
