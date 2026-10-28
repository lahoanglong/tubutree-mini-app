import { useState, useEffect, useRef } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, Truck, PackageCheck, Receipt, FileText, Coins,
  ShoppingBag, Gift, Leaf, Zap, Bell, ChevronLeft, Store, TriangleAlert, Repeat, Undo2, PackageOpen, XCircle, UserPlus, Recycle, MessageCircle, Star, Tag, Users, type LucideIcon,
} from 'lucide-react';
import {
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationDTO,
} from '../services/account-api';
import {
  notificationAction as coreAction,
  notificationNote as coreNote,
  notificationOrderLink,
  notificationTitle,
} from '@tubutree/app-core/notification-route';
import { nextNotificationCursor, notificationsInfiniteQuery } from '@tubutree/app-core/queries/account';
import { coreHttp } from '../services/core-http';
import type { NotificationCursor } from '@tubutree/app-core/api/account';
import { getLoadErrorMessage } from '../services/api';
import { trackEvent } from '../services/analytics';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { haptic } from '../utils/haptic';
import { SUBSCRIPTIONS_IN_MINIAPP } from '../utils/features';
import { useHasSubscription } from '../hooks/use-has-subscription';
import { AuthGate } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { vi } from '../i18n/vi';
import { fetchPurchasedItems } from '../services/shop-api';
import { trackReorderReminderCta } from '../services/buy-flow-events';
import { formatDate, formatDateTime } from '../utils/format';
import { Button as DsButton } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Icon } from '../components/ui/icon';
import { IconButton } from '../components/ui/icon-button';
import { PageHeader } from '../components/ui/page-header';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { Heading, Text } from '../components/ui/text';
import { ReorderSheet } from '../components/reorder/reorder-sheet';
import { itemReorderTarget, type ReorderTarget } from '../components/reorder/reorder-types';
import { pickReminderItem, reorderReminderAction } from '../components/reorder/reorder-reminder';

/** Icon theo templateCode; tiêu đề và nút đi tiếp lấy chung với web ở app-core (`notification-route`). */
function notificationIcon(code: string): LucideIcon {
  if (code.startsWith('ORDER_CONFIRMED')) return CheckCircle2;
  if (code.startsWith('ORDER_SHIPPING')) return Truck;
  if (code.startsWith('ORDER_DELIVERED')) return PackageCheck;
  if (code === 'RETURN_REQUESTED') return Undo2;
  if (code.startsWith('RETURN_APPROVED')) return CheckCircle2;
  if (code === 'RETURN_RECEIVED') return PackageOpen;
  if (code === 'RETURN_REJECTED') return XCircle;
  if (code.startsWith('ORDER') || code === 'MERCHANT_ORDER_CANCELLED_BY_SELLER') return Receipt;
  if (code.startsWith('MERCHANT_')) return Store;
  if (code.startsWith('INVOICE')) return FileText;
  if (code.startsWith('REFUND_')) return Undo2;
  if (code.startsWith('COMMISSION')) return Coins;
  if (code.startsWith('CASHBACK')) return ShoppingBag;
  if (code.startsWith('BIRTHDAY') || code.startsWith('VOUCHER') || code.endsWith('_VOUCHER')) return Gift;
  if (code.startsWith('REFERRAL_')) return UserPlus;
  if (code.startsWith('POINTS') || code === 'XU_CONVERTED' || code === 'TIER_DROP_NOTICE' || code.startsWith('EXTERNAL_POINTS_') || code.startsWith('CHAT_ORDER_POINTS_')) return Leaf;
  if (code.startsWith('STOREFRONT')) return Store;
  if (code.startsWith('REORDER_REMINDER')) return Repeat;
  if (code === 'REVIEW_REQUEST') return Star;
  if (code.startsWith('FLASH')) return Zap;
  if (code === 'PRICE_DROP_ALERT') return Tag;
  if (code === 'CART_ABANDONED') return ShoppingBag;
  if (code.startsWith('GAME_')) return Leaf;
  if (code.startsWith('GROUP_BUY_')) return Users;
  if (code.startsWith('SUBSCRIPTION_')) return Repeat;
  if (code.startsWith('COMMUNITY_')) return MessageCircle;
  if (code.startsWith('DEALER')) return Store;
  if (code.startsWith('WASTE') || code.startsWith('REFILL')) return Recycle;
  if (code === 'SUPPORT_CHAT_REPLY') return MessageCircle;
  if (code.startsWith('OPS_')) return TriangleAlert;
  return Bell;
}

/** Icon + nhãn nhóm theo templateCode (§4.10). */
export function notificationMeta(code: string): { Icon: LucideIcon; title: string } {
  return { Icon: notificationIcon(code), title: notificationTitle(code) };
}

export { notificationOrderLink };

/** Câu thêm dưới nội dung tin (chỉ dẫn sang web khi Mini App không có màn tương ứng); null khi không cần. */
export const notificationNote = (templateCode: string): string | null => coreNote(templateCode, 'miniapp');

export type NotificationAction =
  | { kind: 'reorder'; label: string }
  | { kind: 'link'; label: string; to: string; state?: { reviewOrderId: string } };

/**
 * Nút đi tiếp trong chi tiết thông báo, quyết định theo LOẠI tin (templateCode) và dữ liệu có cấu trúc
 * trong payload (luật chung với web ở app-core). `hasSubscription`: khách đã có gói định kỳ (đặt trên web), để tin gói có nút mở tab Định kỳ.
 */
export function notificationAction(
  templateCode: string,
  data: Record<string, string> | undefined,
  opts: { hasSubscription?: boolean } = {},
): NotificationAction | null {
  const a = coreAction(templateCode, data, { platform: 'miniapp', hasSubscription: opts.hasSubscription || SUBSCRIPTIONS_IN_MINIAPP });
  if (!a || a.kind === 'direct') return null;
  if (a.kind === 'reorder') return { kind: 'reorder', label: vi.reorder.reminderCta };
  if (a.kind === 'review') return { kind: 'link', label: a.label, to: `/product/${encodeURIComponent(a.productSlug)}`, state: { reviewOrderId: a.orderId } };
  return a;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Vừa xong';
  if (min < 60) return `${min} phút trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} ngày trước`;
  return formatDate(iso);
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedNotif, setSelectedNotif] = useState<NotificationDTO | null>(null);
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const reminderBusyRef = useRef(false); // chặn double-tap đồng bộ (state chỉ cập nhật sau render)
  // Kết quả tra cứu về muộn phải bỏ qua nếu khách đã rời chi tiết thông báo (hoặc rời trang) trong lúc chờ.
  const selectedIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Trang này là CỬA VÀO từ push của Zalo: mở app từ thông báo thì restore() chưa kịp xong,
  // fetch ngay sẽ 401 và (retry:false cho 4xx) kẹt màn lỗi vĩnh viễn dù ~200ms sau đã có phiên.
  // Mọi trang /me/* khác đều đã gate như vậy; riêng đây bị sót.
  const phase = useAuthPhase();
  const notifQ = useInfiniteQuery({
    ...notificationsInfiniteQuery(coreHttp),
    initialPageParam: undefined as NotificationCursor | undefined,
    getNextPageParam: (lastPage) => nextNotificationCursor(lastPage),
    enabled: phase === 'authenticated',
  });
  const list = notifQ.data?.pages.flat();
  selectedIdRef.current = selectedNotif?.id ?? null;
  // Tin gói định kỳ chỉ có nút "Xem gói" khi khách đã có gói (đặt trên web): tra khi mở đúng loại tin đó.
  const { hasSubscription } = useHasSubscription(phase === 'authenticated' && !!selectedNotif?.templateCode.startsWith('SUBSCRIPTION'));

  const readMut = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    // onSettled chứ không onSuccess: đánh dấu đã đọc hỏng thì huy hiệu chưa-đọc ở trang chủ sai
    // vĩnh viễn mà không có tín hiệu nào. Nạp lại trong CẢ HAI trường hợp để giao diện khớp lại
    // với máy chủ; không hiện toast vì đây là thao tác nền, báo lỗi chỉ thành nhiễu.
    onSettled: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const readAllMut = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unreadCount = list?.filter((n) => n.status !== 'READ').length ?? 0;

  // Sync với popstate (nút back cứng / vuốt back của Zalo) để đóng detail overlay khi back
  useEffect(() => {
    if (!selectedNotif) return;
    const handlePopState = () => {
      setSelectedNotif(null);
    };
    window.history.pushState({ notifDetail: true }, '');
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [selectedNotif]);

  // Mở chi tiết đã đẩy một mục lịch sử (notifDetail) để nút back cứng đóng được lớp phủ. Đi tiếp thì thay đúng mục đó
  // bằng màn đích, nếu không lùi từ màn đích phải qua thêm hai lần mới ra khỏi trang thông báo.
  const goFromDetail = (to: string, state?: unknown) => {
    const inDetail = Boolean(window.history.state?.notifDetail);
    setSelectedNotif(null);
    if (inDetail) navigate(to, { replace: true, state });
    else if (state !== undefined) navigate(to, { state });
    else navigate(to);
  };

  const handleCloseDetail = () => {
    haptic('light');
    if (window.history.state?.notifDetail) {
      window.history.back();
    } else {
      setSelectedNotif(null);
    }
  };

  // Tra đúng variation trong payload qua purchased-items (đơn DELIVERED của chính khách). Lỗi / API cũ
  // 404 → coi như không tìm thấy, rơi về điều hướng dự phòng (Ruling 8).
  const openReorderReminder = async (n: NotificationDTO) => {
    if (reminderBusyRef.current) return;
    reminderBusyRef.current = true;
    try {
      trackReorderReminderCta(n.id);
      haptic('light');
      setReminderBusy(true);
      const variationId = n.payload.data?.variation_id;
      const item = variationId
        ? await fetchPurchasedItems({ variationId, limit: 1 })
            .then((p) => pickReminderItem(p.items, variationId))
            .catch(() => null)
        : null;
      // Khách đã đóng chi tiết / đổi sang thông báo khác / rời trang trong lúc tra cứu → không mở sheet hay điều hướng muộn.
      if (!mountedRef.current || selectedIdRef.current !== n.id) return;
      const action = reorderReminderAction(n.payload.data, item);
      if (action.kind === 'sheet') {
        setSelectedNotif(null);
        setReorderTarget(itemReorderTarget(action.item));
      } else goFromDetail(action.to);
    } finally {
      // Luôn trả cờ bận (kể cả khi tracking/haptic ném lỗi) để CTA không chết vĩnh viễn.
      reminderBusyRef.current = false;
      if (mountedRef.current) setReminderBusy(false);
    }
  };

  const onTap = (n: NotificationDTO) => {
    void trackEvent('notification_opened', 'miniapp', { notificationId: n.id, templateCode: n.templateCode });
    haptic('light');
    if (n.status !== 'READ') readMut.mutate(n.id);
    // Chi tiết của tin trả lời chỉ lặp lại một đoạn của câu trả lời; khách bấm vào là để đọc và nhắn tiếp.
    if (n.templateCode === 'SUPPORT_CHAT_REPLY') navigate('/chat');
    else setSelectedNotif(n);
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader
        title="Thông báo"
        actions={
          unreadCount > 0 ? (
            <DsButton
              variant="ghost"
              loading={readAllMut.isPending}
              onPress={() => {
                haptic('light');
                readAllMut.mutate();
              }}
            >
              Đọc tất cả
            </DsButton>
          ) : undefined
        }
      />

      <AuthGate
        loading={
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <LineItemSkeleton />
            <LineItemSkeleton />
          </div>
        }
      >
        {notifQ.isLoading ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <LineItemSkeleton />
            <LineItemSkeleton />
          </div>
        ) : notifQ.isError && !notifQ.data ? (
          <ErrorState message={getLoadErrorMessage(notifQ.error)} onRetry={() => void notifQ.refetch()} />
        ) : list && list.length > 0 ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map((n) => {
              const m = notificationMeta(n.templateCode);
              const unread = n.status !== 'READ';
              return (
                <div
                  key={n.id}
                  role="button"
                  {...rowKeyboardProps()}
                  className="tubu-press"
                  onClick={() => onTap(n)}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: 12,
                    background: unread ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-surface)',
                    borderRadius: 'var(--radius-card)',
                    border: `1px solid ${unread ? 'var(--color-action-secondary-border)' : 'var(--color-border-subtle)'}`,
                    boxShadow: 'var(--elevation-1)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                    <Icon icon={m.Icon} tone="brand" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Text variant="body-sm" style={{ fontWeight: 600 }}>
                        {m.title}
                      </Text>
                      {unread && (
                        <span
                          role="img"
                          aria-label="chưa đọc"
                          style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-action-primary-bg)' }}
                        />
                      )}
                    </div>
                    {n.payload.body && (
                      <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 2 }}>
                        {n.payload.body}
                      </Text>
                    )}
                    <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4 }}>
                      {relativeTime(n.sentAt)}
                    </Text>
                  </div>
                </div>
              );
            })}
            {notifQ.hasNextPage && (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 4 }}>
                <DsButton
                  variant="secondary"
                  loading={notifQ.isFetchingNextPage}
                  onPress={() => void notifQ.fetchNextPage()}
                  style={{ minWidth: 160 }}
                >
                  Xem thêm
                </DsButton>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            art="leaf"
            heading="Chưa có thông báo nào"
            body="Cập nhật đơn hàng và ưu đãi sẽ hiện ở đây."
          />
        )}
      </AuthGate>

      {/* ── Detail View Overlay ── */}
      {selectedNotif && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Chi tiết thông báo"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 500,
            background: 'var(--color-bg-canvas)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Top Bar with Left Back Button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: 'calc(var(--safe-top) + 4px) 16px 4px 4px',
              background: 'var(--color-bg-surface)',
              borderBottom: '1px solid var(--color-border-subtle)',
              gap: 4,
            }}
          >
            <IconButton icon={ChevronLeft} label="Quay lại" onPress={handleCloseDetail} />
            <Heading variant="title-md" as="h2">
              Chi tiết thông báo
            </Heading>
          </div>

          {/* Detail Content */}
          <div style={{ padding: 16, flex: 1 }}>
            {(() => {
              const m = notificationMeta(selectedNotif.templateCode);
              const bodyText = selectedNotif.payload.body || '';
              const action = notificationAction(selectedNotif.templateCode, selectedNotif.payload.data, { hasSubscription });
              const note = notificationNote(selectedNotif.templateCode);

              return (
                <Card padding={16}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                        <Icon icon={m.Icon} size="lg" tone="brand" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>
                          {m.title}
                        </Text>
                        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
                          {formatDateTime(selectedNotif.sentAt)} ({relativeTime(selectedNotif.sentAt)})
                        </Text>
                      </div>
                    </div>

                    <div style={{ height: 1, background: 'var(--color-border-subtle)' }} />

                    <Text variant="body-sm" as="div" style={{ lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                      {bodyText}
                    </Text>
                    {note && (
                      <Text variant="body-sm" tone="secondary" as="div" style={{ lineHeight: 1.6 }}>
                        {note}
                      </Text>
                    )}

                    {action?.kind === 'reorder' && (
                      <DsButton
                        fullWidth
                        size="lg"
                        loading={reminderBusy}
                        onPress={() => void openReorderReminder(selectedNotif)}
                        style={{ marginTop: 8 }}
                      >
                        {action.label}
                      </DsButton>
                    )}
                    {action?.kind === 'link' && (
                      <DsButton
                        fullWidth
                        size="lg"
                        onPress={() => {
                          haptic('light');
                          goFromDetail(action.to, action.state);
                        }}
                        style={{ marginTop: 8 }}
                      >
                        {action.label}
                      </DsButton>
                    )}
                  </div>
                </Card>
              );
            })()}
          </div>
        </div>
      )}

      {/* Nhắc mua lại → sheet mua lại 1 SP (addSource=reorder_notification). */}
      <ReorderSheet target={reorderTarget} source="notification" onClose={() => setReorderTarget(null)} />
    </Page>
  );
}

