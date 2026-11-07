import { useEffect, useState } from 'react';
import { INVOICE_ISSUE_FAILED } from '@tubutree/app-core/client-copy';
import { Box, Page, Text, Sheet, useParams, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Recycle, Star, Leaf, CheckCircle2, XCircle, Clock, type LucideIcon } from 'lucide-react';
import { fetchOrder, fetchOrders, cancelOrder, fetchMyRefunds, fetchMyReturns, fetchRefundBank, type OrderView } from '../services/shop-api';
import { getErrorMessage, getLoadErrorMessage, isNotFoundError } from '../services/api';
import { getWasteRequestByOrder, WASTE_QUERY_KEYS } from '../services/waste-api';
import { useAuthStore } from '../store/auth';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { LineItemSkeleton, Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import {
  formatVnd,
  formatPoints,
  addressLine,
} from '../utils/format';
import { shippingEventLabel } from '../utils/format-shipping';
import { STATUS_COLOR, buyerStatusLabel, orderPointsNote, orderStamp, discountRows } from '../utils/order-status';
import {
  hasOA,
  followOA,
  requestNotifyPermission,
  getOaPromptState,
  setOaPromptState,
  shouldShowFollowOaPrompt,
} from '../services/zmp-bridge';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { copyText } from '../utils/clipboard';
import { PageHeader } from '../components/ui/page-header';
import { Badge } from '../components/ui/badge';
import { Icon, type IconProps } from '../components/ui/icon';
import { KeyValueRow } from '../components/ui/key-value-row';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { Button } from '../components/ui/button';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { ListRow } from '../components/ui/list-row';
import { ProductThumb } from '../components/ui/product-thumb';
import { ReorderSheet } from '../components/reorder/reorder-sheet';
import { CancelReasonPicker } from '../components/orders/cancel-reason-picker';
import { OrderStatusHero } from '../components/orders/order-status-hero';
import { OrderTrack } from '../components/orders/order-track';
import { OrderTimelineTracker } from '../components/orders/order-timeline-tracker';
import { buildOrderTimelineSteps, formatOrderShareSummary, orderTimelineStamps } from '@tubutree/app-core/commerce/order-timeline';
import { OrderShipping } from '../components/orders/order-shipping';
import { OrderActionBar } from '../components/orders/order-action-bar';
import { orderActionPlan, orderHeadline, orderTrack, shippingEvents, type OrderActionKind, type TrackOrder } from '@tubutree/app-core/commerce/order-tracking';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useCountdown } from '../hooks/use-countdown';
import { serverNow } from '../utils/server-clock';
import { customerOrderNote, isSubscriptionOrder, openProductSlug } from '@tubutree/app-core/api/orders';
import { orderDeliveryEtaLabel } from '@tubutree/app-core/shipping-eta';
import { cancelReasonBody, type CancelReasonCode } from '@tubutree/app-core/cancel-reasons';
import { SupportContact } from '../components/support-contact';
import { usePublicConfig } from '../hooks/use-public-config';
import { orderReorderTarget, type ReorderTarget } from '../components/reorder/reorder-types';
import { ReturnRequestSheet } from '../components/orders/return-request-sheet';
import { RefundDestinationPicker } from '../components/orders/refund-destination-picker';
import { OrderRefunds } from '../components/orders/order-refunds';
import {
  EMPTY_BANK,
  cancelRefundMode,
  destinationBody,
  remainingByLine,
  refundOfReturn,
  returnLinesText,
  returnStatusLabel,
  showsRefundPanel,
  type RefundBankInput,
  type RefundMethodChoice,
} from '../utils/refund-rules';
import { bankDetailsError } from '../utils/refund-form-rules';

export default function OrderDetailPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const publicConfig = usePublicConfig();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  // Đổi key mỗi lần mở để form đổi/trả khởi tạo lại theo dữ liệu mới nhất (vẫn giữ animation đóng của sheet).
  const [returnKey, setReturnKey] = useState(0);
  const [cancelMethod, setCancelMethod] = useState<RefundMethodChoice>('WALLET');
  const [cancelBank, setCancelBank] = useState<RefundBankInput>(EMPTY_BANK);
  const [cancelTouched, setCancelTouched] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancelReasonCode | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState('');
  // State ổn định (không dựng target trong JSX) — ReorderSheet reset lựa chọn theo identity của target.
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const phase = useAuthPhase();
  const meId = useAuthStore((s) => s.user?.id);

  // Guard auth: tránh gọi /orders/:code khi chưa silent-login xong (deeplink từ thông báo
  // đơn hàng ngay lúc app vừa mở → 401 hiện lỗi trong khi chỉ cần chờ vài trăm ms là có phiên).
  const order = useQuery({
    queryKey: ['order', code],
    queryFn: () => fetchOrder(code!),
    enabled: !!code && phase === 'authenticated',
  });
  const myReturns = useQuery({
    queryKey: ['my-returns'],
    queryFn: fetchMyReturns,
    enabled: !!order.data && (order.data.status === 'DELIVERED' || order.data.status === 'RETURNED'),
  });
  // Cùng khoá với khối Hoàn tiền (OrderRefunds): thẻ đổi/trả nói nơi nhận theo khoản hoàn thật (khách có thể đã đổi sang Ví).
  const hasApprovedReturn = (myReturns.data ?? []).some((r) => r.orderId === order.data?.id && r.status === 'APPROVED');
  const myRefunds = useQuery({
    queryKey: ['my-refunds', order.data?.id],
    queryFn: () => fetchMyRefunds(order.data!.id),
    enabled: !!order.data?.id && hasApprovedReturn,
  });

  useEffect(() => {
    if (!confirmCancel || cancelMethod !== 'BANK' || cancelBank.accountNumber) return;
    let alive = true;
    void fetchRefundBank()
      .then((b) => {
        if (alive && b) setCancelBank(b);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [confirmCancel, cancelMethod, cancelBank.accountNumber]);

  // ── Mời theo dõi OA sau đơn đầu tiên (finding A3-01 nửa 2 — xem shouldShowFollowOaPrompt) ──
  // Mặc định seen=true để KHÔNG nháy hiện thẻ rồi ẩn ngay trong lúc chờ đọc cờ đã lưu trên máy.
  const [oaPromptSeen, setOaPromptSeen] = useState(true);
  const [oaPromptReady, setOaPromptReady] = useState(false);
  const [oaBusy, setOaBusy] = useState(false);

  useEffect(() => {
    if (!hasOA) return;
    let alive = true;
    void getOaPromptState().then((s) => {
      if (!alive) return;
      setOaPromptSeen(s.promptSeen);
      setOaPromptReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Chỉ cần biết TỔNG số đơn (limit=1) để suy ra đây có phải đơn đầu tiên hay không — không tải
  // danh sách đầy đủ. Chỉ gọi khi còn khả năng hiện thẻ (chưa hỏi bao giờ + đã đọc xong cờ máy),
  // tránh gọi API thừa mỗi lần khách mở lại một đơn cũ sau khi đã được hỏi.
  const ordersTotalQ = useQuery({
    queryKey: ['orders-total-for-oa-prompt'],
    queryFn: () => fetchOrders({}, 1, 1),
    enabled: hasOA && oaPromptReady && !oaPromptSeen && !!order.data,
  });

  // Đếm ngược theo giờ máy chủ chỉ khi đơn còn chờ khách chuyển khoản; hook phải đứng trước các return sớm.
  const deadlineLeft = useCountdown(
    order.data?.status === 'PENDING_PAYMENT' && !order.data.manualHandling ? (order.data.paymentDeadline ?? null) : null,
  );

  const wasteQ = useQuery({
    queryKey: [...WASTE_QUERY_KEYS.all, 'by-order', order.data?.id],
    queryFn: () => getWasteRequestByOrder(order.data!.id),
    enabled: !!order.data?.hasRecyclingPickup,
    retry: (n, e) => !isNotFoundError(e) && n < 2,
  });

  const showOaPrompt = shouldShowFollowOaPrompt({
    hasOA,
    promptSeen: oaPromptSeen,
    ordersTotal: ordersTotalQ.data?.meta.total,
  });

  const handleFollowOaPrompt = async () => {
    setOaBusy(true);
    const followed = await followOA();
    if (followed) await requestNotifyPermission().catch(() => false);
    await setOaPromptState({ promptSeen: true, followed });
    setOaBusy(false);
    setOaPromptSeen(true);
    haptic(followed ? 'medium' : 'light');
    openSnackbar(
      followed
        ? { text: 'Đã theo dõi Tubu Tree trên Zalo!', type: 'success' }
        : { text: 'Không theo dõi được lúc này — bạn có thể thử lại trong Cài đặt.', type: 'error' },
    );
  };

  const handleDismissOaPrompt = () => {
    void setOaPromptState({ promptSeen: true });
    setOaPromptSeen(true);
  };

  const cancel = useMutation({
    mutationFn: ({ choose, reason }: { choose: boolean; reason: CancelReasonCode }) =>
      cancelOrder(code!, choose ? destinationBody(cancelMethod, cancelBank) : undefined, cancelReasonBody(reason, cancelReasonText)),
    onSuccess: (cancelled) => {
      // Gộp phản hồi huỷ vào cache NGAY (trạng thái mới → ẩn "Hủy đơn"/"Thanh toán ngay" tức thì) nhưng GIỮ
      // `items` cũ: phản hồi huỷ không kèm ảnh/tồn kho các dòng nên ghi đè cả object sẽ làm ReorderSheet
      // coi mọi dòng còn hàng. Sau đó refetch để có đủ dữ liệu.
      queryClient.setQueryData<OrderView>(['order', code], (old) => (old ? { ...old, ...cancelled, items: old.items } : old));
      void queryClient.invalidateQueries({ queryKey: ['order', code] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['my-refunds'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
      setConfirmCancel(false);
      haptic('medium');
      openSnackbar({ text: vi.orders.cancelled, type: 'success' });
    },
    onError: (e: unknown) => {
      setConfirmCancel(false);
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Kho đã bàn giao vận chuyển: BE vừa đồng bộ trạng thái mới — tải lại để ẩn nút huỷ.
      void queryClient.invalidateQueries({ queryKey: ['order', code] });
    },
  });

  const skeleton = (
    <Box p={4} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Skeleton height={64} radius="var(--radius-card)" />
      <LineItemSkeleton />
      <Skeleton height={120} radius="var(--radius-card)" />
    </Box>
  );

  if (phase !== 'authenticated') {
    return (
      <Shell>
        <AuthPhaseView phase={phase} loading={skeleton} />
      </Shell>
    );
  }

  if (order.isLoading) return <Shell>{skeleton}</Shell>;

  // Chỉ thay cả trang bằng màn lỗi khi KHÔNG có dữ liệu: refetch lỗi sau khi huỷ thành công không được làm trắng trang.
  if (!order.data) {
    return (
      <Shell>
        {isNotFoundError(order.error) ? (
          <ErrorState message="Không tìm thấy đơn hàng này." onRetry={() => undefined} onHome={() => navigate('/')} />
        ) : (
          <ErrorState message={getLoadErrorMessage(order.error)} onRetry={() => void order.refetch()} />
        )}
      </Shell>
    );
  }

  const o = order.data;
  const wasteReq = wasteQ.data;
  const color = STATUS_COLOR[o.status] ?? STATUS_COLOR.CONFIRMED!;
  // Đơn CTV lên hộ khách: OrderDTO chung chưa khai báo 2 cột này dù API trả nguyên bản ghi đơn.
  const assisted = o as { placedForCustomer?: boolean; referrerUserId?: string | null };
  const stamp = orderStamp(o);
  const etaLabel = publicConfig.isLoaded ? orderDeliveryEtaLabel(publicConfig.shippingEta, o) : null;
  const discounts = discountRows(o);
  // Sản phẩm đã gỡ thì trang sản phẩm trả 404: dòng vẫn hiện, chỉ không dẫn đi đâu.
  const itemLinks = o.items.map((it) => ({ it, slug: openProductSlug(it) }));
  const returnDays = publicConfig.returnWindowDays ?? 7;
  const refundMode = cancelRefundMode(o);
  const cancelBankError = refundMode === 'choose' && cancelMethod === 'BANK' ? bankDetailsError(cancelBank) : null;
  const orderReturns = (myReturns.data ?? []).filter((r) => r.orderId === o.id);
  const pointsReversed = orderReturns.filter((r) => r.status === 'APPROVED').reduce((sum, r) => sum + (r.pointsReversed ?? 0), 0);
  const pointsNote = orderPointsNote(o.status, o.pointsEarned, pointsReversed, o.pointsReturnReversed);
  const remaining = remainingByLine(o.items, orderReturns);
  const tOrder: TrackOrder = { ...o, ...assisted };
  const ctx = {
    now: serverNow(),
    userId: meId,
    etaLabel,
    returnDays,
    deadlineLeft,
    pendingReturn: orderReturns.some((r) => r.status === 'REQUESTED'),
    returnableLeft: [...remaining.values()].some((q) => q > 0),
  };
  const headline = orderHeadline(tOrder, ctx);
  const plan = orderActionPlan(tOrder, ctx);
  const trackView = orderTrack(tOrder, { etaLabel });
  const timelineSteps = buildOrderTimelineSteps(o.status, orderTimelineStamps(tOrder));
  const shareText = formatOrderShareSummary({
    code: o.code,
    items: o.items.map((it) => ({ name: it.variationName && it.variationName !== it.productName ? `${it.productName} (${it.variationName})` : it.productName, quantity: it.quantity })),
    totalAmount: o.total,
  });
  // Đơn không có hành trình 5 bước (huỷ/hoàn) mới in mốc hãng riêng; lịch sử toàn dòng rác thì không dựng khung trống.
  const historyEvents = trackView ? [] : shippingEvents(o.shippingHistory);
  const payNote = plan.primary === 'pay' && deadlineLeft ? fillCopy('order.action.payLeft', { t: deadlineLeft }) : null;

  const onAction = (kind: OrderActionKind) => {
    haptic('light');
    if (kind === 'pay') navigate(`/bank-payment/${o.code}`);
    else if (kind === 'cancel') setConfirmCancel(true);
    else if (kind === 'contact') setContactOpen(true);
    else if (kind === 'reorder') setReorderTarget(orderReorderTarget(o));
    else if (kind === 'return') {
      setReturnKey((k) => k + 1);
      setReturnOpen(true);
    } else {
      const item = o.items.find((it) => it.id === plan.reviewItemId);
      const slug = item ? openProductSlug(item) : null;
      if (slug) navigate(`/product/${slug}`, { state: { reviewOrderId: o.id } });
    }
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 96 }}>
      <PageHeader title="Chi tiết đơn hàng" subtitle={o.code} />

      <OrderStatusHero headline={headline} statusLabel={buyerStatusLabel(o)} stamp={stamp} tone={color} />

      {/* ── Mời theo dõi OA (đơn đầu tiên) — finding A3-01 nửa 2, xem shouldShowFollowOaPrompt.
          Đúng lúc thiện chí cao nhất (vừa đặt xong đơn đầu), không hỏi lúc mở app nguội. ── */}
      {showOaPrompt && (
        <Box
          mx={4}
          mt={2}
          p={3}
          style={{ background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-card)', border: '1px solid var(--forest-200)' }}
        >
          <Text bold size="small" style={{ color: 'var(--forest-800)' }}>
            Theo dõi Tubu Tree trên Zalo
          </Text>
          <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Nhận cập nhật đơn và tư vấn từ Tubu Tree qua Zalo — không bỏ lỡ tin quan trọng.
          </Text>
          <Box flex style={{ gap: 8, marginTop: 10 }}>
            <Button size="md" loading={oaBusy} onPress={() => void handleFollowOaPrompt()}>
              Theo dõi ngay
            </Button>
            <Button size="md" variant="ghost" disabled={oaBusy} onPress={handleDismissOaPrompt} style={{ color: 'var(--color-text-tertiary)' }}>
              Để sau
            </Button>
          </Box>
        </Box>
      )}

      {/* ── Tiến trình 4 bước nhìn một cái là biết đơn đang ở đâu, kèm nút chép thông tin đơn ── */}
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
        <OrderTimelineTracker steps={timelineSteps} now={ctx.now} shareText={shareText} />
      </Box>

      {/* ── Hành trình: bước chuẩn kèm giờ thật, mốc hãng gộp dưới "Đang giao" ── */}
      {trackView && (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <Text bold size="small" style={{ marginBottom: 12 }}>
            {vi.orders.timeline}
          </Text>
          <OrderTrack track={trackView} now={ctx.now} />
        </Box>
      )}

      {(o.shippingPartner || o.shippingCode || historyEvents.length > 0) && (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <OrderShipping
            partner={o.shippingPartner}
            code={o.shippingCode}
            status={o.shippingStatus ? shippingEventLabel(o.shippingStatus) : null}
            events={trackView ? undefined : historyEvents}
          />
        </Box>
      )}

      {/* ── Sản phẩm ── */}
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>
          {vi.orders.products}
        </Text>
        {itemLinks.map(({ it, slug }) => (
          <Box key={it.id} style={{ padding: '6px 0' }}>
            <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 12 }}>
              {/* Chạm vào món để mở lại trang sản phẩm (xem hướng dẫn dùng, mua riêng món này). */}
              <Box
                flex
                alignItems="center"
                className={slug ? 'tubu-press' : undefined}
                role={slug ? 'link' : undefined}
                {...(slug ? rowKeyboardProps() : {})}
                aria-label={slug ? `Xem sản phẩm ${it.productName}` : undefined}
                onClick={slug ? () => navigate(`/product/${slug}`) : undefined}
                style={{ gap: 12, flex: 1, minWidth: 0, minHeight: 48, cursor: slug ? 'pointer' : undefined }}
              >
                <ProductThumb src={it.thumbnail} alt="" size={48} />
                <Text size="small" style={{ flex: 1, minWidth: 0 }}>
                  {it.productName} · {it.variationName}{' '}
                  <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', display: 'inline', fontVariantNumeric: 'tabular-nums' }}>
                    ×{it.quantity}
                  </Text>
                </Text>
              </Box>
              <Text size="small" style={{ flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' }}>
                {formatVnd(it.total)}
              </Text>
            </Box>
            {/* Đơn đại lý đặt vượt tồn kho hiện tại — phần này chờ nhập hàng, chưa xuất kho
                (DealerBackorderService lấp dần theo tồn về, FIFO theo đơn cũ trước). */}
            {it.backorderedQty > 0 && (
              <Badge tone="warning" size="sm" style={{ display: 'inline-block', marginTop: 4 }}>
                Đặt trước {it.backorderedQty}/{it.quantity} — chờ hàng về
              </Badge>
            )}
            {/* Lối vào đánh giá: trước đây nhận hàng xong KHÔNG có đường nào để đánh giá —
                chữ "đánh giá" chỉ tồn tại ở trang sản phẩm, mà từ đơn không mở được trang đó
                (OrderItem không lưu slug). Nay snapshot productSlug nên dẫn thẳng được.
                Mỗi lần mua một đánh giá: dòng đã đánh giá ở đơn này thì mở sửa đúng đánh giá đó; API cũ chưa trả
                reviewable/reviewId thì vẫn hiện nút viết như trước. */}
            {o.status === 'DELIVERED' && slug && (it.reviewId || it.reviewable !== false) && (
              <Text
                size="xSmall"
                bold
                className="tubu-press tubu-hit-44"
                role="button"
                {...rowKeyboardProps()}
                style={{ color: 'var(--color-text-brand)', marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => {
                  haptic('light');
                  navigate(`/product/${slug}`, { state: { reviewOrderId: o.id } });
                }}
              >
                <Icon icon={Star} size="sm" tone="brand" />
                {it.reviewId ? vi.orders.editReviewItem : vi.orders.reviewItem}
              </Text>
            )}
          </Box>
        ))}
      </Box>

      {/* ── Tóm tắt tiền ── */}
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
        <KeyValueRow label={vi.cart.subtotal} value={formatVnd(o.subtotal)} />
        {discounts.map((d) => (
          <KeyValueRow key={d.label} label={d.label} value={`-${formatVnd(d.amount)}`} tone="success" />
        ))}
        {/* Đơn cũ chỉ có tổng giảm giá: nói số điểm đã dùng nằm trong dòng trên, không phải một khoản trừ nữa. */}
        {o.pointsUsed > 0 && !o.pointsDiscount && (
          <KeyValueRow label={vi.orders.pointsUsed} value={formatPoints(o.pointsUsed)} />
        )}
        <KeyValueRow
          label={vi.checkout.shippingFee}
          value={o.shippingFee === 0 ? vi.common.freeShip : formatVnd(o.shippingFee)}
          tone={o.shippingFee === 0 ? 'success' : 'primary'}
        />
        <KeyValueRow label={vi.checkout.total} value={formatVnd(o.total)} emphasis />
        <KeyValueRow label={vi.orders.paymentLabel} value={vi.paymentMethod[o.paymentMethod] ?? o.paymentMethod} />
        {pointsNote && (
          <Text
            size="xSmall"
            style={{
              color: pointsNote.tone === 'success' ? 'var(--color-text-success)' : 'var(--color-text-secondary)',
              marginTop: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Icon icon={Leaf} size="sm" tone={pointsNote.tone === 'success' ? 'brand' : 'muted'} />
            {pointsNote.text}
          </Text>
        )}
      </Box>

      {/* Đơn do gian hàng đối tác tự giao (D4): khách cần biết ai giao và liên hệ ai; đơn tách cùng lần đặt dẫn qua lại. */}
      {(o.fulfilment?.kind === 'MERCHANT' || (o.siblings?.length ?? 0) > 0) && (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          {o.fulfilment && (
            <>
              <Text bold size="small">
                Giao bởi {o.fulfilment.name}
              </Text>
              {o.fulfilment.kind === 'MERCHANT' && (
                <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  Gian hàng tự đóng gói và giao đơn này.
                  {o.fulfilment.phone ? ` Liên hệ gian hàng: ${o.fulfilment.phone}` : ''}
                </Text>
              )}
            </>
          )}
          {o.siblings && o.siblings.length > 0 && (
            <section aria-label="Đơn cùng lần đặt" style={{ marginTop: o.fulfilment ? 12 : 0 }}>
              <Text bold size="small" style={{ marginBottom: 6 }}>
                Đơn cùng lần đặt
              </Text>
              {o.siblings.map((sb) => (
                <Box
                  key={sb.code}
                  role="link"
                  {...rowKeyboardProps()}
                  aria-label={`Xem đơn ${sb.code}, ${sb.fulfillerName} giao`}
                  className="tubu-press"
                  onClick={() => navigate(`/order/${sb.code}`)}
                  flex
                  alignItems="center"
                  justifyContent="space-between"
                  style={{ gap: 8, minHeight: 44, cursor: 'pointer', borderTop: '1px solid var(--color-border-subtle)' }}
                >
                  <Box style={{ minWidth: 0 }}>
                    <Text size="small" bold style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {sb.code}
                    </Text>
                    <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
                      {sb.fulfillerName} giao · {vi.orderStatus[sb.status] ?? sb.status}
                    </Text>
                  </Box>
                  <Text size="small" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {formatVnd(sb.total)}
                  </Text>
                </Box>
              ))}
            </section>
          )}
        </Box>
      )}

      {showsRefundPanel(o) && <OrderRefunds orderId={o.id} />}

      {/* ── Hoá đơn VAT (nếu có) ── */}
      {o.invoiceStatus && o.invoiceStatus !== 'NOT_REQUESTED' && (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <Text bold size="small" style={{ marginBottom: 4 }}>
            Hoá đơn VAT
          </Text>
          <Box flex alignItems="center" justifyContent="space-between">
            <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
              {o.invoiceStatus === 'ISSUED'
                ? 'Đã phát hành'
                : o.invoiceStatus === 'REQUESTED'
                  ? 'Đang xử lý'
                  : INVOICE_ISSUE_FAILED}
            </Text>
            {o.invoiceUrl && (
              <Button
                variant="secondary"
                onPress={() => {
                  haptic('light');
                  void copyText(o.invoiceUrl!).then((ok) =>
                    openSnackbar(
                      ok
                        ? { text: 'Đã sao chép đường dẫn hoá đơn. Dán vào trình duyệt để tải.', type: 'success' }
                        : { text: 'Không sao chép được đường dẫn hoá đơn.', type: 'error' },
                    ),
                  );
                }}
              >
                Chép đường dẫn
              </Button>
            )}
          </Box>
        </Box>
      )}

      {/* ── Yêu cầu thu rác kèm đơn (§12.2) ── */}
      {wasteReq && (
        <Box id="order-waste-request" mt={2}>
          <ListRow
            icon={<Icon icon={Recycle} tone="brand" />}
            title={`Yêu cầu thu rác ${wasteReq.code}`}
            subtitle="Xem tiến độ thu rác kèm đơn"
            trailing="chevron"
            onPress={() => navigate(`/recycle/r/${wasteReq.id}`)}
          />
        </Box>
      )}

      {/* ── Địa chỉ nhận ── */}
      {/* Đơn đại lý không có địa chỉ khách lẻ (giao theo hợp đồng) — snapshot chỉ có `note`.
          Render thẳng các trường rỗng sẽ ra dòng "· " trơ trọi, nên rơi về ghi chú giao hàng. */}
      {(() => {
        const addr = o.shippingAddress as typeof o.shippingAddress & { note?: string | null };
        const line = addressLine(addr);
        const hasContact = !!(addr.recipient || addr.phone);
        if (!hasContact && !line) {
          return addr.note ? (
            <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
              <Text bold size="small" style={{ marginBottom: 4 }}>
                {vi.checkout.address}
              </Text>
              <Text size="small" style={{ color: 'var(--color-text-secondary)' }}>
                {addr.note}
              </Text>
            </Box>
          ) : null;
        }
        return (
          <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
            <Text bold size="small" style={{ marginBottom: 4 }}>
              {vi.checkout.address}
            </Text>
            <Text size="small">{[addr.recipient, addr.phone].filter(Boolean).join(' · ')}</Text>
            {line && (
              <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
                {line}
              </Text>
            )}
          </Box>
        );
      })()}

      {customerOrderNote(o) ? (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <Text bold size="small" style={{ marginBottom: 4 }}>
            {vi.orders.note}
          </Text>
          <Text size="small" style={{ color: 'var(--color-text-secondary)', whiteSpace: 'pre-line' }}>
            {customerOrderNote(o)}
          </Text>
        </Box>
      ) : (
        // Ghi chú cố định của hệ thống không phải lời khách viết: thay bằng nhãn.
        isSubscriptionOrder(o) && (
          <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
            <Text bold size="small">
              Đơn định kỳ
            </Text>
            <Text size="small" style={{ color: 'var(--color-text-secondary)' }}>
              Đơn này tự đặt theo lịch bạn đã chọn.
            </Text>
          </Box>
        )
      )}

      {/* Đổi/trả theo dòng (D3) — mỗi yêu cầu một khung trạng thái */}
      {(o.status === 'DELIVERED' || o.status === 'RETURNED') &&
        orderReturns.map((ret, idx) => {
          const retIcon: { icon: LucideIcon; tone: IconProps['tone'] } =
            ret.status === 'APPROVED'
              ? { icon: CheckCircle2, tone: 'brand' }
              : ret.status === 'REJECTED'
                ? { icon: XCircle, tone: 'danger' }
                : { icon: Clock, tone: 'muted' };
          const retColor =
            ret.status === 'APPROVED'
              ? 'var(--color-text-success)'
              : ret.status === 'REJECTED'
                ? 'var(--color-text-danger)'
                : 'var(--color-text-secondary)';
          const linesText = returnLinesText(ret, o.items);
          return (
            <Box key={ret.id ?? idx} mx={4} mt={2} p={3} style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-control)' }}>
              <Text size="xSmall" style={{ color: retColor, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon icon={retIcon.icon} size="sm" tone={retIcon.tone} />
                {returnStatusLabel(ret, refundOfReturn(myRefunds.data, ret.id), !!assisted.placedForCustomer)}
              </Text>
              {linesText && (
                <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
                  Trả: {linesText}
                </Text>
              )}
              {ret.status === 'APPROVED' && !!ret.items?.length && (
                <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  {ret.receivedAt ? 'Tubu đã nhận lại hàng.' : 'Tubu sẽ liên hệ để nhận lại hàng.'}
                </Text>
              )}
            </Box>
          );
        })}
      <Box p={4}>
        <SupportContact orderCode={o.code} />
      </Box>

      <OrderActionBar plan={plan} returnMore={orderReturns.some((r) => r.status === 'APPROVED')} note={payNote} busy={cancel.isPending} onAction={onAction} />

      <BottomSheet open={contactOpen} onClose={() => setContactOpen(false)} title={fillCopy('order.action.contact')}>
        <SupportContact orderCode={o.code} />
      </BottomSheet>

      {/* ── Confirm huỷ (DI #10): giữ đơn là primary. Đơn đã trả tiền: khách chọn nơi nhận tiền hoàn (D2). ── */}
      <Sheet visible={confirmCancel} onClose={() => setConfirmCancel(false)} autoHeight>
        <Box p={5}>
          <Box style={{ textAlign: 'center' }}>
            <Text.Title size="small">{vi.orders.cancelConfirmTitle}</Text.Title>
            <Text size="small" style={{ color: 'var(--color-text-secondary)', marginTop: 6 }}>
              {vi.orders.cancelConfirmBody}
            </Text>
          </Box>
          <Box mt={4}>
            <CancelReasonPicker
              code={cancelReason}
              onCode={setCancelReason}
              text={cancelReasonText}
              onText={setCancelReasonText}
              showError={cancelTouched}
            />
          </Box>
          {refundMode === 'choose' && (
            <Box mt={4}>
              <RefundDestinationPicker
                method={cancelMethod}
                onMethod={setCancelMethod}
                bank={cancelBank}
                onBank={setCancelBank}
                showBankErrors={cancelTouched}
                amountLabel={formatVnd(o.total)}
              />
            </Box>
          )}
          {refundMode === 'wallet' && (
            <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', marginTop: 12, textAlign: 'center' }}>
              {`${formatVnd(o.total)} được hoàn ngay vào Ví Tubu.`}
            </Text>
          )}
          {refundMode === 'unpaidTransfer' && (
            <Box mt={3} p={3} role="note" style={{ background: 'var(--color-status-warning-bg)', borderRadius: 'var(--radius-control)' }}>
              <Text size="xSmall" style={{ color: 'var(--color-status-warning-fg)' }}>
                Nếu bạn vừa chuyển khoản, Tubu có thể cần vài phút để ghi nhận — hãy chờ thêm thay vì huỷ. Tiền về sau khi huỷ vẫn
                được hoàn: bạn chọn nhận về Ví Tubu hoặc tài khoản ngân hàng ở chi tiết đơn.
              </Text>
            </Box>
          )}
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
            <Button fullWidth onPress={() => setConfirmCancel(false)}>
              {vi.orders.cancelKeep}
            </Button>
            <Button
              fullWidth
              variant="ghost"
              loading={cancel.isPending}
              onPress={() => {
                setCancelTouched(true);
                if (!cancelReason || cancelBankError) return;
                cancel.mutate({ choose: refundMode === 'choose', reason: cancelReason });
              }}
              style={{ color: 'var(--color-text-danger)' }}
            >
              {vi.orders.cancelYes}
            </Button>
          </Box>
        </Box>
      </Sheet>

      <ReturnRequestSheet
        key={returnKey}
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        order={o}
        returns={orderReturns}
        returnDays={returnDays}
      />

      {/* Mua lại cả đơn qua sheet dùng chung (spec §3.3) — chọn dòng, dòng hết hàng bị khoá. */}
      <ReorderSheet target={reorderTarget} source="order_detail" navigateToCart onClose={() => setReorderTarget(null)} />
    </Page>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Chi tiết đơn hàng" />
      {children}
    </Page>
  );
}
