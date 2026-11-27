'use client';

import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getConfig, setConfig } from '@/lib/admin-client';
import { actionErrorText } from '@/lib/admin-error-text';
import {
  O2O_NUMBER_FIELDS,
  O2O_SWITCHES,
  buildO2oWrites,
  o2oConfirmMessage,
  readO2oSettings,
  type O2oNumberKey,
  type O2oSettingsForm,
  type O2oSwitchKey,
  type O2oWrite,
} from '@/lib/external-o2o-settings';
import { useConfirm } from './confirm-dialog';
import { BTN_PRIMARY, Field, INPUT_CLASS, LoadError, Notice } from './ui';

/** Gộp giá trị vừa tải vào form: chỉ ô có giá trị lưu thật đổi mới bị ghi đè, ô admin đang gõ dở giữ nguyên. */
function mergeLoaded(cur: O2oSettingsForm, prev: O2oSettingsForm, next: O2oSettingsForm): O2oSettingsForm {
  const out: O2oSettingsForm = { switches: { ...cur.switches }, numbers: { ...cur.numbers } };
  for (const k of Object.keys(next.switches) as O2oSwitchKey[]) if (next.switches[k] !== prev.switches[k]) out.switches[k] = next.switches[k];
  for (const f of O2O_NUMBER_FIELDS) if (next.numbers[f.key] !== prev.numbers[f.key]) out.numbers[f.key] = next.numbers[f.key];
  return out;
}

/**
 * Năm khoá tích điểm đơn sàn trong một thẻ (W43, chỉ ADMIN vì `/admin/config` chỉ cho ADMIN). Sửa xong bấm Lưu một lần: hộp xác nhận liệt
 * kê từng khoá đổi "cũ → mới" kèm hậu quả, rồi ghi tuần tự; lỗi ở khoá nào thì dừng và nói rõ khoá nào đã lưu. Thẻ Bật/tắt tính năng ở tab
 * Cấu hình vẫn giữ ba công tắc này: cùng khoá, cùng bộ nhớ đệm `['admin-config']`.
 */
export function ExternalO2oSettingsCard() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const q = useQuery({ queryKey: ['admin-config'], queryFn: () => getConfig() });
  const rows = q.data;
  const [form, setForm] = useState<O2oSettingsForm>(() => readO2oSettings(rows));
  const [msg, setMsg] = useState<{ ok: boolean; text: string; field?: O2oNumberKey } | null>(null);
  const msgId = useId();
  const snapshot = JSON.stringify(readO2oSettings(rows));
  const [loaded, setLoaded] = useState(snapshot);
  useEffect(() => {
    if (snapshot === loaded) return;
    const next = JSON.parse(snapshot) as O2oSettingsForm;
    const prev = JSON.parse(loaded) as O2oSettingsForm;
    setForm((cur) => mergeLoaded(cur, prev, next));
    setLoaded(snapshot);
  }, [snapshot, loaded]);

  const save = useMutation({
    mutationFn: async (writes: O2oWrite[]) => {
      const saved: string[] = [];
      for (const w of writes) {
        try {
          await setConfig(w.key, w.to);
          saved.push(w.label);
        } catch (e) {
          const rest = writes.slice(saved.length).map((x) => x.label).join(', ');
          throw new Error(`${saved.length ? `Đã lưu: ${saved.join(', ')}. ` : ''}Chưa lưu: ${rest}. ${actionErrorText(e)}`);
        }
      }
      return writes.length;
    },
    onSuccess: (n) => setMsg({ ok: true, text: `Đã lưu ${n} mục.` }),
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : actionErrorText(e) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-config'] }),
  });

  const askSave = async () => {
    const built = buildO2oWrites(form, rows);
    if (!built.writes) return setMsg({ ok: false, text: built.error ?? 'Không lưu được.', field: built.field });
    if (built.writes.length === 0) return setMsg({ ok: true, text: 'Không có thay đổi.' });
    const ok = await confirm({
      title: 'Lưu cài đặt tích điểm đơn sàn?',
      message: o2oConfirmMessage(built.writes),
      confirmLabel: 'Lưu thay đổi',
      tone: built.writes.some((w) => w.to === false) ? 'danger' : 'default',
    });
    // Hỏi trước khi gọi mutate: bấm Huỷ thì không có lần ghi nào.
    if (ok) save.mutate(built.writes);
  };

  const busy = !rows || save.isPending;
  return (
    <section aria-labelledby="external-o2o-settings-title" data-external-o2o-settings className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      {dialog}
      <h3 id="external-o2o-settings-title" className="font-display text-sm font-semibold text-stone-900">
        Cài đặt tích điểm đơn sàn
      </h3>
      <p className="mt-0.5 text-xs text-stone-600">Sửa rồi bấm Lưu. Ba công tắc này cũng có ở thẻ Bật/tắt tính năng, hai nơi cùng một cài đặt.</p>
      {q.isError && (
        <div className="mt-3">
          <LoadError onRetry={() => q.refetch()} retrying={q.isFetching}>
            Không tải được cài đặt.
          </LoadError>
        </div>
      )}
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          void askSave();
        }}
      >
        <ul className="divide-y divide-stone-200">
          {O2O_SWITCHES.map((flag) => {
            const key = flag.key as O2oSwitchKey;
            return (
              <li key={key} data-o2o-switch={key} className="py-2">
                <label className="flex min-h-[44px] cursor-pointer items-start gap-2 text-sm sm:min-h-0">
                  <input
                    type="checkbox"
                    role="switch"
                    className="mt-0.5 accent-forest-600"
                    aria-checked={form.switches[key]}
                    checked={form.switches[key]}
                    disabled={busy}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setForm((s) => ({ ...s, switches: { ...s.switches, [key]: on } }));
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-stone-900">{flag.label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-stone-600">{flag.description}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          {O2O_NUMBER_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <input
                inputMode={f.integer ? 'numeric' : 'decimal'}
                className={`${INPUT_CLASS} min-h-[44px] sm:min-h-0`}
                value={form.numbers[f.key]}
                aria-invalid={msg?.field === f.key || undefined}
                aria-describedby={msg?.field === f.key ? msgId : undefined}
                disabled={busy}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((s) => ({ ...s, numbers: { ...s.numbers, [f.key]: v } }));
                  // Đang sửa đúng ô bị báo lỗi: bỏ lỗi cũ, kiểm lại khi bấm Lưu.
                  setMsg((m) => (m?.field === f.key ? null : m));
                }}
              />
            </Field>
          ))}
        </div>
        <div>
          <button type="submit" disabled={busy} className={BTN_PRIMARY}>
            {save.isPending ? 'Đang lưu…' : 'Lưu cài đặt'}
          </button>
          {msg && (
            <div className="mt-2">
              <div id={msgId}>
                <Notice tone={msg.ok ? 'success' : 'danger'} role={msg.ok ? 'status' : 'alert'}>
                  {msg.text}
                </Notice>
              </div>
            </div>
          )}
        </div>
      </form>
    </section>
  );
}
