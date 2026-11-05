import { Transform } from 'class-transformer';
import { trimInvisible } from '../text-trim';

/**
 * Cắt khoảng trắng và ký tự vô hình (U+200B, U+FEFF, U+00A0...) ở HAI ĐẦU chuỗi trước khi kiểm: IsNotEmpty/MaxLength sau
 * Trim chặn chuỗi chỉ gồm ký tự hiển thị ra rỗng. Không đụng phần giữa (U+200D nối emoji ghép). Giá trị không phải chuỗi
 * giữ nguyên để IsString báo lỗi.
 *
 * Dành cho chữ tự do khách/admin/đối tác gõ (tên, tiêu đề, mô tả, ghi chú, địa chỉ, ô tìm kiếm, mã giảm giá, MST, SĐT, email).
 * KHÔNG áp cho: mật khẩu, token, secret, chữ ký, OTP thô, payload webhook bên ngoài (Pancake, Zalo, ngân hàng, cổng thanh
 * toán), data URL/base64, id/cuid, enum — các giá trị đó phải đi nguyên văn tới nơi so khớp.
 */
export const Trim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? trimInvisible(value) : value));

/** Như Trim nhưng cho mảng chuỗi: cắt từng phần tử chuỗi, phần tử khác kiểu và giá trị không phải mảng giữ nguyên. */
export const TrimEach = () =>
  Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map((v: unknown) => (typeof v === 'string' ? trimInvisible(v) : v)) : value,
  );
