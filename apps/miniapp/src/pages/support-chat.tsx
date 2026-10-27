import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page, useLocation, useSnackbar } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupportChatContext, SupportChatMessageDTO } from '@tubutree/shared-types';
import { quickReplies, supportCopy, type QuickReply } from '@tubutree/app-core/support-copy';
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
import { ChatClosedPanel } from '../components/support-chat/closed-panel';
import { QuickReplies } from '../components/support-chat/quick-replies';
import { getSupportChatPage, markSupportChatRead, sendSupportChat, supportChatQueryOptions, supportChatSummaryQueryOptions } from '../services/support-chat-api';
import { getErrorMessage, isHttpError } from '../services/api';
import { fetchOrders } from '../services/shop-api';
import { useLivePathnameRef } from '../hooks/use-live-pathname';
import { newIdempotencyKey } from '../utils/idempotency';
import { formatPhoneDisplay } from '../utils/phone';
import { haptic } from '../utils/haptic';
import { DEFAULT_SUPPORT, fetchSupportContact } from './about-data';

const POLL_MS = 5000;
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
  const { pathname, search } = useLocation();
  const livePathname = useLivePathnameRef();
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
  const support = supportQ.isError ? DEFAULT_SUPPORT : supportQ.data;
  const hotline = support?.hotline ?? null;
  const thread = threadQ.data;
  const chatOpen = !!thread && thread.enabled && !thread.blocked;
  const shippingQ = useQuery({
    queryKey: ['orders', 'home-strip'],
    queryFn: () => fetchOrders({ status: 'SHIPPING' }, 1, 1),
    enabled: chatOpen,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

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

  const enqueue = (body: string, imageUrl: string | null, ctx?: SupportChatContext) => {
    haptic('light');
    const p: Pending = {
      clientMsgId: newIdempotencyKey(),
      body,
      imageUrl,
      ...(ctx ? { context: ctx } : context && !contextUsedRef.current ? { context } : {}),
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
    // Đã thấy đầu cuộc trò chuyện thì nhớ: tin mới đẩy cửa sổ poll vượt 50 tin cũng không bật lại "Xem tin cũ hơn" và không làm mất lời chào.
    if (!thread.hasMore) setOlderHasMore(false);
  }, [thread]);

  // Một kho theo id cho mọi tin đã thấy (poll và trang cũ cùng ghi đè vào đây): cửa sổ poll trượt đi cũng không làm rơi tin.
  const server = useMemo(() => {
    const all = thread ? mergeWindow(seen, thread.messages, thread.hasMore) : seen;
    return [...all.values()].sort(byTime);
  }, [seen, thread]);

  // Báo id từng tin STAFF/SYSTEM đã hiển thị (kể cả tin commit muộn nằm trước tin cuối và tin cũ tải thêm), không báo theo thời điểm.
  const reportedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!visible) return;
    const todo = server.filter((m) => m.sender !== 'CUSTOMER' && !reportedRef.current.has(m.id)).map((m) => m.id);
    for (let i = 0; i < todo.length; i += 100) {
      const ids = todo.slice(i, i + 100);
      for (const id of ids) reportedRef.current.add(id);
      void markSupportChatRead(ids)
        .then(() => qc.invalidateQueries({ queryKey: supportChatSummaryQueryOptions().queryKey }))
        .catch(() => {
          // Chưa báo được thì lần tải thread kế tiếp (dataUpdatedAt tăng sau mỗi lần tải thành công, kể cả dữ liệu y hệt) gửi lại.
          for (const id of ids) reportedRef.current.delete(id);
        });
    }
  }, [server, visible, qc, threadQ.dataUpdatedAt]);

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

  // Chat tắt: còn lịch sử thì vẫn cho đọc (chỉ đọc, phần liên hệ thay ô nhập); chưa có tin nào thì cả màn là phần liên hệ.
  const closed = !thread.enabled && !thread.blocked;
  if (closed && server.length === 0) return <ChatClosedPanel support={support} />;
  const closedText = thread.blocked ? BLOCKED_TEXT : null;
  const shippingCode = shippingQ.data?.data[0]?.code ?? null;
  const empty = items.length === 0;
  // Hàng câu hỏi nhanh chờ truy vấn đơn đang giao xong để nút "Hỏi về đơn" không chèn muộn làm các nút khác xô xuống.
  const quickReady = shippingQ.isSuccess || shippingQ.isError;
  // Lời chào là bong bóng phía client (không lưu): luôn nằm đầu cuộc trò chuyện, tức khi không còn tin cũ hơn để tải.
  const showGreeting = !closed && !closedText && !(olderHasMore ?? thread.hasMore);
  const greeting: ChatItem = { key: 'greeting', sender: 'STAFF', body: supportCopy.greeting(support?.hours ?? null), imageUrl: null, createdAt: null, status: 'sent' };
  const pickQuick = (q: QuickReply) => enqueue(q.body, null, shippingCode && q.body.includes(shippingCode) ? { orderCode: shippingCode } : undefined);
  const productName = productSlug ? qc.getQueryData<{ name?: string }>(['product', productSlug])?.name ?? productSlug : null;
  const chipLabel = orderCode ? `Về đơn ${orderCode}` : productName ? `Về sản phẩm ${productName}` : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100dvh - 72px)' }}>
      {thread.slow && !closed && (
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
        <MessageList items={showGreeting ? [greeting, ...items] : items} />
      </div>
      <div style={{ position: 'sticky', bottom: 0, borderTop: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-surface)', paddingBottom: 'var(--safe-bottom)' }}>
        {closed ? (
          <ChatClosedPanel support={support} compact />
        ) : closedText ? (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <Text variant="body-sm" tone="secondary">{closedText}</Text>
          </div>
        ) : (
          <>
            {chipLabel && !contextUsed && <ContextChip label={chipLabel} />}
            {empty && quickReady && <QuickReplies items={quickReplies(shippingCode)} onPick={pickQuick} />}
            <Composer
              onSend={(body) => enqueue(body, null)}
              onSendImage={(url) => {
                // Trang cũ còn mount suốt hiệu ứng thoát nên composer chưa unmount: hỏi router thật xem khách còn ở màn chat không.
                if (livePathname && livePathname.current !== pathname) return;
                enqueue('', url);
              }}
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
