'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  blockSupportConversation,
  getSupportConversation,
  replySupportConversation,
  resendSupportForward,
  unblockSupportConversation,
  type SupportAdminMessage,
  type SupportForwardStatus,
} from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import type { Tone } from '@/lib/recycling';
import { useConfirm } from '../confirm-dialog';
import { BTN_DANGER_OUTLINE, BTN_PRIMARY, BTN_SECONDARY, BTN_XS_SECONDARY, INPUT_CLASS, LoadError, ToneBadge } from '../ui';
import { CONVERSATIONS_KEY } from './conversation-list';

const REPLY_MAX = 1000;
const FORWARD_VIEW: Record<SupportForwardStatus, { tone: Tone; text: string }> = {
  PENDING: { tone: 'info', text: 'Đang chuyển' },
  SENT: { tone: 'success', text: 'Đã chuyển vào Zalo' },
  FAILED: { tone: 'danger', text: 'Chuyển lỗi' },
  UNKNOWN: { tone: 'warning', text: 'Chưa rõ kết quả' },
};
const SOURCE_LABEL: Record<string, string> = { ZALO: 'Zalo', ADMIN: 'Admin' };

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function senderLabel(m: SupportAdminMessage): string {
  if (m.sender === 'CUSTOMER') return 'Khách';
  if (m.sender === 'SYSTEM') return 'Hệ thống';
  return m.staffName ?? (m.source === 'ADMIN' ? 'Admin' : 'Nhân viên');
}

/** Toàn bộ tin của một hội thoại kèm người trả lời, trạng thái chuyển vào Zalo, ô trả lời, chặn/bỏ chặn. */
export function ConversationDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const detailQ = useQuery({ queryKey: ['admin-support-conversation', id], queryFn: () => getSupportConversation(id), refetchInterval: 10_000 });
  const d = detailQ.data;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-support-conversation', id] });
    void qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
  };
  const send = useMutation({
    mutationFn: (body: string) => replySupportConversation(id, body),
    onSuccess: () => {
      setReply('');
      refresh();
    },
    onError: (e) => setError(errText(e, 'Không gửi được trả lời.')),
  });
  const resend = useMutation({
    mutationFn: resendSupportForward,
    onSuccess: (r) => {
      if (r.status !== 'SENT') setError(`Gửi lại chưa thành công (${FORWARD_VIEW[r.status].text}${r.lastError ? `: ${r.lastError}` : ''}).`);
      refresh();
    },
    onError: (e) => {
      setError(errText(e, 'Không gửi lại được.'));
      refresh();
    },
  });
  const block = useMutation({
    mutationFn: (blocked: boolean) => (blocked ? unblockSupportConversation(id) : blockSupportConversation(id)),
    onSuccess: refresh,
    onError: (e) => setError(errText(e, 'Không đổi được trạng thái chặn.')),
  });

  const onBlock = async () => {
    setError(null);
    const ok = await confirm({
      title: 'Chặn chat của khách này?',
      message: 'Khách vẫn đọc được lịch sử nhưng không gửi được tin mới, và tin của họ không vào nhóm Zalo. Bỏ chặn bất cứ lúc nào.',
      confirmLabel: 'Chặn chat',
      tone: 'danger',
    });
    if (ok) block.mutate(false);
  };

  if (detailQ.isLoading) return <p className="text-sm text-stone-500">Đang tải…</p>;
  if (detailQ.isError || !d) return <LoadError onRetry={() => void detailQ.refetch()} retrying={detailQ.isFetching}>Không tải được hội thoại.</LoadError>;

  const firstOfForward = new Set<string>();
  const resendShownFor = (m: SupportAdminMessage) => {
    if (!m.forward?.resendable || firstOfForward.has(m.forward.id)) return false;
    firstOfForward.add(m.forward.id);
    return true;
  };

  return (
    <section aria-labelledby="detail-h" className="min-w-0 space-y-3">
      <div data-detail-head className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="detail-h" className="font-display text-lg font-semibold text-stone-900">
            #{d.code} · {d.user.fullName ?? 'Khách'}
          </h2>
          <p className="text-xs text-stone-600">{d.user.phone ?? 'Chưa có SĐT'}</p>
        </div>
        <div className="flex items-center gap-2">
          {d.blocked && <ToneBadge tone="danger">Đã chặn</ToneBadge>}
          {d.blocked ? (
            <button type="button" className={BTN_SECONDARY} disabled={block.isPending} onClick={() => block.mutate(true)}>
              Bỏ chặn
            </button>
          ) : (
            <button type="button" className={BTN_DANGER_OUTLINE} disabled={block.isPending} onClick={() => void onBlock()}>
              Chặn chat
            </button>
          )}
        </div>
      </div>
      {d.truncated && <p className="text-xs text-stone-500">Chỉ hiện 500 tin gần nhất.</p>}
      <ol className="max-h-[60vh] space-y-2 overflow-y-auto rounded-card border border-stone-200 bg-stone-50 p-3" tabIndex={0} aria-label="Tin trong hội thoại">
        {d.messages.map((m) => (
          <li key={m.id} data-msg={m.id} className={`flex ${m.sender === 'CUSTOMER' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[85%] rounded-card px-3 py-2 text-sm ${m.sender === 'CUSTOMER' ? 'bg-stone-0 text-stone-900' : 'bg-forest-100 text-stone-900'}`}>
              <p className="text-[11px] text-stone-500">
                {senderLabel(m)}
                {m.sender === 'STAFF' && SOURCE_LABEL[m.source] ? ` · ${SOURCE_LABEL[m.source]}` : ''} · {formatDateTime(m.createdAt)}
              </p>
              {m.context && (
                <p className="text-[11px] text-stone-500">
                  {m.context.orderCode ? `Đơn ${m.context.orderCode}` : ''}
                  {m.context.orderCode && m.context.productSlug ? ' · ' : ''}
                  {m.context.productSlug ? `Sản phẩm ${m.context.productSlug}` : ''}
                </p>
              )}
              {m.body && <p className={`whitespace-pre-wrap break-words ${m.recalledAt ? 'line-through opacity-60' : ''}`}>{m.body}</p>}
              {m.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- ảnh khách tải lên, miền không cố định
                <img src={m.imageUrl} alt="Ảnh khách gửi" className="mt-1 max-h-48 rounded-control" />
              )}
              {m.recalledAt && <p className="text-[11px] text-stone-500">Đã thu hồi</p>}
              {m.forward && (
                <p data-forward={m.forward.status} className="mt-1 flex flex-wrap items-center gap-2">
                  <ToneBadge tone={FORWARD_VIEW[m.forward.status].tone}>{FORWARD_VIEW[m.forward.status].text}</ToneBadge>
                  {resendShownFor(m) && (
                    <button
                      type="button"
                      className={BTN_XS_SECONDARY}
                      disabled={resend.isPending}
                      onClick={() => {
                        setError(null);
                        resend.mutate(m.forward!.id);
                      }}
                    >
                      {resend.isPending && resend.variables === m.forward.id ? 'Đang gửi…' : 'Gửi lại'}
                    </button>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <p data-detail-error role="alert" className="text-xs text-danger-fg">
          {error}
        </p>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const body = reply.trim();
          if (!body) return;
          setError(null);
          send.mutate(body);
        }}
      >
        <label className="block text-xs">
          <span className="font-medium text-stone-700">Trả lời khách (không gửi vào nhóm Zalo)</span>
          <textarea name="reply" rows={3} maxLength={REPLY_MAX} value={reply} onChange={(e) => setReply(e.target.value)} className={`mt-1 ${INPUT_CLASS}`} />
        </label>
        <button type="submit" className={BTN_PRIMARY} disabled={!reply.trim() || send.isPending}>
          {send.isPending ? 'Đang gửi…' : 'Gửi trả lời'}
        </button>
      </form>
      {dialog}
    </section>
  );
}
