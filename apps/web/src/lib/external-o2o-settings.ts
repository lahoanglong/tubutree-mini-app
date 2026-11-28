import type { ConfigRow } from './admin-client';
import { configValue } from './admin-config-forms';
import { DEFAULT_OFF_WARNING, FEATURE_FLAGS, type FeatureFlag } from './admin-feature-flags';

/**
 * Năm khoá của luồng khách mua trên sàn quét thẻ bỏ hộp rồi quay lại mua trên app (W43), gom vào một thẻ ở tab Tích điểm đơn sàn.
 * Ba công tắc dùng chung khoá, nhãn và câu cảnh báo với thẻ Bật/tắt tính năng (thẻ đó giữ nguyên). Hai ô số trùng biên của API
 * (`SystemConfigService.RANGES`); API vẫn kiểm lại.
 */
export const O2O_SWITCH_KEYS = ['loyalty.marketplace_claim_enabled', 'pancake.external_lookup_enabled', 'app.mobile_miniapp_redirect_enabled'] as const;
export type O2oSwitchKey = (typeof O2O_SWITCH_KEYS)[number];

export const O2O_SWITCHES: FeatureFlag[] = O2O_SWITCH_KEYS.map((key) => {
  const flag = FEATURE_FLAGS.find((f) => f.key === key);
  if (!flag) throw new Error(`Thiếu cờ ${key} trong FEATURE_FLAGS`);
  return flag;
});

export const O2O_NUMBER_FIELDS = [
  {
    key: 'loyalty.marketplace_earn_pct',
    label: 'Tỉ lệ tích điểm đơn sàn (%)',
    hint: 'Phần trăm tiền hàng thành Điểm Xanh, từ 0,1 đến 20. Không nhân hệ số hạng.',
    min: 0.1,
    max: 20,
    integer: false,
    fallback: 5,
    unit: '%',
    effect: 'Áp cho mã đơn khách gửi từ lúc lưu. Yêu cầu đã tạo giữ số điểm đã tính.',
  },
  {
    key: 'loyalty.external_pending_days',
    label: 'Số ngày chờ sau khi giao xong',
    hint: 'Đơn giao xong đủ số ngày này mới cộng điểm, từ 1 đến 60. Áp cho cả đơn chốt qua chat.',
    min: 1,
    max: 60,
    integer: true,
    fallback: 14,
    unit: 'ngày',
    effect: 'Áp ngay cho mọi yêu cầu đang chờ cộng, kể cả đơn chốt qua chat: ngày cộng điểm tính lại theo ngày giao cộng số ngày mới.',
  },
] as const;
export type O2oNumberKey = (typeof O2O_NUMBER_FIELDS)[number]['key'];
type NumberField = (typeof O2O_NUMBER_FIELDS)[number];

export interface O2oSettingsForm {
  switches: Record<O2oSwitchKey, boolean>;
  numbers: Record<O2oNumberKey, string>;
}

export interface O2oWrite {
  key: O2oSwitchKey | O2oNumberKey;
  label: string;
  from: boolean | number;
  to: boolean | number;
}

const numberShown = (n: number) => String(n).replace('.', ',');

function currentSwitch(rows: ConfigRow[] | undefined, flag: FeatureFlag): boolean {
  return configValue<unknown>(rows, flag.key, flag.fallback) === true;
}

function currentNumber(rows: ConfigRow[] | undefined, f: NumberField): number {
  const v = configValue<unknown>(rows, f.key, f.fallback);
  return typeof v === 'number' && Number.isFinite(v) ? v : f.fallback;
}

/**
 * Tỉ lệ tích điểm đơn sàn (%) đang cấu hình cho thẻ bỏ hộp. Bảng cấu hình chưa tải được: null (thẻ không in con số). Đã tải mà chưa có dòng:
 * mặc định của API, đúng số API đang cộng.
 */
export function marketplaceEarnPct(rows: ConfigRow[] | undefined): number | null {
  if (!rows) return null;
  const field = O2O_NUMBER_FIELDS.find((f) => f.key === 'loyalty.marketplace_earn_pct');
  return field ? currentNumber(rows, field) : null;
}

export function readO2oSettings(rows: ConfigRow[] | undefined): O2oSettingsForm {
  const switches = {} as O2oSettingsForm['switches'];
  for (const flag of O2O_SWITCHES) switches[flag.key as O2oSwitchKey] = currentSwitch(rows, flag);
  const numbers = {} as O2oSettingsForm['numbers'];
  for (const f of O2O_NUMBER_FIELDS) numbers[f.key] = numberShown(currentNumber(rows, f));
  return { switches, numbers };
}

/** Giá trị khách đọc được trong hộp xác nhận: "Bật", "5%", "14 ngày". */
export function o2oValueText(key: string, v: boolean | number): string {
  if (typeof v === 'boolean') return v ? 'Bật' : 'Tắt';
  const f = O2O_NUMBER_FIELDS.find((x) => x.key === key);
  return f?.unit === '%' ? `${numberShown(v)}%` : `${numberShown(v)} ${f?.unit ?? ''}`.trim();
}

/** Kiểm cả form → các khoá ĐỔI so với giá trị đang áp (khoá chưa có dòng thì so với mặc định), theo thứ tự hiện trên thẻ. */
export function buildO2oWrites(form: O2oSettingsForm, rows: ConfigRow[] | undefined): { writes?: O2oWrite[]; error?: string; field?: O2oNumberKey } {
  const writes: O2oWrite[] = [];
  for (const flag of O2O_SWITCHES) {
    const from = currentSwitch(rows, flag);
    const to = form.switches[flag.key as O2oSwitchKey];
    if (from !== to) writes.push({ key: flag.key as O2oSwitchKey, label: flag.label, from, to });
  }
  for (const f of O2O_NUMBER_FIELDS) {
    const raw = form.numbers[f.key].trim();
    // Chỉ chữ số, số lẻ sau "," hoặc ".": Number() còn nhận "0x10", "1e1". Số ngày là số nguyên nên "1.000" (một nghìn kiểu Việt) bị từ chối.
    // Không giới hạn số chữ số lẻ: giá trị đặt ở tab Cấu hình (vd 0,125) vẫn lưu lại được khi chỉ đổi công tắc.
    const shape = f.integer ? /^\d+$/ : /^\d+(?:[.,]\d+)?$/;
    const n = shape.test(raw) ? Number(raw.replace(',', '.')) : Number.NaN;
    if (!Number.isFinite(n) || n < f.min || n > f.max) {
      return {
        error: `${f.label}: nhập ${f.integer ? 'số nguyên' : 'số'} từ ${numberShown(f.min)} đến ${numberShown(f.max)}.`,
        field: f.key,
      };
    }
    const from = currentNumber(rows, f);
    if (from !== n) writes.push({ key: f.key, label: f.label, from, to: n });
  }
  return { writes };
}

/** Hộp xác nhận: mỗi khoá "nhãn / cũ → mới" kèm hậu quả của đúng thay đổi đó (câu bật/tắt lấy từ thẻ Bật/tắt tính năng). */
export function o2oConfirmMessage(writes: O2oWrite[]): string {
  return writes
    .map((w) => {
      const flag = O2O_SWITCHES.find((f) => f.key === w.key);
      const field = O2O_NUMBER_FIELDS.find((f) => f.key === w.key);
      const effect = flag ? (w.to ? flag.onWarning ?? 'Có hiệu lực ngay.' : flag.offWarning ?? DEFAULT_OFF_WARNING) : field?.effect ?? '';
      return `${w.label}\n${o2oValueText(w.key, w.from)} → ${o2oValueText(w.key, w.to)}\n${effect}`;
    })
    .join('\n\n');
}
