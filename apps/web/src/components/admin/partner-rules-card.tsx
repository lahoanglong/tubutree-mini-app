'use client';

import { useEffect, useState } from 'react';
import { Percent } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NetworkError } from '@/lib/client-api';
import { setConfig, type ConfigRow } from '@/lib/admin-client';
import { buildPartnerRuleWrites, configValue, friendlyPartnerRuleError, PARTNER_RULE_FIELDS, readPartnerRuleForm, type PartnerRuleForm, type PartnerRuleWrite } from '@/lib/admin-config-forms';
import { BTN_PRIMARY, Field, INPUT_CLASS, Notice } from './ui';
import { useConfirm } from './confirm-dialog';

const shortLabel = (w: PartnerRuleWrite) => w.label.replace(/ \((?:%|giờ|ngày)\)$/, '');
const isRate = (key: string) => key.startsWith('affiliate.');
const isLoweredSla = (w: PartnerRuleWrite, current: (key: string) => unknown) => !isRate(w.key) && w.value < Number(current(w.key));

/** Mỗi loại khoá một câu hậu quả riêng: hoa hồng chốt lúc đặt đơn, còn hạn xử lý tính lại mỗi lần xem và nhắc mỗi giờ. */
export function partnerRuleConfirmMessage(changed: PartnerRuleWrite[], current: (key: string) => unknown): string {
  const lines = changed.map((w) => `${w.label}\n${String(current(w.key))} → ${w.value}`).join('\n\n');
  const notes: string[] = [];
  if (changed.some((w) => isRate(w.key))) {
    notes.push('Hoa hồng: áp cho các đơn đặt từ lúc này; đơn cũ giữ mức đã chốt.');
  }
  if (changed.some((w) => w.key === 'affiliate.max_rate_pct' && w.value < Number(current(w.key)))) {
    notes.push('Hạ trần không đổi những % riêng đã đặt trước đó cho từng sản phẩm.');
  }
  const buyerNotified = changed.some((w) => w.key === 'merchant.confirm_sla_hours' || w.key === 'merchant.ship_sla_hours');
  if (changed.some((w) => !isRate(w.key))) {
    notes.push(
      buyerNotified
        ? 'Hạn xử lý: áp ngay cho cả đơn đang xử lý. Đơn vừa thành quá hạn sẽ được nhắc trong vòng một giờ, kể cả báo cho khách là đơn bị chậm.'
        : 'Hạn giao: áp ngay cho cả đơn đang giao. Đơn vừa thành quá hạn sẽ hiện ở danh sách quá hạn và đối tác được nhắc trong vòng một giờ; khách không nhận thông báo.',
    );
  }
  if (changed.some((w) => isLoweredSla(w, current))) {
    notes.push(
      buyerNotified
        ? 'Bạn đang HẠ hạn: nhiều đơn có thể quá hạn cùng lúc và khách nhận thông báo chậm trễ hàng loạt. Hãy chắc chắn trước khi lưu.'
        : 'Bạn đang HẠ hạn: nhiều đơn có thể quá hạn cùng lúc và đối tác bị nhắc hàng loạt. Hãy chắc chắn trước khi lưu.',
    );
  }
  return `${lines}\n\n${notes.join('\n')}`;
}

/**
 * Hoa hồng cộng tác viên và hạn xử lý của gian hàng đối tác: các con số dính tới tiền nên có thẻ riêng, kiểm giá trị
 * và hỏi lại trước khi lưu (trước đây chỉ sửa được trong danh sách tham số kỹ thuật).
 */
export function PartnerRulesCard({ rows }: { rows: ConfigRow[] | undefined }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [form, setForm] = useState<PartnerRuleForm>(() => readPartnerRuleForm(rows));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Chỉ nạp lại ô nào có giá trị lưu thật đổi (tải xong / sau khi lưu): ô khác, kể cả ô lưu lỗi, giữ số đang gõ.
  const snapshot = JSON.stringify(readPartnerRuleForm(rows));
  const [loaded, setLoaded] = useState(snapshot);
  useEffect(() => {
    if (snapshot === loaded) return;
    const next = JSON.parse(snapshot) as PartnerRuleForm;
    const prev = JSON.parse(loaded) as PartnerRuleForm;
    setForm((cur) => {
      const merged = { ...cur };
      for (const f of PARTNER_RULE_FIELDS) if (next[f.form] !== prev[f.form]) merged[f.form] = next[f.form];
      return merged;
    });
    setLoaded(snapshot);
  }, [snapshot, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      const built = buildPartnerRuleWrites(form, readPartnerRuleForm(rows));
      if (!built.writes) throw new Error(built.error);
      const current = (key: string) => configValue<unknown>(rows, key, PARTNER_RULE_FIELDS.find((f) => f.key === key)?.fallback);
      const changed = built.writes.filter((w) => current(w.key) !== w.value);
      if (changed.length === 0) return 0;
      const ok = await confirm({
        title: 'Lưu thay đổi hoa hồng và thời hạn?',
        message: partnerRuleConfirmMessage(changed, current),
        confirmLabel: 'Lưu thay đổi',
        tone: changed.some((w) => isLoweredSla(w, current)) ? 'danger' : 'default',
      });
      if (!ok) return null;
      const saved: string[] = [];
      for (const w of changed) {
        try {
          await setConfig(w.key, w.value);
          saved.push(shortLabel(w));
        } catch (e) {
          const reason = friendlyPartnerRuleError(e instanceof Error ? e.message : 'không lưu được');
          const rest = changed.slice(saved.length).map(shortLabel).join(', ');
          const done = saved.length > 0 ? `Đã lưu: ${saved.join(', ')}. ` : '';
          // Mất mạng hoặc quá giờ chờ: máy chủ có thể đã ghi xong mà ta không nhận được trả lời.
          if (e instanceof NetworkError) throw new Error(`${done}${reason} Có thể chưa lưu: ${rest}. Hãy xem lại các số sau khi tải lại.`);
          if (saved.length > 0) throw new Error(`${done}Chưa lưu: ${rest}. ${reason}`);
          throw new Error(changed.length > 1 ? `Chưa lưu thay đổi nào (${rest}). ${reason}` : `Chưa lưu được ${shortLabel(w)}. ${reason}`);
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
        {Number(form.confirmHours.replace(',', '.')) >= Number(form.shipHours.replace(',', '.')) && (
          <div className="sm:col-span-2">
            <Notice tone="warning">Hạn xác nhận đang bằng hoặc lớn hơn hạn gửi hàng, nên đơn vừa được nhận có thể quá hạn gửi hàng ngay.</Notice>
          </div>
        )}
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
