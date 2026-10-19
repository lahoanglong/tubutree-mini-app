'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setConfig, type ConfigRow } from '@/lib/admin-client';
import { configValue } from '@/lib/admin-config-forms';
import { formatCount } from '@/lib/checkout-points';
import { formatVnd } from '@/lib/format-vnd';
import { useConfirm } from './confirm-dialog';
import { BTN_XS_PRIMARY, FIELD_CLASS, INPUT_CLASS, Notice } from './ui';

export type WasteConfigField = { key: string; label: string } & (
  | { kind: 'boolean'; fallback: boolean }
  | { kind: 'int'; fallback: number; min: number; max: number }
  | { kind: 'json'; fallback: null }
  | { kind: 'text'; fallback: string; maxLength: number }
);

export const WASTE_CONFIG_FIELDS: readonly WasteConfigField[] = [
  { key: 'waste.enabled', label: 'Bật chương trình với khách', kind: 'boolean', fallback: false },
  { key: 'waste.lane_dropoff_enabled', label: 'Cách Mang tới điểm nhận', kind: 'boolean', fallback: true },
  { key: 'waste.lane_mailin_enabled', label: 'Cách Gửi về kho', kind: 'boolean', fallback: true },
  { key: 'waste.lane_pickup_enabled', label: 'Cách Thu kèm đơn (còn cần cờ Gomdon)', kind: 'boolean', fallback: false },
  { key: 'waste.mailin_min_points', label: 'Gói gửi kho tối thiểu (điểm)', kind: 'int', fallback: 15_000, min: 1, max: 1_000_000 },
  { key: 'waste.pickup_min_points', label: 'Gói thu kèm đơn tối thiểu (điểm)', kind: 'int', fallback: 10_000, min: 1, max: 1_000_000 },
  { key: 'waste.customer_monthly_cap_points', label: 'Trần điểm mỗi khách mỗi tháng', kind: 'int', fallback: 60_000, min: 1, max: 2_000_000 },
  { key: 'waste.max_open_requests', label: 'Số yêu cầu mở cùng lúc', kind: 'int', fallback: 3, min: 1, max: 20 },
  { key: 'waste.request_hold_days', label: 'Số ngày giữ chỗ', kind: 'int', fallback: 7, min: 1, max: 60 },
  { key: 'waste.pickup_wait_days', label: 'Số ngày chờ hàng thu kèm về kho', kind: 'int', fallback: 14, min: 1, max: 90 },
  { key: 'waste.in_transit_review_days', label: 'Số ngày đang gửi trước khi vào danh sách xem lại', kind: 'int', fallback: 30, min: 7, max: 180 },
  { key: 'waste.mailin_max_weight_kg', label: 'Cân nặng tối đa mỗi kiện (kg)', kind: 'int', fallback: 20, min: 1, max: 50 },
  { key: 'waste.mailin_max_edge_cm', label: 'Cạnh dài tối đa mỗi kiện (cm)', kind: 'int', fallback: 50, min: 10, max: 200 },
  { key: 'waste.shortfall_lock_pct', label: 'Phần trăm thiếu tính là một lần thiếu', kind: 'int', fallback: 50, min: 1, max: 100 },
  { key: 'waste.shortfall_lock_streak', label: 'Số lần thiếu liền nhau thì khoá gửi kho', kind: 'int', fallback: 3, min: 2, max: 10 },
  { key: 'waste.staff_daily_cap_points', label: 'Trần điểm mỗi nhân viên xác nhận mỗi ngày', kind: 'int', fallback: 1_000_000, min: 1, max: 20_000_000 },
  { key: 'waste.gift_claim_days', label: 'Hạn nhận quà (ngày)', kind: 'int', fallback: 60, min: 7, max: 365 },
  { key: 'waste.point_inactive_days', label: 'Số ngày không xác nhận thì ẩn điểm đại lý', kind: 'int', fallback: 60, min: 7, max: 365 },
  { key: 'waste.mailin_fee_table', label: 'Bảng ước tính phí ship theo vùng (JSON)', kind: 'json', fallback: null },
  { key: 'waste.alert_thresholds', label: 'Ngưỡng cảnh báo bất thường (JSON)', kind: 'json', fallback: null },
  { key: 'waste.rules_text', label: 'Thể lệ công khai', kind: 'text', fallback: '', maxLength: 8000 },
];

const MAILIN_MIN = 'waste.mailin_min_points';
const PICKUP_MIN = 'waste.pickup_min_points';
const MONTHLY_CAP = 'waste.customer_monthly_cap_points';

type Checked = { error: string | null; value: unknown };

const show = (f: WasteConfigField, v: unknown): string => {
  if (f.kind === 'json') return JSON.stringify(v ?? null, null, 2);
  if (f.kind === 'text') return typeof v === 'string' ? v : '';
  return String(v);
};

function check(f: WasteConfigField, draft: string): Checked {
  if (f.kind === 'int') {
    const n = /^\d+$/.test(draft.trim()) ? Number(draft.trim()) : NaN;
    if (!Number.isSafeInteger(n) || n < f.min || n > f.max) {
      return { error: `Giá trị từ ${formatCount(f.min)} tới ${formatCount(f.max)}`, value: null };
    }
    return { error: null, value: n };
  }
  if (f.kind === 'json') {
    try {
      return { error: null, value: JSON.parse(draft) };
    } catch {
      return { error: 'JSON không hợp lệ', value: null };
    }
  }
  if (f.kind === 'text') {
    return draft.length > f.maxLength
      ? { error: `Thể lệ tối đa ${f.maxLength} ký tự`, value: null }
      : { error: null, value: draft };
  }
  return { error: null, value: draft };
}

/**
 * Cấu hình chung đổi rác: 21 khoá `waste.*` sửa qua PUT /admin/config. Mọi lần lưu hỏi xác nhận "trước → sau"
 * vì trần điểm và gói tối thiểu đổi thẳng số Điểm Xanh phát ra. Giá trị cố định của Điểm Xanh chỉ để xem.
 */
export function WasteConfigCard({ rows, loyaltyRows }: { rows: ConfigRow[] | undefined; loyaltyRows: ConfigRow[] | undefined }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const saved = (f: WasteConfigField): unknown => configValue<unknown>(rows, f.key, f.fallback);

  const write = useMutation({
    mutationFn: async ({ f, next }: { f: WasteConfigField; next: unknown }) => {
      const ok = await confirm({
        title: 'Xác nhận đổi cấu hình đổi rác',
        message: `${f.key}\n${JSON.stringify(saved(f))} → ${JSON.stringify(next)}\n\nÁp dụng ngay cho khách và nhân viên.`,
        confirmLabel: 'Lưu thay đổi',
      });
      if (!ok) return false;
      await setConfig(f.key, next);
      return true;
    },
    onSuccess: (done, { f }) => {
      if (!done) return;
      setMsg({ ok: true, text: `Đã lưu ${f.key}.` });
      void qc.invalidateQueries({ queryKey: ['admin-config'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không lưu được.' }),
  });

  const field = (key: string) => WASTE_CONFIG_FIELDS.find((f) => f.key === key)!;
  const effectiveInt = (key: string): number => {
    const f = field(key);
    const d = drafts[key];
    if (d !== undefined) {
      const c = check(f, d);
      if (!c.error) return c.value as number;
    }
    return saved(f) as number;
  };
  const cap = effectiveInt(MONTHLY_CAP);
  const warning = (key: string): string | null => {
    if (effectiveInt(key) <= cap) return null;
    return key === MAILIN_MIN
      ? 'Gói gửi kho tối thiểu lớn hơn trần điểm tháng: đường gửi kho sẽ đóng với mọi khách.'
      : key === PICKUP_MIN
        ? 'Gói thu kèm đơn tối thiểu lớn hơn trần điểm tháng: đường thu kèm đơn sẽ đóng với mọi khách.'
        : null;
  };

  const perPoint = configValue<number>(loyaltyRows, 'loyalty.vnd_per_point_redeem', 1);
  const expireMonths = configValue<number>(loyaltyRows, 'loyalty.point_expire_months', 12);
  const maxRedeemPct = Math.round(configValue<number>(loyaltyRows, 'loyalty.max_redeem_pct', 0.2) * 100);

  return (
    <section data-waste-config className="space-y-4 rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <h2 className="font-display text-lg font-semibold text-stone-900">Cấu hình chung đổi rác</h2>
      <Notice tone="info">Mọi thay đổi hỏi xác nhận trước khi lưu và áp dụng ngay cho khách và nhân viên.</Notice>

      <div className="space-y-3">
        {WASTE_CONFIG_FIELDS.map((f) => {
          const warn = f.kind === 'int' ? warning(f.key) : null;
          const draft = drafts[f.key];
          const text = draft ?? show(f, saved(f));
          const checked = f.kind === 'boolean' ? { error: null, value: null } : check(f, text);
          const changed =
            f.kind === 'boolean'
              ? false
              : !checked.error && (f.kind === 'text' ? checked.value !== saved(f) : JSON.stringify(checked.value) !== JSON.stringify(saved(f)));
          return (
            <div key={f.key} data-config-key={f.key} className="rounded-control border border-stone-200 p-3">
              <div className="text-sm font-medium text-stone-900">{f.label}</div>
              <div className="break-all text-xs text-stone-500">{f.key}</div>
              {f.kind === 'boolean' ? (
                <label className="mt-1 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm sm:min-h-0">
                  <input
                    type="checkbox"
                    role="switch"
                    className="accent-forest-600"
                    aria-label={f.label}
                    aria-checked={saved(f) === true}
                    checked={saved(f) === true}
                    disabled={write.isPending || !rows}
                    onChange={() => {
                      setMsg(null);
                      write.mutate({ f, next: saved(f) !== true });
                    }}
                  />
                  <span>{saved(f) === true ? 'Đang bật' : 'Đang tắt'}</span>
                </label>
              ) : (
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-start">
                  {f.kind === 'int' ? (
                    <input
                      type="number"
                      inputMode="numeric"
                      aria-label={f.label}
                      className={`${FIELD_CLASS} w-full sm:max-w-xs`}
                      value={text}
                      onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                    />
                  ) : (
                    <textarea
                      aria-label={f.label}
                      rows={f.kind === 'text' ? 6 : 5}
                      className={`${INPUT_CLASS} ${f.kind === 'json' ? 'font-mono text-xs' : ''}`}
                      value={text}
                      onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                    />
                  )}
                  <button
                    type="button"
                    className={BTN_XS_PRIMARY}
                    disabled={write.isPending || !rows || !!checked.error || !changed}
                    onClick={() => {
                      setMsg(null);
                      write.mutate({ f, next: checked.value });
                    }}
                  >
                    Lưu
                  </button>
                </div>
              )}
              {f.kind === 'text' && <div className="mt-1 text-xs text-stone-500">{text.length}/{f.maxLength}</div>}
              {checked.error && <p role="alert" className="mt-1 text-xs text-danger-fg">{checked.error}</p>}
              {warn && <p role="status" className="mt-1 text-xs text-warning-fg">{warn}</p>}
            </div>
          );
        })}
      </div>

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}

      <div className="rounded-control border border-stone-200 bg-stone-50 p-3">
        <h3 className="text-sm font-semibold text-stone-900">Giá trị cố định của Điểm Xanh (chỉ xem)</h3>
        <dl data-points-fixed className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-stone-600">Giá trị một điểm</dt>
            <dd className="text-stone-900">{`1 điểm = ${formatVnd(perPoint)}`}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-600">Thời hạn</dt>
            <dd className="text-stone-900">{`Hạn điểm ${formatCount(expireMonths)} tháng`}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-600">Khi dùng</dt>
            <dd className="text-stone-900">{`Dùng tối đa ${formatCount(maxRedeemPct)}% giá trị đơn`}</dd>
          </div>
        </dl>
      </div>
      {dialog}
    </section>
  );
}
