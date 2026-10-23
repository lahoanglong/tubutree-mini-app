import { useCallback, useEffect, useMemo, useState } from 'react';
import { Page, useLocation, useSnackbar } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupportChatContext, SupportChatMessageDTO } from '@tubutree/shared-types';
import { AuthGate } from '../components/ui/auth-gate';
import { PageHeader } from '../components/ui/page-header';
import { ErrorState } from '../components/ui/empty-state';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
import { MessageList, type ChatItem } from '../components/support-chat/message-list';
import { Composer } from '../components/support-chat/composer';
import { ContextChip } from '../components/support-chat/context-chip';
import { markSupportChatRead, sendSupportChat, supportChatQueryOptions, supportChatSummaryQueryOptions } from '../services/support-chat-api';
import { getErrorMessage } from '../services/api';
import { isHttpError } from '../services/http';
import { newIdempotencyKey } from '../utils/idempotency';
import { formatPhoneDisplay } from '../utils/phone';
import { haptic } from '../utils/haptic';
import { DEFAULT_SUPPORT, fetchSupportContact } from './about-data';

const POLL_MS = 5000;
const DISABLED_TEXT = 'Chat với Tubu Tree đang tạm đóng. Cần hỗ trợ, gọi hotline.';
const BLOCKED_TEXT = 'Bạn tạm thời không gửi được tin. Cần hỗ trợ, gọi hotline.';

/** Màn ẩn thì dừng hỏi: tránh gọi API ngầm mỗi 5 giây khi khách đã rời app. */
export const chatRefetchInterval = (): number | false => (document.visibilityState === 'visible' ? POLL_MS : false);

type PendingStatus = 'sending' | 'sent' | 'failed' | 'rejected';
interface Pending {
  clientMsgId: string;
  body: string;
  imageUrl: string | null;
  context?: SupportChatContext;
  status: PendingStatus;
  error?: string;
  createdAt: string;
}

function toItem(m: SupportChatMessageDTO): ChatItem {
  return { key: m.id, sender: m.sender, body: m.body, imageUrl: m.imageUrl, createdAt: m.createdAt, status: 'sent' };
}

function ChatBody() {
  const { search } = useLocation();
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const orderCode = params.get('order');
  const productSlug = params.get('product');
  const context = useMemo<SupportChatContext | undefined>(
    () => (orderCode ? { orderCode } : productSlug ? { productSlug } : undefined),
    [orderCode, productSlug],
  );
  const [contextUsed, setContextUsed] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);

  const threadQ = useQuery({ ...supportChatQueryOptions(), refetchInterval: chatRefetchInterval });
  const supportQ = useQuery({ queryKey: ['support-contact'], queryFn: fetchSupportContact, staleTime: 10 * 60_000 });
  const hotline = (supportQ.isError ? DEFAULT_SUPPORT : supportQ.data)?.hotline ?? null;
  const thread = threadQ.data;
  const lastId = thread?.messages[thread.messages.length - 1]?.id;

  useEffect(() => {
    void markSupportChatRead()
      .then(() => qc.invalidateQueries({ queryKey: supportChatSummaryQueryOptions().queryKey }))
      .catch(() => undefined);
  }, [lastId, qc]);

  const patch = useCallback((id: string, next: Partial<Pending>) => {
    setPending((list) => list.map((p) => (p.clientMsgId === id ? { ...p, ...next } : p)));
  }, []);

  const deliver = useCallback(
    async (p: Pending) => {
      patch(p.clientMsgId, { status: 'sending', error: undefined });
      try {
        await sendSupportChat({
          clientMsgId: p.clientMsgId,
          ...(p.body ? { body: p.body } : {}),
          ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
          ...(p.context ? { context: p.context } : {}),
        });
        patch(p.clientMsgId, { status: 'sent' });
      } catch (e) {
        const status = isHttpError(e) ? e.response?.status : undefined;
        if (status === 409 || status === 403) patch(p.clientMsgId, { status: 'rejected', error: getErrorMessage(e) });
        else patch(p.clientMsgId, { status: 'failed' });
      } finally {
        void qc.invalidateQueries({ queryKey: supportChatQueryOptions().queryKey });
      }
    },
    [patch, qc],
  );

  const enqueue = (body: string, imageUrl: string | null) => {
    haptic('light');
    const p: Pending = {
      clientMsgId: newIdempotencyKey(),
      body,
      imageUrl,
      ...(context && !contextUsed ? { context } : {}),
      status: 'sending',
      createdAt: new Date().toISOString(),
    };
    setContextUsed(true);
    setPending((list) => [...list, p]);
    void deliver(p);
  };

  const items = useMemo<ChatItem[]>(() => {
    const server = thread?.messages ?? [];
    const known = new Set(server.map((m) => m.clientMsgId).filter(Boolean));
    const local = pending
      .filter((p) => !known.has(p.clientMsgId))
      .map<ChatItem>((p) => ({
        key: p.clientMsgId,
        sender: 'CUSTOMER',
        body: p.body,
        imageUrl: p.imageUrl,
        createdAt: p.createdAt,
        status: p.status,
        error: p.error,
        onRetry: p.status === 'failed' ? () => void deliver(p) : undefined,
      }));
    return [...server.map(toItem), ...local];
  }, [thread, pending, deliver]);

  if (threadQ.isLoading) {
    return (
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <LineItemSkeleton />
        <LineItemSkeleton />
      </div>
    );
  }
  if (!thread) return <ErrorState message={getErrorMessage(threadQ.error)} onRetry={() => void threadQ.refetch()} />;

  const closedText = thread.blocked ? BLOCKED_TEXT : !thread.enabled ? DISABLED_TEXT : null;
  const productName = productSlug ? qc.getQueryData<{ name?: string }>(['product', productSlug])?.name ?? productSlug : null;
  const chipLabel = orderCode ? `Về đơn ${orderCode}` : productName ? `Về sản phẩm ${productName}` : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100dvh - 72px)' }}>
      {thread.slow && (
        <div style={{ padding: '8px 16px', background: 'var(--color-bg-subtle)' }}>
          <Text variant="caption" tone="secondary">
            {`Nhân viên có thể trả lời chậm.${hotline ? ` Cần gấp, gọi hotline ${formatPhoneDisplay(hotline)}` : ''}`}
          </Text>
        </div>
      )}
      <div style={{ flex: 1 }}>
        <MessageList items={items} />
      </div>
      <div style={{ position: 'sticky', bottom: 0, borderTop: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-surface)', paddingBottom: 'var(--safe-bottom)' }}>
        {closedText ? (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <Text variant="body-sm" tone="secondary">{closedText}</Text>
          </div>
        ) : (
          <>
            {chipLabel && !contextUsed && <ContextChip label={chipLabel} />}
            <Composer
              onSend={(body) => enqueue(body, null)}
              onSendImage={(url) => enqueue('', url)}
              onImageError={() => openSnackbar({ text: 'Tải ảnh thất bại. Hãy chọn lại ảnh khác.', type: 'error' })}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function SupportChatPage() {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Chat với Tubu Tree" />
      <AuthGate>
        <ChatBody />
      </AuthGate>
    </Page>
  );
}
