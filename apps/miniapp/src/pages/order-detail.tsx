import { useEffect, useState } from 'react';
import { Box, Page, Text, Sheet, useParams, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Recycle, Star, Leaf, CheckCircle2, XCircle, Clock, type LucideIcon } from 'lucide-react';
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
  formatDateTime,
  addressLine,
} from '../utils/format';
import { journeyEventLabel, journeyEvents, shippingEventLabel } from '../utils/format-shipping';
import {
  STATUS_COLOR,
  buyerStatusLabel,
  canCustomerCancel,
  isReorderable,
  isHandedToCarrier,
  orderPointsNote,
  orderStamp,
  stepTime,
  returnWindowState,
  timelineIndex,
  timelineStepsFor,
  discountRows,
} from '../utils/order-status';
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
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Button } from '../components/ui/button';
import { ListRow } from '../components/ui/list-row';
import { ProductThumb } from '../components/ui/product-thumb';
import { ReorderSheet } from '../components/reorder/reorder-sheet';
import { CancelReasonPicker } from '../components/orders/cancel-reason-picker';
import { orderCopy } from '@tubutree/app-core/account-copy';
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
  bankDetailsError,
  canPayOrderNow,
  cancelRefundMode,
  destinationBody,
  remainingByLine,
  refundOfReturn,
  returnLinesText,
  returnStatusLabel,
  showsPaymentDeadline,
  showsRefundPanel,
  type RefundBankInput,
  type RefundMethodChoice,
} from '../utils/refund-rules';

export default function OrderDetailPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const publicConfig = usePublicConfig();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
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
  const journey = journeyEvents(o.shippingHistory);
  // Đơn CTV lên hộ khách: OrderDTO chung chưa khai báo 2 cột này dù API trả nguyên bản ghi đơn.
  const assisted = o as { placedForCustomer?: boolean; referrerUserId?: string | null };
  const canCancel = canCustomerCancel({ ...o, ...assisted }, meId);
  // Đơn chuyển khoản chưa trả tiền: trước đây màn QR (/bank-payment/:code) CHỈ tới được đúng
  // một lần ngay sau khi đặt hàng (checkout.tsx). Rời khỏi đó là mất luôn mã QR/số tài khoản —
  // khách muốn trả tiền cũng không có đường quay lại, chỉ còn cách huỷ đơn rồi đặt lại.
  // Hàng đã bàn giao vận chuyển mà chưa nhận tiền: CSKH thống nhất với khách cách trả (chuyển khoản hay hãng thu hộ) — không
  // mời trả tiền thêm ở đây để khách không trả hai lần (R5-SYNC-1).
  const canPayNow = canPayOrderNow(o);
  const isDone = o.status === 'DELIVERED' || o.status === 'CANCELLED' || o.status === 'RETURNED';
  const stamp = orderStamp(o);
  const etaLabel = publicConfig.isLoaded ? orderDeliveryEtaLabel(publicConfig.shippingEta, o) : null;
  const timelineSteps = timelineStepsFor(o.paymentMethod);
  const discounts = discountRows(o);
  const returnDays = publicConfig.returnWindowDays ?? 7;
  const returnWindow = returnWindowState(o, returnDays);
  const refundMode = cancelRefundMode(o);
  const cancelBankError = refundMode === 'choose' && cancelMethod === 'BANK' ? bankDetailsError(cancelBank) : null;
  const orderReturns = (myReturns.data ?? []).filter((r) => r.orderId === o.id);
  const pointsReversed = orderReturns.filter((r) => r.status === 'APPROVED').reduce((sum, r) => sum + (r.pointsReversed ?? 0), 0);
  const pointsNote = orderPointsNote(o.status, o.pointsEarned, pointsReversed, o.pointsReturnReversed);
  const remaining = remainingByLine(o.items, orderReturns);
  const canRequestMore =
    o.status === 'DELIVERED' && !orderReturns.some((r) => r.status === 'REQUESTED') && [...remaining.values()].some((q) => q > 0);

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 96 }}>
      <PageHeader title="Chi tiết đơn hàng" subtitle={o.code} />

      {/* ── Status hero ── */}
      <Box p={4} style={{ background: color.bg }}>
        {/* Không dùng opacity để làm dòng phụ: nó kéo cặp màu trạng thái xuống dưới 4,5:1 (chờ thanh toán 3,84).
            Thứ bậc đã có từ cỡ xSmall dưới tiêu đề đậm. */}
        <Text size="xSmall" style={{ color: color.fg }}>
          {stamp.label} <span>{formatDateTime(stamp.at)}</span>
        </Text>
        <Text.Title size="small" style={{ color: color.fg }}>
          {buyerStatusLabel(o)}
        </Text.Title>
        {etaLabel && (
          <Text size="xSmall" style={{ color: color.fg, marginTop: 4 }}>
            {orderCopy.etaLine(etaLabel)}
          </Text>
        )}
        {o.manualHandling ? (
          <Text size="xSmall" style={{ color: color.fg, marginTop: 4 }}>
            {vi.orders.manualHandling}
          </Text>
        ) : (
          showsPaymentDeadline(o) && (
            <Text size="xSmall" style={{ color: color.fg, marginTop: 4 }}>
              Thanh toán trước <b>{formatDateTime(o.paymentDeadline)}</b> — quá hạn đơn sẽ tự huỷ.
            </Text>
          )
        )}
      </Box>

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

      {/* ── Timeline (DI #9) ── */}
      {timelineIndex(o.status, timelineSteps) >= 0 && (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <Text bold size="small" style={{ marginBottom: 12 }}>
            {vi.orders.timeline}
          </Text>
          <Timeline
            steps={timelineSteps}
            current={timelineIndex(o.status, timelineSteps)}
            times={timelineSteps.map((s, i) => stepTime(o, s, i, timelineIndex(o.status, timelineSteps)))}
            etaLabel={etaLabel}
          />
        </Box>
      )}

      {/* ── Sản phẩm ── */}
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>
          {vi.orders.products}
        </Text>
        {o.items.map((it) => (
          <Box key={it.id} style={{ padding: '6px 0' }}>
            <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 12 }}>
              {/* Chạm vào món để mở lại trang sản phẩm (xem hướng dẫn dùng, mua riêng món này). */}
              <Box
                flex
                alignItems="center"
                className={it.productSlug ? 'tubu-press' : undefined}
                role={it.productSlug ? 'link' : undefined}
                {...(it.productSlug ? rowKeyboardProps() : {})}
                aria-label={it.productSlug ? `Xem sản phẩm ${it.productName}` : undefined}
                onClick={it.productSlug ? () => navigate(`/product/${it.productSlug}`) : undefined}
                style={{ gap: 12, flex: 1, minWidth: 0, minHeight: 48, cursor: it.productSlug ? 'pointer' : undefined }}
              >
                <ProductThumb src={it.thumbnail} alt="" size={48} />
                <Text size="small" style={{ flex: 1, minWidth: 0 }}>
                  {it.productName} · {it.variationName}{' '}
                  <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', display: 'inline' }}>
                    ×{it.quantity}
                  </Text>
                </Text>
              </Box>
              <Text size="small" style={{ flex: '0 0 auto' }}>
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
            {o.status === 'DELIVERED' && it.productSlug && (it.reviewId || it.reviewable !== false) && (
              <Text
                size="xSmall"
                bold
                className="tubu-press tubu-hit-44"
                role="button"
                {...rowKeyboardProps()}
                style={{ color: 'var(--color-text-brand)', marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => {
                  haptic('light');
                  navigate(`/product/${it.productSlug}`, { state: { reviewOrderId: o.id } });
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
                    <Text size="small" bold>
                      {sb.code}
                    </Text>
                    <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
                      {sb.fulfillerName} giao · {vi.orderStatus[sb.status] ?? sb.status}
                    </Text>
                  </Box>
                  <Text size="small" style={{ whiteSpace: 'nowrap' }}>
                    {formatVnd(sb.total)}
                  </Text>
                </Box>
              ))}
            </section>
          )}
        </Box>
      )}

      {showsRefundPanel(o) && <OrderRefunds orderId={o.id} />}

      {/* ── Vận chuyển (hãng VC + mã vận đơn + hành trình) §6.4 ── */}
      {(o.shippingCode || journey.length > 0) && (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <Text bold size="small" style={{ marginBottom: 6 }}>
            Vận chuyển
          </Text>
          <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 8 }}>
            <Box style={{ flex: 1 }}>
              {o.shippingPartner && <Text size="small">{o.shippingPartner}</Text>}
              {o.shippingCode && (
                <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
                  Mã vận đơn: <b>{o.shippingCode}</b>
                </Text>
              )}
              {o.shippingStatus && (
                <Text size="xSmall" style={{ color: 'var(--color-text-success)' }}>
                  {shippingEventLabel(o.shippingStatus)}
                </Text>
              )}
            </Box>
            {o.shippingCode && (
              <Button
                variant="secondary"
                onPress={() => {
                  haptic('light');
                  void copyText(o.shippingCode!).then((ok) =>
                    openSnackbar(
                      ok
                        ? { text: 'Đã sao chép mã vận đơn', type: 'success' }
                        : { text: 'Không sao chép được — hãy chép mã thủ công.', type: 'error' },
                    ),
                  );
                }}
              >
                Chép mã
              </Button>
            )}
          </Box>

          {journey.length > 0 && (
            <Box mt={3}>
              {journey.map((ev, i) => (
                <Box key={i} flex style={{ gap: 10 }}>
                  <Box flex flexDirection="column" alignItems="center" style={{ flex: '0 0 auto' }}>
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        background: i === 0 ? 'var(--color-action-primary-bg)' : 'var(--stone-300)',
                        marginTop: 4,
                      }}
                    />
                    {i < journey.length - 1 && (
                      <span style={{ width: 2, flex: 1, background: 'var(--color-border-subtle)', marginTop: 2 }} />
                    )}
                  </Box>
                  <Box style={{ flex: 1, paddingBottom: 12 }}>
                    <Text
                      size="xSmall"
                      style={{
                        color: i === 0 ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                        fontWeight: i === 0 ? 600 : 400,
                      }}
                    >
                      {journeyEventLabel(ev)}
                    </Text>
                    {ev.at && (
                      <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                        {formatDateTime(ev.at)}
                      </Text>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}

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
                  : 'Phát hành lỗi — vui lòng liên hệ hỗ trợ'}
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

      {o.note && (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <Text bold size="small" style={{ marginBottom: 4 }}>
            {vi.orders.note}
          </Text>
          <Text size="small" style={{ color: 'var(--color-text-secondary)', whiteSpace: 'pre-line' }}>
            {o.note}
          </Text>
        </Box>
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
      {canRequestMore && !returnWindow.open && (
        <Box mx={4} mt={2} p={3} style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-control)' }}>
          <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
            {`Đã quá hạn đổi/trả (${returnDays} ngày kể từ khi nhận hàng). Cần hỗ trợ thêm, vui lòng liên hệ Tubu bên dưới.`}
          </Text>
        </Box>
      )}
      {canRequestMore && returnWindow.open && (
        <Box px={4} mt={2} style={{ textAlign: 'center' }}>
          <Button
            variant="ghost"
            icon={RotateCcw}
            onPress={() => {
              setReturnKey((k) => k + 1);
              setReturnOpen(true);
            }}
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {orderReturns.some((r) => r.status === 'APPROVED') ? 'Trả thêm sản phẩm' : 'Yêu cầu đổi/trả'}
          </Button>
        </Box>
      )}

      {!canCancel && isHandedToCarrier(o) && (
        <Box px={4} pt={4}>
          <Text size="small" style={{ color: 'var(--color-text-secondary)' }}>
            {vi.orders.cancelClosedAfterHandover}
          </Text>
        </Box>
      )}

      <Box p={4}>
        <SupportContact orderCode={o.code} />
      </Box>

      {/* ── Action bar — 4 tổ hợp gốc: (huỷ+thanh toán ngay) / (chỉ huỷ) / (chỉ mua lại) /
          (chỉ xem tất cả đơn) — giữ nguyên 4 điều kiện gốc, chỉ đổi vỏ trình bày. ── */}
      <StickyActionBar
        primary={
          <Box flex style={{ gap: 10 }}>
            {canCancel && (
              <Button
                variant="secondary"
                onPress={() => {
                  haptic('light');
                  setConfirmCancel(true);
                }}
                style={{ flex: 1, color: 'var(--color-text-danger)' }}
              >
                {vi.orders.cancelOrder}
              </Button>
            )}
            {canPayNow && (
              /* Hành động CHÍNH của đơn chờ chuyển khoản — đặt sau nút Huỷ để nằm bên phải (vị trí
                 ngón cái) và tô đặc, tránh việc "Huỷ đơn" là nút nổi bật duy nhất. */
              <Button
                onPress={() => {
                  haptic('light');
                  navigate(`/bank-payment/${o.code}`);
                }}
                style={{ flex: 1, fontWeight: 700 }}
              >
                {vi.orders.payNow}
              </Button>
            )}
            {isReorderable(o.status) && (
              <Button
                onPress={() => {
                  haptic('light');
                  setReorderTarget(orderReorderTarget(o));
                }}
                style={{ flex: 1, fontWeight: 600 }}
              >
                {vi.orders.repurchase}
              </Button>
            )}
            {!canCancel && !isDone && (
              <Button variant="ghost" fullWidth onPress={() => navigate('/orders')}>
                {/* Nút này đi tới DANH SÁCH đơn — trước đây dùng nhãn "Về trang chủ" nên bấm xong
                    khách rơi lại vào danh sách đơn thay vì trang chủ như chữ hứa. */}
                {vi.orders.viewAllOrders}
              </Button>
            )}
          </Box>
        }
      />

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

/** Timeline dọc 5 bước — bước hiện tại pulse, bước qua tick lá. */
function Timeline({
  steps,
  current,
  times,
  etaLabel,
}: {
  steps: readonly string[];
  current: number;
  times?: readonly (string | null)[];
  etaLabel?: string | null;
}) {
  return (
    <Box style={{ display: 'flex', flexDirection: 'column' }}>
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <Box key={step} flex style={{ gap: 12, minHeight: i === steps.length - 1 ? 24 : 44 }}>
            <Box style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span
                className={active ? 'tubu-pulse' : undefined}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  flex: '0 0 auto',
                  background: done || active ? 'var(--color-action-primary-bg)' : 'var(--stone-100)',
                  border: `2px solid ${done || active ? 'var(--color-action-primary-bg)' : 'var(--stone-200)'}`,
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {done && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M2.5 6.5l2.5 2.5 4.5-5.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {i < steps.length - 1 && (
                <span
                  style={{
                    width: 2,
                    flex: 1,
                    background: done ? 'var(--color-action-primary-bg)' : 'var(--stone-200)',
                    marginTop: 2,
                    marginBottom: 2,
                  }}
                />
              )}
            </Box>
            <Box>
              <Text
                size="small"
                bold={active}
                style={{
                  color: active ? 'var(--color-text-brand)' : done ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                  paddingTop: 0,
                }}
              >
                {vi.orderStatus[step]}
              </Text>
              {times?.[i] && (
                <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                  {formatDateTime(times[i])}
                </Text>
              )}
              {etaLabel && i === steps.length - 1 && !times?.[i] && (
                <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                  {orderCopy.etaLine(etaLabel)}
                </Text>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
