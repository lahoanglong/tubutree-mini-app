import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

/**
 * SĐT Việt Nam về dạng nội địa 0xxxxxxxxx (cùng dạng User.phone luôn lưu). Có 4 hàm vì 4 nơi dùng
 * cần mức chặt khác nhau; gộp thành một sẽ đổi hành vi của ít nhất một nơi.
 */

const LOCAL_MOBILE = /^0\d{9}$/;

/**
 * Đích hoàn tiền của đơn hộ cũ chưa có Order.endCustomerKey (đọc SĐT trong snapshot địa chỉ). Chỉ bỏ ký tự không phải số và
 * đổi 84+9 số thành 0+9 số, KHÔNG kiểm độ dài: snapshot cũ có thể lưu cả 0xxxxxxxxx lẫn +84xxxxxxxxx, và nếu bỏ bước 84→0
 * thì một khách thật bị tách thành 2 khoá tuỳ CTV gõ kiểu nào. Đơn hộ mới chuẩn hoá bằng parseTypedVnPhone.
 */
export function toLocalPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const local = digits.replace(/^84(\d{9})$/, '0$1');
  return local || null;
}

/** Số Zalo trả về (thường 84xxxxxxxxx): bỏ ký tự không phải số, thêm 0 đầu nếu thiếu, bắt buộc 0 + 9 số. */
export function normalizeZaloPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return null;
  let formatted = digits;
  if (digits.startsWith('84')) formatted = `0${digits.slice(2)}`;
  else if (!digits.startsWith('0')) formatted = `0${digits}`;
  if (!LOCAL_MOBILE.test(formatted)) return null;
  return formatted;
}

/**
 * Chuỗi nhân viên gõ/quét ở quầy: chỉ nhận `+?<số>`, 84+11 số đổi thành 0+9 số, KHÔNG tự thêm 0 đầu
 * (một dãy 9 số không có 0 đầu có thể là mã thành viên, không được coi là SĐT). Không hợp lệ → null.
 */
export function parseVnPhoneStrict(s: string): string | null {
  const m = /^\+?(\d+)$/.exec(s);
  if (!m) return null;
  let digits = m[1]!;
  if (digits.startsWith('84') && digits.length === 11) digits = `0${digits.slice(2)}`;
  return LOCAL_MOBILE.test(digits) ? digits : null;
}

/**
 * SĐT người dùng gõ tay vào form (người nhận đơn CTV lên hộ): bỏ khoảng trắng, chấm, gạch, ngoặc; nhận 0 + 9 số, +84 + 9 số,
 * 84 + 9 số (số đầu sau mã không phải 0); trả 0xxxxxxxxx. Ký tự khác, thiếu/thừa số → null. KHÔNG tự thêm 0 cho dãy 9 số: so với SĐT của chính CTV phải
 * so đúng một dạng, và dãy 9 số không chắc là SĐT (shipper không gọi được).
 */
export function parseTypedVnPhone(raw: string): string | null {
  const compact = raw.replace(/[\s.\-()]/g, '');
  const m = /^(?:0|\+?84)([1-9]\d{8})$/.exec(compact);
  return m ? `0${m[1]}` : null;
}

export const TYPED_VN_PHONE_MESSAGE = 'Số điện thoại người nhận không hợp lệ (10 số, bắt đầu bằng 0, +84 hoặc 84).';

/** Trường DTO là SĐT gõ tay hợp lệ theo parseTypedVnPhone (giữ nguyên chuỗi; service tự chuẩn hoá khi dùng). */
export function IsTypedVnPhone(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isTypedVnPhone',
      target: object.constructor,
      propertyName,
      options: { message: TYPED_VN_PHONE_MESSAGE, ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && parseTypedVnPhone(v) !== null },
    });
  };
}

/**
 * SĐT hiện cho khách bấm gọi (điểm nhận vỏ): 0 hoặc +84 rồi đúng 9 số, giữ nguyên dạng admin gõ (không chuẩn hoá
 * sang 0xxxxxxxxx) vì nó được in ra màn hình và đưa vào tel:. Dùng chung cho khoá cũ refill.pickup_phone và bảng điểm nhận.
 */
export const PICKUP_PHONE_PATTERN = /^(0|\+84)\d{9}$/;

/**
 * SĐT một điểm nhận vỏ (bảng refill_pickup_locations), rộng hơn khoá cũ vì điểm nhận có thể là cửa hàng dùng số bàn hoặc tổng đài:
 *  - di động: 0 hoặc +84 rồi 9 số (như khoá cũ);
 *  - số bàn: 0 hoặc +84 rồi mã vùng 2xx, tổng 10–11 số kể cả số 0 đầu (02838221234, +842838221234; dạng 10 số trùng nhánh di động);
 *  - tổng đài: 1800 hoặc 1900 rồi 4–6 số (đầu số dịch vụ gọi trong nước, không có dạng +84).
 * Chỉ nhận số liền không dấu cách/chấm/gạch: chuỗi lưu trong DB đúng bằng chuỗi hiện lên nút "Gọi" và đi vào tel:
 * (callPhone ở mini app chỉ bỏ ký tự ngoài số và dấu +, nên giữ nguyên chuỗi này).
 */
export const PICKUP_LOCATION_PHONE_PATTERN = /^(?:(?:0|\+84)\d{9}|(?:0|\+84)2\d{9}|1[89]00\d{4,6})$/;
