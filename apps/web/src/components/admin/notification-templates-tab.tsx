'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listNotificationTemplates,
  updateNotificationTemplate,
  type AdminNotificationTemplate,
  type NotificationDelivery,
} from '@/lib/admin-client';
import { BTN_XS_PRIMARY, FIELD_XS, INPUT_CLASS, Notice, ToneBadge } from './ui';
import type { Tone } from '@/lib/recycling';

const DELIVERY: Record<NotificationDelivery, { tone: Tone; label: string }> = {
  ZNS: { tone: 'success', label: 'Gửi ZNS + trong app' },
  ZNS_MISSING_TEMPLATE_ID: { tone: 'warning', label: 'Thiếu mã mẫu ZNS' },
  INAPP: { tone: 'neutral', label: 'Chỉ trong app' },
};

/**
 * Mẫu thông báo: kênh gửi, mã mẫu ZNS Zalo đã duyệt, nội dung trong app. Khách chỉ nhận ZNS khi mẫu
 * là kênh ZNS VÀ có mã mẫu; còn lại thông báo chỉ hiện khi khách tự mở app. Danh sách xếp mẫu cần
 * xử lý (ZNS thiếu mã) lên đầu, rồi theo số lượt gửi 30 ngày để biết nên xin duyệt mẫu nào trước.
 */
export function NotificationTemplatesTab() {
  const q = useQuery({ queryKey: ['admin-notification-templates'], queryFn: listNotificationTemplates });
  const missing = q.data?.filter((t) => t.delivery === 'ZNS_MISSING_TEMPLATE_ID').length ?? 0;
  const zns = q.data?.filter((t) => t.delivery === 'ZNS').length ?? 0;

  return (
    <div className="space-y-3">
      <Notice tone={missing > 0 || zns === 0 ? 'warning' : 'info'}>
        {zns === 0
          ? 'Chưa có mẫu nào gửi qua ZNS: mọi thông báo (đơn hàng, nhắc điểm sắp hết hạn, voucher...) chỉ hiện khi khách tự mở app. '
          : `${zns} mẫu đang gửi qua ZNS. `}
        {missing > 0 && `${missing} mẫu kênh ZNS chưa có mã mẫu nên đang chỉ gửi trong app. `}
        Đăng ký mẫu ZNS trên Zalo (duyệt 7–14 ngày, xem docs/GO-LIVE-KEYS.md mục 2), duyệt xong thì nhập mã mẫu ở đây.
      </Notice>
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <p className="text-sm text-danger-fg">Không tải được danh sách mẫu thông báo.</p>}
      <div className="space-y-2">
        {q.data?.map((t) => <TemplateRow key={t.code} item={t} />)}
      </div>
    </div>
  );
}

function TemplateRow({ item }: { item: AdminNotificationTemplate }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    channel: item.channel === 'ZNS' ? 'ZNS' : 'INAPP',
    zaloTemplateId: item.zaloTemplateId ?? '',
    bodyTemplate: item.bodyTemplate,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () =>
      updateNotificationTemplate(item.code, {
        channel: f.channel as 'INAPP' | 'ZNS',
        zaloTemplateId: f.zaloTemplateId.trim() || null,
        bodyTemplate: f.bodyTemplate.trim(),
      }),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Đã lưu.' });
      void qc.invalidateQueries({ queryKey: ['admin-notification-templates'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không lưu được mẫu thông báo.' }),
  });
  const needsId = f.channel === 'ZNS' && !f.zaloTemplateId.trim();
  const dirty =
    f.channel !== (item.channel === 'ZNS' ? 'ZNS' : 'INAPP') ||
    f.zaloTemplateId.trim() !== (item.zaloTemplateId ?? '') ||
    f.bodyTemplate.trim() !== item.bodyTemplate;
  const d = DELIVERY[item.delivery];
  const sent = item.sent30d.INAPP + item.sent30d.ZNS;

  return (
    <div data-template={item.code} className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-all font-mono text-xs font-medium text-stone-900">{item.code}</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-stone-500">{sent} lượt / 30 ngày</span>
          <ToneBadge tone={d.tone}>{d.label}</ToneBadge>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-stone-600">
          <span className="mb-1 block">Kênh</span>
          <select
            name="channel"
            value={f.channel}
            onChange={(e) => setF({ ...f, channel: e.target.value })}
            className={FIELD_XS}
          >
            <option value="INAPP">Trong app</option>
            <option value="ZNS">ZNS + trong app</option>
          </select>
        </label>
        <label className="text-xs text-stone-600">
          <span className="mb-1 block">Mã mẫu ZNS</span>
          <input
            name="zaloTemplateId"
            inputMode="numeric"
            placeholder="vd 231570"
            value={f.zaloTemplateId}
            onChange={(e) => setF({ ...f, zaloTemplateId: e.target.value })}
            className={`${FIELD_XS} w-36`}
          />
        </label>
      </div>
      <label className="mt-2 block text-xs text-stone-600">
        <span className="mb-1 block">Nội dung trong app (biến dạng {'{{order_code}}'})</span>
        <textarea
          name="bodyTemplate"
          rows={2}
          value={f.bodyTemplate}
          onChange={(e) => setF({ ...f, bodyTemplate: e.target.value })}
          className={INPUT_CLASS}
        />
      </label>
      {needsId && <p className="mt-1 text-xs text-warning-fg">Kênh ZNS cần mã mẫu Zalo đã duyệt.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setMsg(null);
            save.mutate();
          }}
          disabled={!dirty || needsId || !f.bodyTemplate.trim() || save.isPending}
          className={BTN_XS_PRIMARY}
        >
          {save.isPending ? 'Đang lưu…' : 'Lưu'}
        </button>
        {msg && (
          <span role={msg.ok ? 'status' : 'alert'} className={`text-xs ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
