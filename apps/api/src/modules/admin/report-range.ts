import { BadRequestException } from '@nestjs/common';
import { VN_OFFSET_MS, vnDateKey } from '../../common/vn-time';

export const REPORT_DEFAULT_DAYS = 30;
const DAY_MS = 24 * 3_600_000;

export interface ReportRange {
  /** 'YYYY-MM-DD' giờ VN, tính cả hai đầu. */
  from: string;
  to: string;
  days: number;
  /** [start, end): 00:00 giờ VN của `from` tới 00:00 giờ VN của ngày sau `to`. */
  start: Date;
  end: Date;
}

const keyToMs = (key: string) => Date.parse(`${key}T00:00:00.000Z`);
const msToKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Khoảng ngày của báo cáo theo lịch giờ VN. Thiếu `to` thì lấy hôm nay, thiếu `from` thì lùi 30 ngày từ `to` (cả hai đầu
 * tính). Giới hạn `maxDays` chặn truy vấn quét cả bảng đơn.
 */
export function resolveReportRange(
  from: string | undefined,
  to: string | undefined,
  opts: { maxDays: number; now?: Date; defaultDays?: number },
): ReportRange {
  const defaultDays = opts.defaultDays ?? REPORT_DEFAULT_DAYS;
  const toKey = to ?? vnDateKey(opts.now);
  const fromKey = from ?? msToKey(keyToMs(toKey) - (defaultDays - 1) * DAY_MS);
  const days = Math.round((keyToMs(toKey) - keyToMs(fromKey)) / DAY_MS) + 1;
  if (days < 1) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
  if (days > opts.maxDays) throw new BadRequestException(`Khoảng ngày tối đa ${opts.maxDays} ngày.`);
  return {
    from: fromKey,
    to: toKey,
    days,
    start: new Date(keyToMs(fromKey) - VN_OFFSET_MS),
    end: new Date(keyToMs(toKey) + DAY_MS - VN_OFFSET_MS),
  };
}
