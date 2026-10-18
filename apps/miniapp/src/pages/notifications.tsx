import { useState, useEffect, useRef } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, Truck, PackageCheck, Receipt, FileText, Coins,
  ShoppingBag, Gift, Leaf, Zap, Bell, ChevronLeft, Store, TriangleAlert, Repeat, Undo2, PackageOpen, XCircle, UserPlus, Recycle, type LucideIcon,
} from 'lucide-react';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationDTO,
} from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { trackEvent } from '../services/analytics';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { haptic } from '../utils/haptic';
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

/** Icon + nhãn nhóm theo templateCode (§4.10). */
export function notificationMeta(code: string): { Icon: LucideIcon; title: string } {
  if (code.startsWith('ORDER_CONFIRMED')) return { Icon: CheckCircle2, title: 'Đơn đã xác nhận' };
  if (code.startsWith('ORDER_SHIPPING')) return { Icon: Truck, title: 'Đang giao hàng' };
  if (code.startsWith('ORDER_DELIVERED')) return { Icon: PackageCheck, title: 'Đã giao thành công' };
  if (code === 'RETURN_REQUESTED') return { Icon: Undo2, title: 'Đã nhận yêu cầu đổi/trả' };
  if (code.startsWith('RETURN_APPROVED')) return { Icon: CheckCircle2, title: 'Yêu cầu đổi/trả đã duyệt' };
  if (code === 'RETURN_RECEIVED') return { Icon: PackageOpen, title: 'Tubu đã nhận lại hàng' };
  if (code === 'RETURN_REJECTED') return { Icon: XCircle, title: 'Yêu cầu đổi/trả bị từ chối' };
  if (code.startsWith('ORDER')) return { Icon: Receipt, title: 'Cập nhật đơn hàng' };
  if (code.startsWith('INVOICE')) return { Icon: FileText, title: 'Hóa đơn điện tử' };
  if (code.startsWith('COMMISSION')) return { Icon: Coins, title: 'Hoa hồng CTV' };
  if (code.startsWith('CASHBACK')) return { Icon: ShoppingBag, title: 'Hoàn tiền' };
  if (code.startsWith('BIRTHDAY') || code.startsWith('VOUCHER')) return { Icon: Gift, title: 'Ưu đãi cho bạn' };
  if (code === 'REFERRAL_REWARD_PAID') return { Icon: UserPlus, title: 'Thưởng giới thiệu bạn bè' };
  if (code === 'REFERRAL_MILESTONE_PAID') return { Icon: UserPlus, title: 'Thưởng mốc giới thiệu' };
  if (code === 'REFERRAL_REWARD_REVOKED') return { Icon: UserPlus, title: 'Thu lại thưởng giới thiệu' };
  if (code.startsWith('POINTS') || code === 'XU_CONVERTED') return { Icon: Leaf, title: 'Điểm Xanh' };
  if (code.startsWith('STOREFRONT')) return { Icon: Store, title: 'Gian hàng của bạn' };
  // REORDER_REMINDER (§6.14.7, LifecycleService.sendReorderReminders) — nhắc mua lại khi 1 SP đã
  // qua ~chu kỳ tiêu dùng kể từ đơn DELIVERED gần nhất. Trước đây rơi về nhãn chung "Thông báo"
  // (A1-01=A2-06=A3-02, cùng cụm lỗi với CTA thiếu ở dưới).
  if (code.startsWith('REORDER_REMINDER')) return { Icon: Repeat, title: 'Nhắc mua lại' };
  // Trong app mục này tên là "Ưu đãi giờ vàng" (vi.flashSale.sectionTitle) — thông báo gọi
  // "Flash Sale" khiến khách vào app tìm mục không tồn tại.
  if (code.startsWith('FLASH')) return { Icon: Zap, title: 'Ưu đãi giờ vàng' };
  // DEALER_BONUS_PAID / DEALER_REWARD_CLAIM_* — thưởng doanh số & yêu cầu nhận thưởng đại lý.
  if (code.startsWith('DEALER')) return { Icon: Store, title: 'Đại lý' };
  if (code.startsWith('WASTE')) return { Icon: Recycle, title: 'Đổi rác lấy quà' };
  // OPS_* (vd OPS_GOMDON_ALERT) gửi tới tài khoản ADMIN; admin đăng nhập mini app vẫn thấy trong
  // danh sách (listForUser không lọc theo mã) nên cần nhãn riêng thay vì "Thông báo" chung chung.
  if (code.startsWith('OPS_')) return { Icon: TriangleAlert, title: 'Cảnh báo vận hành' };
  return { Icon: Bell, title: 'Thông báo' };
}

/**
 * Có hiện nút "Xem chi tiết đơn hàng" không. Báo động OPS_* mang order_code của đơn KHÁCH KHÁC —
 * GET /orders/:code chỉ trả đơn của chính người xem (404 với admin), nên nút đó chỉ dẫn tới màn lỗi.
 */
export function notificationOrderLink(templateCode: string, orderCode: unknown): boolean {
  if (templateCode.startsWith('OPS_')) return false;
  return templateCode.startsWith('ORDER') || !!orderCode;
}

export type NotificationAction = { kind: 'reorder'; label: string } | { kind: 'link'; label: string; to: string };

const enc = (v: string) => encodeURIComponent(v);

/** Đường dẫn nội bộ an toàn: bắt đầu bằng "/" một lần (chặn "//host" và URL ngoài). */
function internalRoute(v: unknown): string | null {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : null;
}

/** Tin chỉ gửi cho admin; việc xử lý nằm ở trang quản trị web, mini app không có màn tương ứng. */
const ADMIN_ONLY_CODES = new Set(['DEALER_CREDIT_PAYMENT_REPORTED', 'DEALER_REWARD_CLAIM_NEW']);

/**
 * Nút đi tiếp trong chi tiết thông báo, quyết định theo LOẠI tin (templateCode) và dữ liệu có cấu trúc
 * trong payload. Bản cũ dò từ khoá trong nội dung tin nên tin nói về sản phẩm bị dẫn nhầm sang Vườn Xanh,
 * còn tin giảm giá/cộng đồng không có nút.
 */
export function notificationAction(templateCode: string, data: Record<string, string> | undefined): NotificationAction | null {
  const d = data ?? {};
  if (templateCode.startsWith('OPS_') || ADMIN_ONLY_CODES.has(templateCode)) return null;
  const orderCode = d.order_code ?? d.orderCode;
  const productSlug = d.product_slug ?? d.productSlug;
  const route = internalRoute(d.route);

  if (templateCode.startsWith('REORDER_REMINDER')) return { kind: 'reorder', label: vi.reorder.reminderCta };
  if (templateCode.startsWith('WASTE') || templateCode.startsWith('REFILL')) {
    const requestId = d.request_id ?? d.requestId;
    if (templateCode === 'WASTE_GIFT_CANCELLED') return { kind: 'link', label: 'Xem quà của tôi', to: '/rewards/mine' };
    if (templateCode === 'WASTE_PERK_REVIEWED') return { kind: 'link', label: 'Mở màn nhận hàng', to: '/recycle/desk' };
    if (templateCode === 'WASTE_POINTS_CREDITED' && requestId) return { kind: 'link', label: 'Xem kết quả', to: `/recycle/done/${enc(requestId)}` };
    if (templateCode.startsWith('WASTE') && requestId) return { kind: 'link', label: 'Xem yêu cầu', to: `/recycle/r/${enc(requestId)}` };
    return { kind: 'link', label: 'Mở Đổi rác lấy quà', to: '/recycle' };
  }
  if (notificationOrderLink(templateCode, orderCode)) {
    return { kind: 'link', label: 'Xem chi tiết đơn hàng', to: orderCode ? `/order/${enc(orderCode)}` : '/orders' };
  }
  if (route) return { kind: 'link', label: 'Xem chi tiết', to: route };
  if (templateCode.startsWith('FLASH')) {
    // Không có slug thì về Trang chủ, nơi dải "Ưu đãi giờ vàng" đang hiển thị.
    return { kind: 'link', label: 'Xem ưu đãi giờ vàng', to: productSlug ? `/product/${enc(productSlug)}` : '/' };
  }
  if (templateCode === 'PRICE_DROP_ALERT') {
    return { kind: 'link', label: 'Xem sản phẩm', to: productSlug ? `/product/${enc(productSlug)}` : '/wishlist' };
  }
  if (templateCode.startsWith('COMMUNITY_')) {
    const postId = d.post_id ?? d.postId;
    return { kind: 'link', label: 'Xem trong Cộng đồng', to: postId ? `/feed/${enc(postId)}` : '/feed' };
  }
  if (templateCode.startsWith('GAME_')) return { kind: 'link', label: 'Đến Vườn Xanh', to: '/game' };
  if (templateCode === 'CART_ABANDONED') return { kind: 'link', label: 'Xem giỏ hàng', to: '/cart' };
  if (templateCode.endsWith('_VOUCHER') || templateCode.startsWith('VOUCHER')) {
    return { kind: 'link', label: 'Xem mã giảm giá', to: '/loyalty' };
  }
  if (templateCode.startsWith('POINTS') || templateCode === 'XU_CONVERTED' || templateCode.startsWith('REFERRAL_')) {
    return { kind: 'link', label: 'Xem Điểm Xanh', to: '/loyalty' };
  }
  if (templateCode.startsWith('CASHBACK')) return { kind: 'link', label: 'Xem Ví Tubu', to: '/wallet' };
  if (templateCode.startsWith('SUBSCRIPTION')) return { kind: 'link', label: 'Xem gói định kỳ', to: '/subscriptions' };
  if (templateCode.startsWith('STOREFRONT')) return { kind: 'link', label: 'Thêm vào gian hàng', to: '/storefront' };
  if (templateCode.startsWith('DEALER')) return { kind: 'link', label: 'Mở trang Đại lý', to: '/dealer' };
  // Nhóm hết hạn không đủ người: về trang sản phẩm, nơi vừa mua được với giá thường vừa mở được nhóm mới.
  if (templateCode === 'GROUP_BUY_FAILED' && productSlug) {
    return { kind: 'link', label: 'Xem sản phẩm', to: `/product/${enc(productSlug)}` };
  }
  if (templateCode.startsWith('GROUP_BUY')) return { kind: 'link', label: 'Xem mua chung', to: '/group-buy' };
  return null;
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
  const notifQ = useQuery({ queryKey: ['notifications'], queryFn: getNotifications, enabled: phase === 'authenticated' });
  selectedIdRef.current = selectedNotif?.id ?? null;

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
  const unreadCount = notifQ.data?.filter((n) => n.status !== 'READ').length ?? 0;

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
      setSelectedNotif(null);
      if (action.kind === 'sheet') setReorderTarget(itemReorderTarget(action.item));
      else navigate(action.to);
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
    setSelectedNotif(n);
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
          <ErrorState message={getErrorMessage(notifQ.error)} onRetry={() => void notifQ.refetch()} />
        ) : notifQ.data && notifQ.data.length > 0 ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notifQ.data.map((n) => {
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
              const action = notificationAction(selectedNotif.templateCode, selectedNotif.payload.data);

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
                          setSelectedNotif(null);
                          navigate(action.to);
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

