/**
 * Sinh mã VietQR (chuẩn Napas 247 / EMVCo) phía server — KHÔNG phụ thuộc API ngoài.
 * Mọi app ngân hàng VN quét được; Pancake POS (đã liên kết TK ngân hàng shop) tự đối soát
 * khoản chuyển vào theo nội dung (addInfo = mã đơn) rồi bắn webhook để ta lật đơn PAID.
 */

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) → 4 hex hoa. Dùng cho field 63 của EMVCo QR. */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** TLV: id(2) + length(2, đệm 0) + value. */
function tlv(id: string, value: string): string {
  return id + value.length.toString().padStart(2, '0') + value;
}

export interface VietQrInput {
  bin: string; // mã ngân hàng Napas (6 số), vd Techcombank 970407
  accountNo: string; // số tài khoản nhận
  amount?: number; // số tiền (VND, nguyên) — có thì QR động, không thì QR tĩnh
  addInfo?: string; // nội dung chuyển khoản (ASCII, vd mã đơn) để đối soát
}

export function buildVietQrPayload({ bin, accountNo, amount, addInfo }: VietQrInput): string {
  // Field 38 — Merchant Account Information (Napas).
  const acquirer = tlv('00', bin) + tlv('01', accountNo);
  const merchant = tlv('00', 'A000000727') + tlv('01', acquirer) + tlv('02', 'QRIBFTTA');

  let payload =
    tlv('00', '01') + // Payload Format Indicator
    tlv('01', amount && amount > 0 ? '12' : '11') + // 12 = động (1 lần), 11 = tĩnh
    tlv('38', merchant) +
    tlv('53', '704') + // VND
    (amount && amount > 0 ? tlv('54', String(Math.round(amount))) : '') +
    tlv('58', 'VN');

  if (addInfo) {
    payload += tlv('62', tlv('08', addInfo)); // 62-08 = Purpose of Transaction (nội dung CK)
  }

  // Field 63 (CRC): tính trên toàn chuỗi đã gồm "6304".
  payload += '6304';
  return payload + crc16ccitt(payload);
}
