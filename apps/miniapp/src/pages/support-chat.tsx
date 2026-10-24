import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page, useLocation, useSnackbar } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupportChatContext, SupportChatMessageDTO } from '@tubutree/shared-types';
import { byTime, mergeWindow, sendFailureKind } from '@tubutree/app-core/support-chat-view';
import { errorCode, errorStatus } from '@tubutree/app-core/api/error-status';
import { AuthGate } from '../components/ui/auth-gate';
import { PageHeader } from '../components/ui/page-header';
import { ErrorState } from '../components/ui/empty-state';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { Text } from '../components/ui/text';
import { MessageList, type ChatItem } from '../components/support-chat/message-list';
import { Composer } from '../components/support-chat/composer';
import { ContextChip } from '../components/support-chat/context-chip';
import { getSupportChatPage, markSupportChatRead, sendSupportChat, supportChatQueryOptions, supportChatSummaryQueryOptions } from '../services/support-chat-api';
import { getErrorMessage, isHttpError } from '../services/api';
import { newIdempotencyKey } from '../utils/idempotency';
import { formatPhoneDisplay } from '../utils/phone';
import { haptic } from '../utils/haptic';
import { DEFAULT_SUPPORT, fetchSupportContact } from './about-data';

const POLL_MS = 5000;
const DISABLED_TEXT = 'Chat với Tubu Tree đang tạm đóng. Cần hỗ trợ, gọi hotline.';
const BLOCKED_TEXT = 'Bạn tạm thời không gửi được tin. Cần hỗ trợ, gọi hotline.';

const SESSION_EXPIRED_TEXT = 'Phiên đăng nhập đã hết hạn. Bạn mở lại ứng dụng hoặc đăng nhập lại rồi thử lại nhé.';
const GENERIC_AUTH_MESSAGES = new Set(['Unauthorized', 'Forbidden']);

/**
 * getErrorMessage thay câu 429 bằng "thao tác hơi nhanh", nhưng trần tin trong ngày là câu nghiệp vụ của máy chủ phải hiện nguyên;
 * chữ thô tiếng Anh của Nest ở 401/403 thì không được lộ cho khách.
 */
function chatErrorText(e: unknown): string {
  if (!isHttpError(e)) return getErrorMessage(e);
  const data = e.response?.data as { message?: string | string[] } | undefined;
  const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
  if (e.response?.status === 429 && errorCode(e) === 'CHAT_DAILY_LIMIT' && message) return message;
  if ((e.response?.status === 401 || e.response?.status === 403) && (!message || GENERIC_AUTH_MESSAGES.has(message))) return SESSION_EXPIRED_TEXT;
  return getErrorMessage(e);
}

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
  const contextUsedRef = useRef(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [seen, setSeen] = useState<Map<string, SupportChatMessageDTO>>(() => new Map());
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);

  // refetchInterval hằng số: TanStack tự bỏ nhịp khi cửa sổ không focus, và hàm hỏi lại không bị "tắt hẳn" nếu một lượt hỏi kết thúc lúc đang ẩn.
  const threadQ = useQuery({ ...supportChatQueryOptions(), refetchInterval: POLL_MS, refetchOnWindowFocus: true });
  const supportQ = useQuery({ queryKey: ['support-contact'], queryFn: fetchSupportContact, staleTime: 10 * 60_000 });
  const hotline = (supportQ.isError ? DEFAULT_SUPPORT : supportQ.data)?.hotline ?? null;
  const thread = threadQ.data;
  const lastId = thread?.messages[thread.messages.length - 1]?.id;

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!visible || !lastId) return;
    void markSupportChatRead(lastId)
      .then(() => qc.invalidateQueries({ queryKey: supportChatSummaryQueryOptions().queryKey }))
      .catch(() => undefined);
  }, [lastId, visible, qc]);

  const patch = useCallback((id: string, next: Partial<Pending>) => {
    setPending((list) => list.map((p) => (p.clientMsgId === id ? { ...p, ...next } : p)));
  }, []);

  const deliver = useCallback(
    async (p: Pending) => {
      patch(p.clientMsgId, { status: 'sending', error: undefined });
      try {
        await sendSupportChat({
          clientMsgId: p.clientMsgId,
          source: 'MINIAPP',
          ...(p.body ? { body: p.body } : {}),
          ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
          ...(p.context ? { context: p.context } : {}),
        });
        patch(p.clientMsgId, { status: 'sent' });
      } catch (e) {
        const kind = sendFailureKind(errorStatus(e), errorCode(e));
        if (kind === 'rate-limited') patch(p.clientMsgId, { status: 'failed', error: getErrorMessage(e) });
        else if (kind === 'rejected') patch(p.clientMsgId, { status: 'rejected', error: chatErrorText(e) });
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
      ...(context && !contextUsedRef.current ? { context } : {}),
      status: 'sending',
      createdAt: new Date().toISOString(),
    };
    contextUsedRef.current = true;
    setContextUsed(true);
    setPending((list) => [...list, p]);
    void deliver(p);
  };

  useEffect(() => {
    if (!thread) return;
    setSeen((prev) => mergeWindow(prev, thread.messages, thread.hasMore));
  }, [thread]);

  // Một kho theo id cho mọi tin đã thấy (poll và trang cũ cùng ghi đè vào đây): cửa sổ poll trượt đi cũng không làm rơi tin.
  const server = useMemo(() => {
    const all = thread ? mergeWindow(seen, thread.messages, thread.hasMore) : seen;
    return [...all.values()].sort(byTime);
  }, [seen, thread]);

  const items = useMemo<ChatItem[]>(() => {
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
  }, [server, pending, deliver]);

  const loadOlder = async () => {
    const oldest = server[0]?.id;
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await getSupportChatPage({ before: oldest });
      setSeen((prev) => {
        const next = new Map(prev);
        for (const m of page.messages) next.set(m.id, m);
        return next;
      });
      setOlderHasMore(page.hasMore);
    } catch (e) {
      openSnackbar({ text: chatErrorText(e), type: 'error' });
    } finally {
      setLoadingOlder(false);
    }
  };

  if (threadQ.isLoading) {
    return (
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <LineItemSkeleton />
        <LineItemSkeleton />
      </div>
    );
  }
  if (!thread) return <ErrorState message={chatErrorText(threadQ.error)} onRetry={() => void threadQ.refetch()} />;

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
        {(olderHasMore ?? thread.hasMore) && (
          <div style={{ textAlign: 'center', paddingTop: 8 }}>
            <Button variant="ghost" loading={loadingOlder} onPress={() => void loadOlder()}>Xem tin cũ hơn</Button>
          </div>
        )}
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
              onImageError={(text) => openSnackbar({ text, type: 'error' })}
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
