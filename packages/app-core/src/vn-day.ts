import { vnDayKey } from './waste-copy';

/** Ô `<input type="date">` cho ra 'yyyy-mm-dd' không kèm múi giờ; `new Date('yyyy-mm-dd')` đọc nó là 00:00 UTC (= 07:00 giờ VN), nên mọi mốc phải ghép +07:00 rõ ràng. */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function vnDayStartIso(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00+07:00`).toISOString();
}

export function vnDayEndIso(dayKey: string): string {
  return new Date(`${dayKey}T23:59:59+07:00`).toISOString();
}

/** ISO → ngày giờ Việt Nam 'yyyy-mm-dd'; rỗng hoặc sai định dạng trả chuỗi rỗng. */
export function vnDayKeyOfIso(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : vnDayKey(new Date(t));
}

/**
 * Khung ngày của khuyến mãi từ hai ô ngày: bắt đầu = đầu ngày VN (trống thì bây giờ), kết thúc = cuối ngày VN.
 * Kết thúc trống = cuối ngày VN chứa mốc bắt đầu + 30 ngày − 1 giây (tính từ bắt đầu, không phải từ now, kẻo chiến dịch bắt đầu
 * muộn có kết thúc trước bắt đầu). Luôn rơi vào 23:59:59 nên mở sửa (ô ngày đọc ra đúng ngày đó) rồi lưu lại không kéo dài thêm.
 */
export function vnPromoWindowIso(startKey: string, endKey: string, now = Date.now()): { startAt: string; endAt: string } {
  const startMs = startKey ? Date.parse(vnDayStartIso(startKey)) : now;
  return {
    startAt: new Date(startMs).toISOString(),
    endAt: vnDayEndIso(endKey || vnDayKeyOfIso(new Date(startMs + 30 * 864e5 - 1000).toISOString())),
  };
}

/**
 * Câu lỗi khi kết thúc đứng trước bắt đầu theo NGÀY VN (cùng một ngày thì được), hoặc chỉ có ngày kết thúc mà cuối ngày đó đã qua
 * (bắt đầu mặc định là bây giờ, khuyến mãi sẽ chết ngay khi lưu). Hợp lệ thì null.
 */
export function vnDateRangeError(startKey: string, endKey: string, now = Date.now()): string | null {
  if (!endKey || !DAY_KEY.test(endKey)) return null;
  if (startKey) return endKey < startKey ? 'Ngày kết thúc không được trước ngày bắt đầu.' : null;
  return Date.parse(vnDayEndIso(endKey)) < now ? 'Ngày kết thúc đã qua.' : null;
}

export function vnDateRangeInvalid(startKey: string, endKey: string, now = Date.now()): boolean {
  return vnDateRangeError(startKey, endKey, now) !== null;
}
