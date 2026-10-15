/**
 * SĐT người nhận CTV gõ tay ở form lên đơn hộ, cùng luật với máy chủ (apps/api common/phone.ts parseTypedVnPhone): bỏ khoảng
 * trắng, chấm, gạch, ngoặc; nhận 0, +84 hoặc 84 rồi 9 số (số đầu không phải 0); trả 0xxxxxxxxx. Không hợp lệ → null. Dãy 9 số
 * không có 0 đầu bị từ chối như ở máy chủ.
 */
export function parseTypedVnPhone(raw: string): string | null {
  const compact = raw.replace(/[\s.\-()]/g, '');
  const m = /^(?:0|\+?84)([1-9]\d{8})$/.exec(compact);
  return m ? `0${m[1]}` : null;
}
