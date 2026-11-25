/**
 * Đọc chuỗi QR EMVCo/VietQR (Napas 247) để kiểm mã chuyển khoản mà API trả: tách TLV, đọc thẻ 38 (BIN + số tài khoản), 54 (số tiền),
 * 62.08 (nội dung chuyển khoản = mã đơn) và kiểm CRC16 ở thẻ 63.
 * Viết lại độc lập với `apps/api/src/modules/integrations/payment/vietqr.ts`: test so hai bên với nhau, nên một lỗi chung (sai đa thức,
 * sai độ dài) không thể làm cả hai cùng xanh.
 */

export interface Tlv {
  id: string;
  value: string;
}

/** Tách một dãy TLV (id 2 chữ số, độ dài 2 chữ số, giá trị). Ném lỗi khi độ dài vượt chuỗi hay trường cụt. */
export function parseTlv(payload: string): Tlv[] {
  const out: Tlv[] = [];
  let i = 0;
  while (i < payload.length) {
    if (i + 4 > payload.length) throw new Error(`TLV cụt ở vị trí ${i}: "${payload.slice(i)}"`);
    const id = payload.slice(i, i + 2);
    const lenText = payload.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lenText)) throw new Error(`TLV sai khuôn ở vị trí ${i}`);
    const len = Number(lenText);
    const value = payload.slice(i + 4, i + 4 + len);
    if (value.length !== len) throw new Error(`Trường ${id} khai ${len} ký tự nhưng chỉ còn ${value.length}`);
    out.push({ id, value });
    i += 4 + len;
  }
  return out;
}

const tagOf = (list: Tlv[], id: string): string | undefined => list.find((t) => t.id === id)?.value;

/** CRC-16/CCITT-FALSE (đa thức 0x1021, khởi tạo 0xFFFF, không đảo bit, không XOR cuối) dùng bảng 256 phần tử. */
const CRC_TABLE: number[] = Array.from({ length: 256 }, (_, n) => {
  let c = n << 8;
  for (let k = 0; k < 8; k++) c = (c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1) & 0xffff;
  return c;
});

export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) crc = ((crc << 8) ^ CRC_TABLE[((crc >> 8) ^ byte) & 0xff]!) & 0xffff;
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface VietQr {
  /** 11 = QR tĩnh, 12 = QR động (có số tiền). */
  pointOfInitiation: string | undefined;
  guid: string | undefined;
  bin: string | undefined;
  accountNo: string | undefined;
  service: string | undefined;
  currency: string | undefined;
  amount: string | undefined;
  country: string | undefined;
  purpose: string | undefined;
  crc: string | undefined;
  /** CRC tính lại trên toàn chuỗi tới hết "6304". */
  crcExpected: string;
  crcValid: boolean;
}

/** Giải chuỗi VietQR; CRC luôn là 4 ký tự cuối (thẻ 63 phải đứng cuối). */
export function decodeVietQr(payload: string): VietQr {
  const top = parseTlv(payload);
  if (top.at(-1)?.id !== '63') throw new Error('Thẻ 63 (CRC) phải đứng cuối chuỗi QR');
  const merchant = parseTlv(tagOf(top, '38') ?? '');
  const acquirer = parseTlv(tagOf(merchant, '01') ?? '');
  const extra = tagOf(top, '62');
  const crcExpected = crc16(payload.slice(0, -4));
  const crc = tagOf(top, '63');
  return {
    pointOfInitiation: tagOf(top, '01'),
    guid: tagOf(merchant, '00'),
    bin: tagOf(acquirer, '00'),
    accountNo: tagOf(acquirer, '01'),
    service: tagOf(merchant, '02'),
    currency: tagOf(top, '53'),
    amount: tagOf(top, '54'),
    country: tagOf(top, '58'),
    purpose: extra === undefined ? undefined : tagOf(parseTlv(extra), '08'),
    crc,
    crcExpected,
    crcValid: crc === crcExpected,
  };
}
