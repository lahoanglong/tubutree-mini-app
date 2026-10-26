'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupportChatContext, SupportChatMessageDTO } from '@tubutree/shared-types';
import { errorCode, errorStatus } from '@tubutree/app-core/api/error-status';
import { getSupportChatPage, markSupportChatRead, sendSupportChat } from '@tubutree/app-core/api/support-chat';
import { productQuery } from '@tubutree/app-core/queries/catalog';
import { ordersHomeStripQuery } from '@tubutree/app-core/queries/orders';
import { supportContactQuery } from '@tubutree/app-core/queries/config';
import { supportChatQuery, supportChatSummaryQuery } from '@tubutree/app-core/queries/support-chat';
import { quickReplies, supportCopy, type QuickReply } from '@tubutree/app-core/support-copy';
import { byTime, mergeWindow, sendFailureKind } from '@tubutree/app-core/support-chat-view';
import { Button, LineItemSkeleton, Text } from '@/components/mini';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { Composer } from '@/components/support-chat/composer';
import { ContextChip } from '@/components/support-chat/context-chip';
import { ChatClosedPanel } from '@/components/support-chat/closed-panel';
import { QuickReplies } from '@/components/support-chat/quick-replies';
import { MessageList, type ChatItem } from '@/components/support-chat/message-list';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { friendlyError } from '@/lib/friendly-error';
import { formatPhoneDisplay } from '@/lib/phone-display';

const POLL_MS = 5000;
/** Dạng slug sản phẩm (chữ thường, số, gạch nối): tham số lạ như `../auth/me` không được đổi thành một lệnh gọi API. */
const SLUG_PATTERN = /^-?[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BLOCKED_TEXT = 'Bạn tạm thời không gửi được tin. Cần hỗ trợ, gọi hotline.';
const RATE_LIMITED_TEXT = 'Bạn thao tác hơi nhanh, đợi vài giây rồi thử lại nhé.';
/** Khớp mặc định của API: lỗi đọc cấu hình thì vẫn còn số để gọi. */
const DEFAULT_SUPPORT = { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null, hours: null };

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

const errorText = friendlyError;

function toItem(m: SupportChatMessageDTO): ChatItem {
  return { key: m.id, sender: m.sender, body: m.body, imageUrl: m.imageUrl, createdAt: m.createdAt, status: 'sent' };
}

function ChatBody() {
  const qc = useQueryClient();
  const params = useSearchParams();
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
  const [notice, setNotice] = useState<string | null>(null);

  // refetchInterval hằng số: TanStack tự bỏ nhịp khi cửa sổ không focus, và hàm hỏi lại không bị "tắt hẳn" nếu một lượt hỏi kết thúc lúc đang ẩn.
  // QueryClient của web tắt refetchOnWindowFocus mặc định nên bật lại riêng cho query này.
  const threadQ = useQuery({ ...supportChatQuery(coreHttp), refetchInterval: POLL_MS, refetchOnWindowFocus: true });
  const supportQ = useQuery({ ...supportContactQuery(coreHttp), staleTime: 10 * 60_000 });
  const productQ = useQuery({ ...productQuery(coreHttp, productSlug ?? ''), enabled: !!productSlug && !orderCode && SLUG_PATTERN.test(productSlug), staleTime: 10 * 60_000, retry: false });
  const support = supportQ.isError ? DEFAULT_SUPPORT : supportQ.data;
  const hotline = support?.hotline ?? null;
  const thread = threadQ.data;
  const chatOpen = !!thread && thread.enabled && !thread.blocked;
  const shippingQ = useQuery({ ...ordersHomeStripQuery(coreHttp), enabled: chatOpen, staleTime: 30_000, retry: false });

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
        await sendSupportChat(coreHttp, {
          clientMsgId: p.clientMsgId,
          source: 'WEB',
          ...(p.body ? { body: p.body } : {}),
          ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
          ...(p.context ? { context: p.context } : {}),
        });
        patch(p.clientMsgId, { status: 'sent' });
      } catch (e) {
        const kind = sendFailureKind(errorStatus(e), errorCode(e));
        if (kind === 'rate-limited') patch(p.clientMsgId, { status: 'failed', error: RATE_LIMITED_TEXT });
        else if (kind === 'rejected') patch(p.clientMsgId, { status: 'rejected', error: errorText(e) });
        else patch(p.clientMsgId, { status: 'failed' });
      } finally {
        void qc.invalidateQueries({ queryKey: supportChatQuery(coreHttp).queryKey });
      }
    },
    [patch, qc],
  );

  const enqueue = (body: string, imageUrl: string | null, ctx?: SupportChatContext) => {
    setNotice(null);
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
      void markSupportChatRead(coreHttp, ids)
        .then(() => qc.invalidateQueries({ queryKey: supportChatSummaryQuery(coreHttp).queryKey }))
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
    setNotice(null);
    try {
      const page = await getSupportChatPage(coreHttp, { before: oldest });
      setSeen((prev) => {
        const next = new Map(prev);
        for (const m of page.messages) next.set(m.id, m);
        return next;
      });
      setOlderHasMore(page.hasMore);
    } catch (e) {
      setNotice(errorText(e));
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
  if (!thread) return <ErrorState message={errorText(threadQ.error)} onRetry={() => void threadQ.refetch()} />;

  if (!thread.enabled && !thread.blocked) return <ChatClosedPanel support={support} />;
  const closedText = thread.blocked ? BLOCKED_TEXT : null;
  const shippingCode = shippingQ.data?.data[0]?.code ?? null;
  const empty = items.length === 0;
  const greeting: ChatItem = { key: 'greeting', sender: 'STAFF', body: supportCopy.greeting(support?.hours ?? null), imageUrl: null, createdAt: null, status: 'sent' };
  const pickQuick = (q: QuickReply) => enqueue(q.body, null, shippingCode && q.body.includes(shippingCode) ? { orderCode: shippingCode } : undefined);
  const productName = productSlug && !productQ.isLoading ? (productQ.data?.name ?? productSlug) : null;
  const chipLabel = orderCode ? `Về đơn ${orderCode}` : productName ? `Về sản phẩm ${productName}` : null;

  return (
    <div className="flex flex-col max-md:min-h-[calc(100dvh-72px)]">
      {thread.slow && (
        <div style={{ padding: '8px 16px', background: 'var(--color-bg-subtle)' }}>
          <Text variant="caption" tone="secondary">
            {`Nhân viên có thể trả lời chậm.${hotline ? ` Cần gấp, gọi hotline ${formatPhoneDisplay(hotline)}` : ''}`}
          </Text>
        </div>
      )}
      <div data-chat-pane="" className="max-md:flex-1 md:h-[60vh] md:overflow-y-auto">
        {(olderHasMore ?? thread.hasMore) && (
          <div style={{ textAlign: 'center', paddingTop: 8 }}>
            <Button variant="ghost" loading={loadingOlder} onPress={() => void loadOlder()}>Xem tin cũ hơn</Button>
          </div>
        )}
        <MessageList items={server.length === 0 && !closedText ? [greeting, ...items] : items} />
      </div>
      <div
        className="max-md:sticky max-md:bottom-0"
        style={{ borderTop: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-surface)', paddingBottom: 'var(--safe-bottom, env(safe-area-inset-bottom, 0px))' }}
      >
        {notice && (
          <div role="alert" style={{ padding: '8px 12px 0' }}>
            <Text variant="caption" tone="danger">{notice}</Text>
          </div>
        )}
        {closedText ? (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <Text variant="body-sm" tone="secondary">{closedText}</Text>
          </div>
        ) : (
          <>
            {chipLabel && !contextUsed && <ContextChip label={chipLabel} />}
            {empty && <QuickReplies items={quickReplies(shippingCode)} onPick={pickQuick} />}
            <Composer
              onSend={(body) => enqueue(body, null)}
              onSendImage={(url) => enqueue('', url)}
              onImageError={setNotice}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 max-md:max-w-none max-md:px-0 max-md:py-0">
      <PageHeader title="Chat với Tubu Tree" backHref="/tai-khoan" backLabel="Tài khoản" />
      {children}
    </main>
  );
}

function SupportChatPageBody() {
  const phase = useAuthPhase();
  const params = useSearchParams();
  const orderCode = params.get('order');
  const productSlug = params.get('product');
  const returnTo = orderCode
    ? `/ho-tro/chat?order=${encodeURIComponent(orderCode)}`
    : productSlug
      ? `/ho-tro/chat?product=${encodeURIComponent(productSlug)}`
      : '/ho-tro/chat';
  if (phase === 'loading') {
    return (
      <Shell>
        <AuthLoading />
      </Shell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <Shell>
        <SessionUnavailable />
      </Shell>
    );
  }
  if (phase === 'guest') {
    return (
      <Shell>
        <LoginRequired message="Đăng nhập để chat với Tubu Tree." returnTo={returnTo} />
      </Shell>
    );
  }
  return (
    <Shell>
      <div className="md:mt-4 md:overflow-hidden md:rounded-card md:border md:border-stone-200">
        <ChatBody />
      </div>
    </Shell>
  );
}

// useSearchParams: build tĩnh bắt buộc có Suspense bao ngoài.
export default function SupportChatPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <SupportChatPageBody />
    </Suspense>
  );
}
