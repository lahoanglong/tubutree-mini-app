import { useState } from 'react';
import { Box, Page, Text, Button, Sheet, useParams, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchOrder, cancelOrder, repurchaseOrder, requestReturn, fetchMyReturns } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { LineItemSkeleton, Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { MultiImageUpload } from '../components/image-upload';
import { formatVnd } from '../utils/format';
import { STATUS_COLOR, TIMELINE_STEPS, timelineIndex } from '../utils/order-status';
import { openOAChat, openExternal, hasOA } from '../services/zmp-bridge';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

export default function OrderDetailPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnImages, setReturnImages] = useState<string[]>([]);

  const order = useQuery({
    queryKey: ['order', code],
    queryFn: () => fetchOrder(code!),
    enabled: !!code,
  });
  const myReturns = useQuery({
    queryKey: ['my-returns'],
    queryFn: fetchMyReturns,
    enabled: !!order.data && order.data.status === 'DELIVERED',
  });

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

  if (order.isLoading) {
    return (
      <Page style={{ background: 'var(--neutral-50)' }}>
        <Box p={4} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton height={64} radius="var(--radius-lg)" />
          <LineItemSkeleton />
          <Skeleton height={120} radius="var(--radius-lg)" />
        </Box>
      </Page>
    );
  }

  if (order.isError || !order.data) {
    return (
      <Page style={{ background: 'var(--neutral-50)' }}>
        <ErrorState message={getErrorMessage(order.error)} onRetry={() => void order.refetch()} />
      </Page>
    );
  }

  const o = order.data;
  const color = STATUS_COLOR[o.status] ?? STATUS_COLOR.CONFIRMED!;
  const journey = o.shippingHistory ?? [];
  const canCancel = o.status === 'PENDING_PAYMENT' || o.status === 'CONFIRMED';
  const isDone = o.status === 'DELIVERED' || o.status === 'CANCELLED' || o.status === 'RETURNED';

  return (
    <Page className="page page-bleed" style={{ background: 'var(--neutral-50)', paddingBottom: 96 }}>

      {/* ── Status hero ── */}
      <Box p={4} style={{ background: color.bg }}>
        <Text size="xSmall" style={{ color: color.fg, opacity: 0.8 }}>
          {new Date(o.createdAt).toLocaleString('vi-VN')}
        </Text>
        <Text.Title size="small" style={{ color: color.fg }}>
          {vi.orderStatus[o.status] ?? o.status}
        </Text.Title>
      </Box>

      {/* ── Timeline (DI #9) ── */}
      {timelineIndex(o.status) >= 0 && (
        <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
          <Text bold size="small" style={{ marginBottom: 12 }}>
            {vi.orders.timeline}
          </Text>
          <Timeline current={timelineIndex(o.status)} />
        </Box>
      )}

      {/* ── Sản phẩm ── */}
      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>
          {vi.orders.products}
        </Text>
        {o.items.map((it) => (
          <Box key={it.id} flex justifyContent="space-between" style={{ padding: '6px 0', gap: 12 }}>
            <Text size="small" style={{ flex: 1 }}>
              {it.productName} · {it.variationName}{' '}
              <Text size="xSmall" style={{ color: 'var(--neutral-400)', display: 'inline' }}>
                ×{it.quantity}
              </Text>
            </Text>
            <Text size="small" style={{ flex: '0 0 auto' }}>
              {formatVnd(it.total)}
            </Text>
          </Box>
        ))}
      </Box>

      {/* ── Tóm tắt tiền ── */}
      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
        <Row label={vi.cart.subtotal} value={formatVnd(o.subtotal)} />
        {o.discount > 0 && <Row label={vi.cart.discount} value={`-${formatVnd(o.discount)}`} accent />}
        <Row
          label={vi.checkout.shippingFee}
          value={o.shippingFee === 0 ? vi.common.freeShip : formatVnd(o.shippingFee)}
          accent={o.shippingFee === 0}
        />
        <Row label={vi.checkout.total} value={formatVnd(o.total)} bold />
        <Row label={vi.orders.paymentLabel} value={vi.paymentMethod[o.paymentMethod] ?? o.paymentMethod} />
        {o.pointsEarned > 0 && o.status !== 'CANCELLED' && (
          <Text size="xSmall" style={{ color: 'var(--leaf-700)', marginTop: 4 }}>
            🌱 {vi.checkout.pointsEarn(o.pointsEarned)}
          </Text>
        )}
      </Box>

      {/* ── Vận chuyển (hãng VC + mã vận đơn + tra cứu + hành trình) §6.4 ── */}
      {(o.shippingCode || journey.length > 0) && (
        <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
          <Text bold size="small" style={{ marginBottom: 6 }}>
            Vận chuyển
          </Text>
          <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 8 }}>
            <Box style={{ flex: 1 }}>
              {o.shippingPartner && <Text size="small">{o.shippingPartner}</Text>}
              {o.shippingCode && (
                <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
                  Mã vận đơn: <b>{o.shippingCode}</b>
                </Text>
              )}
              {o.shippingStatus && (
                <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
                  {o.shippingStatus}
                </Text>
              )}
            </Box>
            {o.shippingCode && (
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  haptic('light');
                  if (navigator.clipboard) void navigator.clipboard.writeText(o.shippingCode!);
                  openSnackbar({ text: 'Đã sao chép mã vận đơn', type: 'success' });
                }}
              >
                Sao chép
              </Button>
            )}
          </Box>

          {o.trackingLink && (
            <Button
              size="small"
              variant="secondary"
              fullWidth
              style={{ marginTop: 10 }}
              onClick={() => {
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
                          background: i === 0 ? 'var(--leaf-600)' : 'var(--neutral-300)',
                          marginTop: 4,
                        }}
                      />
                      {i < journey.length - 1 && (
                        <span style={{ width: 2, flex: 1, background: 'var(--neutral-200)', marginTop: 2 }} />
                      )}
                    </Box>
                    <Box style={{ flex: 1, paddingBottom: 12 }}>
                      <Text
                        size="xSmall"
                        style={{
                          color: i === 0 ? 'var(--neutral-900)' : 'var(--neutral-600)',
                          fontWeight: i === 0 ? 600 : 400,
                        }}
                      >
                        {ev.status ?? '—'}
                      </Text>
                      {ev.at && (
                        <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
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
        <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
          <Text bold size="small" style={{ marginBottom: 4 }}>
            Hoá đơn VAT
          </Text>
          <Box flex alignItems="center" justifyContent="space-between">
            <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
              {o.invoiceStatus === 'ISSUED'
                ? 'Đã phát hành'
                : o.invoiceStatus === 'REQUESTED'
                  ? 'Đang xử lý'
                  : 'Phát hành lỗi — vui lòng liên hệ hỗ trợ'}
            </Text>
            {o.invoiceUrl && (
              <Button size="small" variant="secondary" onClick={() => void openExternal(o.invoiceUrl!)}>
                Tải PDF
              </Button>
            )}
          </Box>
        </Box>
      )}

      {/* ── Địa chỉ nhận ── */}
      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
        <Text bold size="small" style={{ marginBottom: 4 }}>
          {vi.checkout.address}
        </Text>
        <Text size="small">
          {o.shippingAddress.recipient} · {o.shippingAddress.phone}
        </Text>
        <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
          {o.shippingAddress.street}, {o.shippingAddress.ward}, {o.shippingAddress.district},{' '}
          {o.shippingAddress.province}
        </Text>
      </Box>

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
            const color =
              ret.status === 'APPROVED'
                ? 'var(--leaf-700)'
                : ret.status === 'REJECTED'
                  ? 'var(--danger)'
                  : 'var(--neutral-600)';
            return (
              <Box mx={4} mt={2} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-md)' }}>
                <Text size="xSmall" style={{ color }}>
                  {label}
                </Text>
              </Box>
            );
          }
          return (
            <Box px={4} mt={2} style={{ textAlign: 'center' }}>
              <Button variant="tertiary" onClick={() => setReturnOpen(true)} style={{ color: 'var(--neutral-600)' }}>
                ↩️ Yêu cầu đổi/trả (lỗi nhà sản xuất)
              </Button>
            </Box>
          );
        })()}

      <Box p={4} style={{ textAlign: 'center' }}>
        {hasOA ? (
          <Button
            variant="tertiary"
            onClick={() => void openOAChat(`Hỗ trợ đơn ${o.code}`)}
            style={{ color: 'var(--primary-700)' }}
          >
            💬 Yêu cầu hỗ trợ qua Zalo OA
          </Button>
        ) : (
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
            {vi.orders.support}
          </Text>
        )}
      </Box>

      {/* ── Action bar ── */}
      <Box
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--neutral-0)',
          boxShadow: 'var(--shadow-lg)',
          padding: '10px 16px calc(10px + var(--safe-bottom))',
          display: 'flex',
          gap: 10,
        }}
      >
        {canCancel && (
          <Button
            variant="secondary"
            onClick={() => {
              haptic('light');
              setConfirmCancel(true);
            }}
            style={{ minHeight: 48, color: 'var(--danger)', borderColor: 'var(--neutral-200)', flex: 1 }}
          >
            {vi.orders.cancelOrder}
          </Button>
        )}
        {isDone && (
          <Button
            loading={repurchase.isPending}
            onClick={() => repurchase.mutate()}
            style={{ background: 'var(--primary-600)', minHeight: 48, fontWeight: 600, flex: 1 }}
          >
            {vi.orders.repurchase}
          </Button>
        )}
        {!canCancel && !isDone && (
          <Button
            fullWidth
            variant="tertiary"
            onClick={() => navigate('/orders')}
            style={{ color: 'var(--primary-700)', minHeight: 48 }}
          >
            {vi.common.backHome}
          </Button>
        )}
      </Box>

      {/* ── Confirm hủy (DI #10): giữ đơn là primary ── */}
      <Sheet visible={confirmCancel} onClose={() => setConfirmCancel(false)} autoHeight>
        <Box p={5} style={{ textAlign: 'center' }}>
          <Text.Title size="small">{vi.orders.cancelConfirmTitle}</Text.Title>
          <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 6 }}>
            {vi.orders.cancelConfirmBody}
          </Text>
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
            <Button
              fullWidth
              onClick={() => setConfirmCancel(false)}
              style={{ background: 'var(--primary-600)', minHeight: 48, fontWeight: 600 }}
            >
              {vi.orders.cancelKeep}
            </Button>
            <Button
              fullWidth
              variant="tertiary"
              loading={cancel.isPending}
              onClick={() => cancel.mutate()}
              style={{ color: 'var(--danger)', minHeight: 44 }}
            >
              {vi.orders.cancelYes}
            </Button>
          </Box>
        </Box>
      </Sheet>

      <Sheet visible={returnOpen} onClose={() => setReturnOpen(false)} autoHeight>
        <Box p={5}>
          <Text.Title size="small">Yêu cầu đổi/trả</Text.Title>
          <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 6 }}>
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
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--neutral-200)',
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <Text size="xSmall" bold style={{ marginTop: 12, display: 'block', color: 'var(--neutral-600)' }}>
            Ảnh minh chứng (khuyến khích, tối đa 3)
          </Text>
          <MultiImageUpload value={returnImages} onChange={setReturnImages} max={3} />
          <Button
            fullWidth
            loading={returnReq.isPending}
            disabled={returnReason.trim().length < 5}
            onClick={() => returnReq.mutate()}
            style={{ background: 'var(--primary-600)', minHeight: 48, marginTop: 14, fontWeight: 600 }}
          >
            Gửi yêu cầu
          </Button>
        </Box>
      </Sheet>
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
                  background: done || active ? 'var(--primary-600)' : 'var(--neutral-100)',
                  border: `2px solid ${done || active ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
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
                    background: done ? 'var(--primary-600)' : 'var(--neutral-200)',
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
                color: active ? 'var(--primary-700)' : done ? 'var(--neutral-900)' : 'var(--neutral-400)',
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

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <Box flex justifyContent="space-between" style={{ padding: '4px 0' }}>
      <Text size="small" style={{ color: 'var(--neutral-600)' }}>
        {label}
      </Text>
      <Text
        size="small"
        bold={bold}
        style={{
          color: accent ? 'var(--leaf-700)' : bold ? 'var(--primary-700)' : undefined,
          fontSize: bold ? 16 : undefined,
        }}
      >
        {value}
      </Text>
    </Box>
  );
}
