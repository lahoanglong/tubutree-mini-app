'use client';

import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatVnNumber } from '@tubutree/app-core/number-format';
import { setConfig, type ConfigRow } from '@/lib/admin-client';
import { actionErrorText } from '@/lib/admin-error-text';
import { DEFAULT_OFF_WARNING } from '@/lib/admin-feature-flags';
import { useConfirm } from '@/components/admin/confirm-dialog';
import { BTN_LINK, BTN_XS_PRIMARY, FIELD_XS, Notice, ToneBadge } from '@/components/admin/ui';
import {
  checkinWeekTotal,
  choiceValue,
  findRow,
  formatStored,
  numberValue,
  parseInput,
  switchOn,
  toInput,
  type GrowthCheckin,
  type GrowthChoice,
  type GrowthGroup,
  type GrowthNumber,
  type GrowthSwitch,
} from './growth-controls';

type Confirm = ReturnType<typeof useConfirm>['confirm'];

/** Một lần ghi khoá cấu hình; xong thì nạp lại cả bảng cấu hình (thẻ Bật/tắt tính năng ở tab Cấu hình dùng chung truy vấn). */
function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => setConfig(key, value),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-config'] }),
  });
}

function RowStatus({ text, ok }: { text: string | null; ok: boolean }) {
  if (!text) return null;
  return ok ? (
    <p role="status" className="mt-1 text-xs text-success-fg">{text}</p>
  ) : (
    <div className="mt-1.5"><Notice tone="danger" role="alert">{text}</Notice></div>
  );
}

function SwitchRow({ item, rows, confirm }: { item: GrowthSwitch; rows: ConfigRow[] | undefined; confirm: Confirm }) {
  const save = useSaveConfig();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const missing = !!rows && item.needsRow === true && !findRow(rows, item.key);
  const on = switchOn(rows, item);
  const master = item.requires ? findRow(rows, item.requires) : undefined;
  const masterOff = !!item.requires && !!rows && !(master?.value === true || master?.value === 'true');

  const ask = async () => {
    const next = !on;
    const ok = await confirm({
      title: next ? `Bật "${item.label}"?` : `Tắt "${item.label}"?`,
      message: `${item.description}\n\n${next ? item.onWarning ?? 'Có hiệu lực với khách ngay.' : item.offWarning ?? DEFAULT_OFF_WARNING}`,
      confirmLabel: next ? 'Bật' : 'Tắt',
      tone: next ? 'default' : 'danger',
    });
    if (!ok) return;
    setMsg(null);
    save.mutate(
      { key: item.key, value: next },
      {
        onSuccess: () => setMsg({ ok: true, text: next ? 'Đã bật.' : 'Đã tắt.' }),
        onError: (e) => setMsg({ ok: false, text: actionErrorText(e) }),
      },
    );
  };

  return (
    <li data-growth-key={item.key} className="flex items-start gap-3 py-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={item.label}
        disabled={!rows || missing || save.isPending}
        onClick={() => void ask()}
        className="mt-0.5 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center disabled:cursor-not-allowed sm:min-h-[36px] sm:min-w-[36px]"
      >
        <span className={`relative inline-block h-6 w-11 rounded-full transition-colors ${on ? 'bg-forest-600' : 'bg-stone-400'} ${save.isPending || missing ? 'opacity-60' : ''}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-stone-0 transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-stone-900">{item.label}</p>
          {missing ? (
            <ToneBadge tone="neutral">Chưa có trên hệ thống</ToneBadge>
          ) : (
            <ToneBadge tone={on ? 'success' : 'neutral'}>{on ? 'Đang bật' : 'Đang tắt'}</ToneBadge>
          )}
          {on && masterOff && !missing && <ToneBadge tone="warning">Chờ công tắc chung</ToneBadge>}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-stone-600">{item.description}</p>
        {missing && <p className="mt-0.5 text-xs text-stone-600">Công tắc mở được khi tính năng này lên máy chủ.</p>}
        <RowStatus text={msg?.text ?? null} ok={msg?.ok ?? true} />
      </div>
    </li>
  );
}

function NumberRow({ item, rows, confirm }: { item: GrowthNumber; rows: ConfigRow[] | undefined; confirm: Confirm }) {
  const save = useSaveConfig();
  const hintId = useId();
  const stored = numberValue(rows, item);
  const missing = !!rows && item.needsRow === true && !findRow(rows, item.key);
  const [draft, setDraft] = useState(() => toInput(item, stored));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Giá trị đang lưu đổi (tải xong, vừa lưu, admin khác vừa đổi) thì ô nhập nạp số mới; giữ nguyên dòng "Đã lưu".
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setDraft(toInput(item, stored));
  }
  const parsed = parseInput(item, draft);
  const changed = parsed.value !== undefined && parsed.value !== stored;
  const offStandard = !missing && item.standard !== undefined && stored !== null && stored !== item.standard;

  const ask = async () => {
    const p = parseInput(item, draft);
    if (p.value === undefined) return setMsg({ ok: false, text: p.error ?? 'Giá trị không hợp lệ.' });
    const before = stored === null ? 'giá trị hỏng' : formatStored(item, stored);
    const ok = await confirm({
      title: 'Xác nhận đổi cấu hình',
      message: `${item.label}\n${before} → ${formatStored(item, p.value)}\n\nÁp dụng ngay cho mọi khách.`,
      confirmLabel: 'Lưu thay đổi',
    });
    if (!ok) return;
    setMsg(null);
    save.mutate(
      { key: item.key, value: p.value },
      {
        onSuccess: () => setMsg({ ok: true, text: 'Đã lưu.' }),
        onError: (e) => setMsg({ ok: false, text: actionErrorText(e) }),
      },
    );
  };

  return (
    <li data-growth-key={item.key} className="py-3">
      <form
        className="flex flex-wrap items-start gap-x-3 gap-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-medium text-stone-900">{item.label}</p>
            {missing && <ToneBadge tone="neutral">Chưa có trên hệ thống</ToneBadge>}
            {offStandard && <ToneBadge tone="warning">Khác mức chuẩn {formatStored(item, item.standard!)}</ToneBadge>}
          </div>
          <p id={hintId} className="mt-0.5 text-xs leading-relaxed text-stone-600">
            {item.hint}
            {!missing && stored !== null && ` Đang chạy: ${formatStored(item, stored)}.`}
            {!missing && stored === null && ' Giá trị đang lưu không phải số; máy chủ đang dùng mức an toàn của nó.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-stone-600">
            <input
              aria-label={item.label}
              aria-describedby={hintId}
              inputMode={item.percent ? 'decimal' : 'numeric'}
              className={`${FIELD_XS} w-28 text-right tabular-nums`}
              value={draft}
              onChange={(e) => {
                setMsg(null);
                setDraft(e.target.value);
              }}
              disabled={!rows || missing || save.isPending}
            />
            <span aria-hidden="true">{item.unit}</span>
          </label>
          <button type="submit" disabled={!rows || missing || save.isPending || !changed} className={BTN_XS_PRIMARY}>
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </form>
      {offStandard && (
        <button type="button" className={`${BTN_LINK} mt-1 text-xs`} onClick={() => setDraft(toInput(item, item.standard!))} disabled={save.isPending}>
          Điền mức chuẩn {formatStored(item, item.standard!)}
        </button>
      )}
      {draft !== '' && parsed.error && !msg && <p className="mt-1 text-xs text-danger-fg">{parsed.error}</p>}
      <RowStatus text={msg?.text ?? null} ok={msg?.ok ?? true} />
    </li>
  );
}

function CheckinRow({ item, rows, onOpenConfig }: { item: GrowthCheckin; rows: ConfigRow[] | undefined; onOpenConfig?: () => void }) {
  const total = checkinWeekTotal(rows);
  return (
    <li data-growth-key={item.key} className="flex items-start gap-3 py-3">
      <span aria-hidden="true" className="mt-0.5 inline-block h-6 w-11 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-stone-900">{item.label}</p>
          <ToneBadge tone="success">Luôn bật</ToneBadge>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-stone-600">
          Nút điểm danh ở Vườn Xanh cộng 💧 và Điểm Xanh theo bảng 7 ngày
          {total !== null ? `, hiện tổng ${formatVnNumber(total)} Điểm Xanh mỗi tuần cho mỗi khách.` : '.'} Muốn ngừng cộng điểm thì đặt cả 7 ô về 0.
        </p>
        {onOpenConfig && (
          <button type="button" onClick={onOpenConfig} className={`${BTN_LINK} mt-1 text-xs`}>
            Sửa bảng điểm 7 ngày ở Cấu hình
          </button>
        )}
      </div>
    </li>
  );
}

/** Chọn một trong vài giá trị (giao diện theo mùa): nhóm nút radio, bấm nút khác giá trị đang chạy thì hỏi xác nhận rồi ghi. */
function ChoiceRow({ item, rows, confirm }: { item: GrowthChoice; rows: ConfigRow[] | undefined; confirm: Confirm }) {
  const save = useSaveConfig();
  const labelId = useId();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const current = choiceValue(rows, item);
  const currentLabel = item.options.find((o) => o.value === current)?.label ?? current;

  const pick = async (value: string) => {
    if (value === current) return;
    const opt = item.options.find((o) => o.value === value)!;
    const ok = await confirm({
      title: `Đổi sang "${opt.label}"?`,
      message: `${item.label}\n${currentLabel} → ${opt.label}\n\n${opt.hint}`,
      confirmLabel: 'Đổi giao diện',
    });
    if (!ok) return;
    setMsg(null);
    save.mutate(
      { key: item.key, value },
      {
        onSuccess: () => setMsg({ ok: true, text: `Đã đổi sang ${opt.label}.` }),
        onError: (e) => setMsg({ ok: false, text: actionErrorText(e) }),
      },
    );
  };

  return (
    <li data-growth-key={item.key} className="py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p id={labelId} className="text-sm font-medium text-stone-900">{item.label}</p>
        <ToneBadge tone={current === item.fallback ? 'neutral' : 'success'}>Đang chạy: {currentLabel}</ToneBadge>
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-stone-600">{item.description}</p>
      <div role="radiogroup" aria-labelledby={labelId} className="mt-2 flex flex-wrap gap-2">
        {item.options.map((o) => {
          const on = o.value === current;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-choice={o.value}
              disabled={!rows || save.isPending}
              onClick={() => void pick(o.value)}
              title={o.hint}
              className={`min-h-[44px] rounded-control border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[36px] ${on ? 'border-forest-600 bg-forest-600 text-stone-0' : 'border-stone-450 bg-stone-0 text-stone-900 hover:border-forest-600'}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-stone-600">{item.options.find((o) => o.value === current)?.hint}</p>
      <RowStatus text={msg?.text ?? null} ok={msg?.ok ?? true} />
    </li>
  );
}

export function GrowthControlGroup({ group, rows, onOpenConfig }: { group: GrowthGroup; rows: ConfigRow[] | undefined; onOpenConfig?: () => void }) {
  const { confirm, dialog } = useConfirm();
  const titleId = `growth-${group.id}-title`;
  return (
    <section aria-labelledby={titleId} data-growth-group={group.id} className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <h2 id={titleId} className="font-display text-base font-semibold text-stone-900">{group.title}</h2>
      <p className="mt-0.5 text-xs text-stone-600">{group.description}</p>
      <ul className="mt-2 divide-y divide-stone-200">
        {group.items.map((item) => {
          if (item.kind === 'switch') return <SwitchRow key={item.key} item={item} rows={rows} confirm={confirm} />;
          if (item.kind === 'checkin') return <CheckinRow key={item.key} item={item} rows={rows} onOpenConfig={onOpenConfig} />;
          if (item.kind === 'choice') return <ChoiceRow key={item.key} item={item} rows={rows} confirm={confirm} />;
          return <NumberRow key={item.key} item={item} rows={rows} confirm={confirm} />;
        })}
      </ul>
      {dialog}
    </section>
  );
}
