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
 * Khung ngày của khuyến mãi từ hai ô ngày: bắt đầu = đầu ngày VN (trống thì bây giờ), kết thúc = cuối ngày VN
 * (trống thì bắt đầu + 30 ngày, không phải now + 30 ngày, kẻo chiến dịch bắt đầu muộn có kết thúc trước bắt đầu).
 */
export function vnPromoWindowIso(startKey: string, endKey: string, now = Date.now()): { startAt: string; endAt: string } {
  const startMs = startKey ? Date.parse(vnDayStartIso(startKey)) : now;
  return {
    startAt: new Date(startMs).toISOString(),
    endAt: endKey ? vnDayEndIso(endKey) : new Date(startMs + 30 * 864e5).toISOString(),
  };
}

/**
 * Sai khi kết thúc đứng trước bắt đầu theo NGÀY VN (cho phép cùng một ngày), hoặc chỉ có ngày kết thúc mà cuối ngày đó đã qua
 * (bắt đầu mặc định là bây giờ): nếu không, khuyến mãi chết ngay khi lưu.
 */
export function vnDateRangeInvalid(startKey: string, endKey: string, now = Date.now()): boolean {
  if (!endKey || !DAY_KEY.test(endKey)) return false;
  if (startKey) return endKey < startKey;
  return Date.parse(vnDayEndIso(endKey)) < now;
}
