'use client';

import { useEffect, useState } from 'react';
import { Percent } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setConfig, type ConfigRow } from '@/lib/admin-client';
import { buildPartnerRuleWrites, configValue, PARTNER_RULE_FIELDS, readPartnerRuleForm, type PartnerRuleForm } from '@/lib/admin-config-forms';
import { BTN_PRIMARY, Field, INPUT_CLASS, Notice } from './ui';
import { useConfirm } from './confirm-dialog';

/**
 * Hoa hồng cộng tác viên và hạn xử lý của gian hàng đối tác: các con số dính tới tiền nên có thẻ riêng, kiểm giá trị
 * và hỏi lại trước khi lưu (trước đây chỉ sửa được trong danh sách tham số kỹ thuật).
 */
export function PartnerRulesCard({ rows }: { rows: ConfigRow[] | undefined }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [form, setForm] = useState<PartnerRuleForm>(() => readPartnerRuleForm(rows));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Chỉ nạp lại khi giá trị trong hệ thống đổi (tải xong / sau khi lưu) để không xoá số đang gõ dở.
  const snapshot = JSON.stringify(readPartnerRuleForm(rows));
  const [loaded, setLoaded] = useState(snapshot);
  useEffect(() => {
    if (snapshot !== loaded) {
      setForm(JSON.parse(snapshot) as PartnerRuleForm);
      setLoaded(snapshot);
    }
  }, [snapshot, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      const built = buildPartnerRuleWrites(form);
      if (!built.writes) throw new Error(built.error);
      const current = (key: string) => configValue<unknown>(rows, key, PARTNER_RULE_FIELDS.find((f) => f.key === key)?.fallback);
      const changed = built.writes.filter((w) => current(w.key) !== w.value);
      if (changed.length === 0) return 0;
      const ok = await confirm({
        title: 'Lưu thay đổi hoa hồng và thời hạn?',
        message: `${changed
          .map((w) => `${w.label}\n${String(current(w.key))} → ${w.value}`)
          .join('\n\n')}\n\nÁp dụng cho các đơn đặt từ lúc này; đơn cũ giữ mức đã chốt.`,
        confirmLabel: 'Lưu thay đổi',
      });
      if (!ok) return null;
      for (const w of changed) {
        try {
          await setConfig(w.key, w.value);
        } catch (e) {
          throw new Error(`${w.label}: ${e instanceof Error ? e.message : 'không lưu được'}`);
        }
      }
      return changed.length;
    },
    onSuccess: (n) => {
      if (n === null) return;
      setMsg({ ok: true, text: n === 0 ? 'Không có thay đổi.' : `Đã lưu ${n} mục.` });
      void qc.invalidateQueries({ queryKey: ['admin-config'] });
    },
    onError: (e) => {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không lưu được.' });
      void qc.invalidateQueries({ queryKey: ['admin-config'] });
    },
  });

  return (
    <section data-partner-rules aria-label="Hoa hồng cộng tác viên và hạn xử lý đối tác" className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      {dialog}
      <div className="flex items-center gap-2">
        <Percent className="h-4 w-4 text-forest-700" aria-hidden />
        <h2 className="font-display text-sm font-semibold text-stone-900">Hoa hồng cộng tác viên và hạn xử lý của đối tác</h2>
      </div>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          save.mutate();
        }}
      >
        {PARTNER_RULE_FIELDS.map((f) => (
          <Field key={f.form} label={f.label} hint={f.hint}>
            <input
              inputMode="decimal"
              className={`${INPUT_CLASS} min-h-[44px] sm:min-h-0`}
              value={form[f.form]}
              disabled={!rows || save.isPending}
              onChange={(e) => setForm((s) => ({ ...s, [f.form]: e.target.value }))}
            />
          </Field>
        ))}
        <div className="sm:col-span-2">
          <button type="submit" disabled={!rows || save.isPending} className={BTN_PRIMARY}>
            {save.isPending ? 'Đang lưu…' : 'Lưu hoa hồng và thời hạn'}
          </button>
          {msg && (
            <div className="mt-2">
              <Notice tone={msg.ok ? 'success' : 'danger'}>{msg.text}</Notice>
            </div>
          )}
        </div>
      </form>
    </section>
  );
}
