import { useEffect, useState } from 'react';
import { Box, Page, Text, Sheet, useParams, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, MessageSquare, Recycle } from 'lucide-react';
import { fetchOrder, fetchOrders, cancelOrder, repurchaseOrder, requestReturn, fetchMyReturns } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { LineItemSkeleton, Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { MultiImageUpload } from '../components/image-upload';
import { formatVnd, addressLine, isRecyclingPickedUp, recyclingPickupView, type RecyclingTone } from '../utils/format';
import { STATUS_COLOR, TIMELINE_STEPS, timelineIndex } from '../utils/order-status';
import {
  openOAChat,
  openExternal,
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
import { KeyValueRow } from '../components/ui/key-value-row';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Button } from '../components/ui/button';

/** Màu ô trạng thái thu gom — cùng bảng màu STATUS_COLOR của đơn (order-status.ts): 'progress'
 * dùng cùng cặp token với CONFIRMED/PACKED, 'success' với DELIVERED, 'warning' với PENDING_PAYMENT,
 * 'muted' với RETURNED. */
const RECYCLING_TONE_BG: Record<RecyclingTone, string> = {
  progress: 'var(--color-action-secondary-bg)',
  success: 'var(--color-status-success-bg)',
  warning: 'var(--color-status-warning-bg)',
  muted: 'var(--color-status-neutral-bg)',
};
const RECYCLING_TONE_FG: Record<RecyclingTone, string> = {
  progress: 'var(--color-action-secondary-fg)',
  success: 'var(--color-status-success-fg)',
  warning: 'var(--color-status-warning-fg)',
  muted: 'var(--color-status-neutral-fg)',
};

export default function OrderDetailPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnImages, setReturnImages] = useState<string[]>([]);
  const authStatus = useAuthStore((s) => s.status);

  // Guard auth: tránh gọi /orders/:code khi chưa silent-login xong (deeplink từ thông báo
  // đơn hàng ngay lúc app vừa mở → 401 hiện lỗi trong khi chỉ cần chờ vài trăm ms là có phiên).
  const order = useQuery({
    queryKey: ['order', code],
    queryFn: () => fetchOrder(code!),
    enabled: !!code && authStatus === 'authenticated',
  });
  const myReturns = useQuery({
    queryKey: ['my-returns'],
    queryFn: fetchMyReturns,
    enabled: !!order.data && order.data.status === 'DELIVERED',
  });

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
    queryFn: () => fetchOrders(undefined, 1, 1),
    enabled: hasOA && oaPromptReady && !oaPromptSeen && !!order.data,
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
    mutationFn: () => cancelOrder(code!),
    onSuccess: (o) => {
      queryClient.setQueryData(['order', code], o);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      setConfirmCancel(false);
      haptic('medium');
      openSnackbar({ text: vi.orders.cancelled, type: 'success' });
    },
    onError: (e: unknown) => {
      setConfirmCancel(false);
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    },
  });

  const repurchase = useMutation({
    mutationFn: () => repurchaseOrder(code!),
    onSuccess: (c) => {
      queryClient.setQueryData(['cart'], c);
      haptic('medium');
      navigate('/cart');
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const returnReq = useMutation({
    mutationFn: () => requestReturn(code!, returnReason.trim(), returnImages),
    onSuccess: () => {
      setReturnOpen(false);
      setReturnReason('');
      setReturnImages([]);
      haptic('medium');
      void queryClient.invalidateQueries({ queryKey: ['my-returns'] });
      openSnackbar({ text: 'Đã gửi yêu cầu đổi/trả. Tubu sẽ phản hồi trong 24h.', type: 'success' });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  if (authStatus === 'loading' || order.isLoading) {
    return (
      <Shell>
        <Box p={4} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton height={64} radius="var(--radius-card)" />
          <LineItemSkeleton />
          <Skeleton height={120} radius="var(--radius-card)" />
        </Box>
      </Shell>
    );
  }

  if (order.isError || !order.data) {
    return (
      <Shell>
        <ErrorState message={getErrorMessage(order.error)} onRetry={() => void order.refetch()} />
      </Shell>
    );
  }

  const o = order.data;
  const color = STATUS_COLOR[o.status] ?? STATUS_COLOR.CONFIRMED!;
  // Bỏ entry shape cũ ({at,data} trước khi chuẩn hoá) — chỉ hiện mốc có trạng thái/mã.
  const journey = (o.shippingHistory ?? []).filter((e) => e && (e.status || e.code));
  // Đơn thu gom tái chế mà bưu tá đã lấy hàng: BE chặn khách tự huỷ → ẩn nút (liên hệ Zalo OA).
  const canCancel =
    (o.status === 'PENDING_PAYMENT' || o.status === 'CONFIRMED') &&
    !(o.hasRecyclingPickup && isRecyclingPickedUp(o.gomdonStatus));
  const recycling = o.hasRecyclingPickup ? recyclingPickupView(o) : null;
  // Đơn chuyển khoản chưa trả tiền: trước đây màn QR (/bank-payment/:code) CHỈ tới được đúng
  // một lần ngay sau khi đặt hàng (checkout.tsx). Rời khỏi đó là mất luôn mã QR/số tài khoản —
  // khách muốn trả tiền cũng không có đường quay lại, chỉ còn cách huỷ đơn rồi đặt lại.
  const canPayNow = o.status === 'PENDING_PAYMENT' && o.paymentMethod === 'BANK_TRANSFER';
  const isDone = o.status === 'DELIVERED' || o.status === 'CANCELLED' || o.status === 'RETURNED';

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 96 }}>
      <PageHeader title="Chi tiết đơn hàng" subtitle={o.code} />

      {/* ── Status hero ── */}
      <Box p={4} style={{ background: color.bg }}>
        <Text size="xSmall" style={{ color: color.fg, opacity: 0.8 }}>
          {new Date(o.createdAt).toLocaleString('vi-VN')}
        </Text>
        <Text.Title size="small" style={{ color: color.fg }}>
          {vi.orderStatus[o.status] ?? o.status}
        </Text.Title>
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
            Nhận thông báo cập nhật đơn hàng và ưu đãi mới — không bỏ lỡ tin quan trọng.
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
      {timelineIndex(o.status) >= 0 && (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <Text bold size="small" style={{ marginBottom: 12 }}>
            {vi.orders.timeline}
          </Text>
          <Timeline current={timelineIndex(o.status)} />
        </Box>
      )}

      {/* ── Sản phẩm ── */}
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>
          {vi.orders.products}
        </Text>
        {o.items.map((it) => (
          <Box key={it.id} style={{ padding: '6px 0' }}>
            <Box flex justifyContent="space-between" style={{ gap: 12 }}>
              <Text size="small" style={{ flex: 1 }}>
                {it.productName} · {it.variationName}{' '}
                <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', display: 'inline' }}>
                  ×{it.quantity}
                </Text>
              </Text>
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
                (OrderItem không lưu slug). Nay snapshot productSlug nên dẫn thẳng được. */}
            {o.status === 'DELIVERED' && it.productSlug && (
              <Text
                size="xSmall"
                bold
                className="tubu-press"
                style={{ color: 'var(--color-text-brand)', marginTop: 2, display: 'inline-block' }}
                onClick={() => {
                  haptic('light');
                  navigate(`/product/${it.productSlug}`);
                }}
              >
                ★ {vi.orders.reviewItem}
              </Text>
            )}
          </Box>
        ))}
      </Box>

      {/* ── Tóm tắt tiền ── */}
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
        <KeyValueRow label={vi.cart.subtotal} value={formatVnd(o.subtotal)} />
        {o.discount > 0 && <KeyValueRow label={vi.cart.discount} value={`-${formatVnd(o.discount)}`} tone="success" />}
        {/* BE gộp voucher + combo + điểm vào cùng cột `discount`; nếu không tách dòng này thì
            khách tiêu điểm Xanh xong không thấy điểm mình đi đâu (checkout có tách, chi tiết đơn thì không). */}
        {o.pointsUsed > 0 && (
          <KeyValueRow label={vi.orders.pointsUsed} value={`${o.pointsUsed.toLocaleString('vi-VN')} điểm`} />
        )}
        <KeyValueRow
          label={vi.checkout.shippingFee}
          value={o.shippingFee === 0 ? vi.common.freeShip : formatVnd(o.shippingFee)}
          tone={o.shippingFee === 0 ? 'success' : 'primary'}
        />
        <KeyValueRow label={vi.checkout.total} value={formatVnd(o.total)} emphasis />
        <KeyValueRow label={vi.orders.paymentLabel} value={vi.paymentMethod[o.paymentMethod] ?? o.paymentMethod} />
        {o.pointsEarned > 0 && o.status !== 'CANCELLED' && (
          <Text size="xSmall" style={{ color: 'var(--color-text-success)', marginTop: 4 }}>
            🌱 {vi.checkout.pointsEarn(o.pointsEarned)}
          </Text>
        )}
      </Box>

      {/* ── Vận chuyển (hãng VC + mã vận đơn + tra cứu + hành trình) §6.4 ── */}
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
                  {o.shippingStatus}
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
                Sao chép
              </Button>
            )}
          </Box>

          {o.trackingLink && (
            <Button
              variant="secondary"
              fullWidth
              style={{ marginTop: 10 }}
              onPress={() => {
                haptic('light');
                void openExternal(o.trackingLink!).catch(() =>
                  openSnackbar({ text: 'Không mở được liên kết tra cứu.', type: 'error' }),
                );
              }}
            >
              Tra cứu hành trình
            </Button>
          )}

          {journey.length > 0 && (
            <Box mt={3}>
              {journey
                .slice()
                .reverse()
                .map((ev, i) => (
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
                        {ev.status ?? '—'}
                      </Text>
                      {ev.at && (
                        <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                          {new Date(ev.at).toLocaleString('vi-VN')}
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
              <Button variant="secondary" onPress={() => void openExternal(o.invoiceUrl!)}>
                Tải PDF
              </Button>
            )}
          </Box>
        </Box>
      )}

      {/* ── Thu gom vật liệu tái chế (nếu khách chọn) — trạng thái thật theo gomdonStatus ── */}
      {recycling && (
        <Box id="order-recycling" p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <Box flex alignItems="center" style={{ gap: 10 }}>
            <Box
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-control)',
                background: 'var(--color-bg-subtle)',
                display: 'grid',
                placeItems: 'center',
                flex: '0 0 auto',
              }}
            >
              <Recycle size={18} color="var(--color-text-brand)" />
            </Box>
            <Box style={{ flex: 1 }}>
              <Text bold size="small" style={{ color: 'var(--color-text-primary)' }}>
                Thu gom vật liệu tái chế
              </Text>
              <Text size="xSmall" style={{ color: 'var(--color-text-success)', marginTop: 2 }}>
                Tubu Tree tài trợ 100% phí thu gom
              </Text>
            </Box>
          </Box>
          <Box
            mt={2}
            p={2}
            style={{
              background: RECYCLING_TONE_BG[recycling.tone],
              borderRadius: 'var(--radius-control)',
            }}
          >
            <Text bold size="xSmall" style={{ color: RECYCLING_TONE_FG[recycling.tone] }}>
              {recycling.title}
            </Text>
            <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', marginTop: 2, lineHeight: '18px' }}>
              {recycling.detail}
            </Text>
            {recycling.waybill && (
              <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
                Mã vận đơn BestExpress: <b>{recycling.waybill}</b>
              </Text>
            )}
          </Box>
          {o.recyclingNote && (
            <Box
              mt={2}
              p={2}
              style={{
                background: 'var(--color-bg-canvas)',
                borderRadius: 'var(--radius-control)',
              }}
            >
              <Text size="xSmall" style={{ color: 'var(--stone-700)' }}>
                <b>Vật dụng gửi:</b> {o.recyclingNote}
              </Text>
            </Box>
          )}
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

      {/* Đổi/trả — chỉ đơn đã giao, lỗi NSX (§6.4) */}
      {o.status === 'DELIVERED' &&
        (() => {
          const ret = myReturns.data?.find((r) => r.orderId === o.id);
          if (ret) {
            const label =
              ret.status === 'APPROVED'
                ? '✅ Đổi/trả đã duyệt — tiền hoàn vào Ví Tubu'
                : ret.status === 'REJECTED'
                  ? `❌ Đổi/trả bị từ chối${ret.adminNote ? `: ${ret.adminNote}` : ''}`
                  : '⏳ Yêu cầu đổi/trả đang xử lý (trong 24h)';
            const retColor =
              ret.status === 'APPROVED'
                ? 'var(--color-text-success)'
                : ret.status === 'REJECTED'
                  ? 'var(--color-text-danger)'
                  : 'var(--color-text-secondary)';
            return (
              <Box mx={4} mt={2} p={3} style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-control)' }}>
                <Text size="xSmall" style={{ color: retColor }}>
                  {label}
                </Text>
              </Box>
            );
          }
          return (
            <Box px={4} mt={2} style={{ textAlign: 'center' }}>
              <Button
                variant="ghost"
                onPress={() => setReturnOpen(true)}
                style={{ color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <RotateCcw size={15} strokeWidth={2} aria-hidden />
                Yêu cầu đổi/trả (lỗi nhà sản xuất)
              </Button>
            </Box>
          );
        })()}

      <Box p={4} style={{ textAlign: 'center' }}>
        {hasOA ? (
          <Button
            variant="ghost"
            onPress={() => void openOAChat(`Hỗ trợ đơn ${o.code}`)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <MessageSquare size={16} strokeWidth={2} aria-hidden />
            Yêu cầu hỗ trợ qua Zalo OA
          </Button>
        ) : (
          <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
            {vi.orders.support}
          </Text>
        )}
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
            {isDone && (
              <Button loading={repurchase.isPending} onPress={() => repurchase.mutate()} style={{ flex: 1, fontWeight: 600 }}>
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

      {/* ── Confirm hủy (DI #10): giữ đơn là primary ── */}
      <Sheet visible={confirmCancel} onClose={() => setConfirmCancel(false)} autoHeight>
        <Box p={5} style={{ textAlign: 'center' }}>
          <Text.Title size="small">{vi.orders.cancelConfirmTitle}</Text.Title>
          <Text size="small" style={{ color: 'var(--color-text-secondary)', marginTop: 6 }}>
            {vi.orders.cancelConfirmBody}
          </Text>
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
            <Button fullWidth onPress={() => setConfirmCancel(false)}>
              {vi.orders.cancelKeep}
            </Button>
            <Button
              fullWidth
              variant="ghost"
              loading={cancel.isPending}
              onPress={() => cancel.mutate()}
              style={{ color: 'var(--color-text-danger)' }}
            >
              {vi.orders.cancelYes}
            </Button>
          </Box>
        </Box>
      </Sheet>

      <Sheet visible={returnOpen} onClose={() => setReturnOpen(false)} autoHeight>
        <Box p={5}>
          <Text.Title size="small">Yêu cầu đổi/trả</Text.Title>
          <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', marginTop: 6 }}>
            Chỉ áp dụng khi lỗi nhà sản xuất (hỏng bao bì, sai hạn dùng, sai mã, không đúng mô tả).
            Trong 7 ngày từ khi nhận hàng. Tubu phản hồi trong 24h.
          </Text>
          <textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            placeholder="Mô tả lỗi sản phẩm (tối thiểu 5 ký tự)…"
            rows={4}
            style={{
              width: '100%',
              marginTop: 12,
              padding: 10,
              borderRadius: 'var(--radius-control)',
              border: '1px solid var(--color-border-subtle)',
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <Text size="xSmall" bold style={{ marginTop: 12, display: 'block', color: 'var(--color-text-secondary)' }}>
            Ảnh minh chứng (khuyến khích, tối đa 3)
          </Text>
          <MultiImageUpload value={returnImages} onChange={setReturnImages} max={3} />
          <Button
            fullWidth
            loading={returnReq.isPending}
            disabled={returnReason.trim().length < 5}
            onPress={() => returnReq.mutate()}
            style={{ marginTop: 14 }}
          >
            Gửi yêu cầu
          </Button>
        </Box>
      </Sheet>
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
function Timeline({ current }: { current: number }) {
  return (
    <Box style={{ display: 'flex', flexDirection: 'column' }}>
      {TIMELINE_STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <Box key={step} flex style={{ gap: 12, minHeight: i === TIMELINE_STEPS.length - 1 ? 24 : 44 }}>
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
              {i < TIMELINE_STEPS.length - 1 && (
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
          </Box>
        );
      })}
    </Box>
  );
}
