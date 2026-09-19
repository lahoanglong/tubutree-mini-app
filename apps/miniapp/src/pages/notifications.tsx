import { useState, useEffect } from 'react';
import { Box, Page, Text, Button, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, Truck, PackageCheck, Receipt, FileText, Coins,
  ShoppingBag, Gift, Leaf, Zap, Bell, ChevronLeft, Store, type LucideIcon,
} from 'lucide-react';
import {
  getNotifications,
  markNotificationRead,
  type NotificationDTO,
} from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { haptic } from '../utils/haptic';
import { useAuthStore } from '../store/auth';

/** Icon + nhãn nhóm theo templateCode (§4.10). */
function meta(code: string): { Icon: LucideIcon; title: string } {
  if (code.startsWith('ORDER_CONFIRMED')) return { Icon: CheckCircle2, title: 'Đơn đã xác nhận' };
  if (code.startsWith('ORDER_SHIPPING')) return { Icon: Truck, title: 'Đang giao hàng' };
  if (code.startsWith('ORDER_DELIVERED')) return { Icon: PackageCheck, title: 'Đã giao thành công' };
  if (code.startsWith('ORDER')) return { Icon: Receipt, title: 'Cập nhật đơn hàng' };
  if (code.startsWith('INVOICE')) return { Icon: FileText, title: 'Hóa đơn điện tử' };
  if (code.startsWith('COMMISSION')) return { Icon: Coins, title: 'Hoa hồng CTV' };
  if (code.startsWith('CASHBACK')) return { Icon: ShoppingBag, title: 'Hoàn tiền' };
  if (code.startsWith('BIRTHDAY') || code.startsWith('VOUCHER')) return { Icon: Gift, title: 'Ưu đãi cho bạn' };
  if (code.startsWith('POINTS')) return { Icon: Leaf, title: 'Điểm Xanh' };
  if (code.startsWith('STOREFRONT')) return { Icon: Store, title: 'Gian hàng của bạn' };
  // Trong app mục này tên là "Ưu đãi giờ vàng" (vi.flashSale.sectionTitle) — thông báo gọi
  // "Flash Sale" khiến khách vào app tìm mục không tồn tại.
  if (code.startsWith('FLASH')) return { Icon: Zap, title: 'Ưu đãi giờ vàng' };
  return { Icon: Bell, title: 'Thông báo' };
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
  return new Date(iso).toLocaleDateString('vi-VN');
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedNotif, setSelectedNotif] = useState<NotificationDTO | null>(null);

  // Trang này là CỬA VÀO từ push của Zalo: mở app từ thông báo thì restore() chưa kịp xong,
  // fetch ngay sẽ 401 và (retry:false cho 4xx) kẹt màn lỗi vĩnh viễn dù ~200ms sau đã có phiên.
  // Mọi trang /me/* khác đều đã gate như vậy; riêng đây bị sót.
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const notifQ = useQuery({ queryKey: ['notifications'], queryFn: getNotifications, enabled: authed });

  const readMut = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    // onSettled chứ không onSuccess: đánh dấu đã đọc hỏng thì huy hiệu chưa-đọc ở trang chủ sai
    // vĩnh viễn mà không có tín hiệu nào. Nạp lại trong CẢ HAI trường hợp để giao diện khớp lại
    // với máy chủ; không hiện toast vì đây là thao tác nền, báo lỗi chỉ thành nhiễu.
    onSettled: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

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

  const onTap = (n: NotificationDTO) => {
    haptic('light');
    if (n.status !== 'READ') readMut.mutate(n.id);
    setSelectedNotif(n);
  };

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>

      {notifQ.isLoading ? (
        <Box p={4} flex flexDirection="column" style={{ gap: 10 }}>
          <LineItemSkeleton />
          <LineItemSkeleton />
        </Box>
      ) : notifQ.isError ? (
        <ErrorState message={getErrorMessage(notifQ.error)} onRetry={() => void notifQ.refetch()} />
      ) : notifQ.data && notifQ.data.length > 0 ? (
        <Box p={4} flex flexDirection="column" style={{ gap: 8 }}>
          {notifQ.data.map((n) => {
            const m = meta(n.templateCode);
            const unread = n.status !== 'READ';
            return (
              <Box
                key={n.id}
                className="tubu-press"
                flex
                p={3}
                onClick={() => onTap(n)}
                style={{
                  gap: 12,
                  background: unread ? 'var(--primary-50)' : 'var(--neutral-0)',
                  borderRadius: 'var(--radius-lg)',
                  border: `1px solid ${unread ? 'var(--primary-200)' : 'var(--neutral-200)'}`,
                  boxShadow: 'var(--shadow-card)',
                  cursor: 'pointer',
                }}
              >
                <Box style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--leaf-50)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                  <m.Icon size={20} color="var(--leaf-700)" strokeWidth={1.9} />
                </Box>
                <Box style={{ flex: 1 }}>
                  <Box flex alignItems="center" style={{ gap: 6 }}>
                    <Text size="small" bold>
                      {m.title}
                    </Text>
                    {unread && (
                      <span
                        aria-label="chưa đọc"
                        style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary-600)' }}
                      />
                    )}
                  </Box>
                  {n.payload.body && (
                    <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 2 }}>
                      {n.payload.body}
                    </Text>
                  )}
                  <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
                    {relativeTime(n.sentAt)}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      ) : (
        <EmptyState
          art="leaf"
          heading="Chưa có thông báo nào"
          body="Cập nhật đơn hàng và ưu đãi sẽ hiện ở đây."
        />
      )}

      {/* ── Detail View Overlay ── */}
      {selectedNotif && (
        <Box
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 500,
            background: 'var(--neutral-50)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Top Bar with Left Back Button */}
          <Box
            flex
            alignItems="center"
            style={{
              padding: 'calc(var(--safe-top) + 12px) 16px 12px 16px',
              background: 'var(--neutral-0)',
              borderBottom: '1px solid var(--neutral-100)',
              gap: 12,
            }}
          >
            <button
              type="button"
              aria-label="Quay lại"
              className="tubu-press"
              onClick={handleCloseDetail}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: 'none',
                background: 'var(--neutral-100)',
                display: 'grid',
                placeItems: 'center',
                padding: 0,
                cursor: 'pointer',
                flex: '0 0 auto',
              }}
            >
              <ChevronLeft size={22} color="var(--neutral-800)" strokeWidth={2.2} />
            </button>
            <Text bold size="normal" style={{ color: 'var(--neutral-900)' }}>
              Chi tiết thông báo
            </Text>
          </Box>

          {/* Detail Content */}
          <Box p={4} style={{ flex: 1 }}>
            {(() => {
              const m = meta(selectedNotif.templateCode);
              const bodyText = selectedNotif.payload.body || '';
              const orderCode = selectedNotif.payload.data?.order_code ?? selectedNotif.payload.data?.orderCode;
              const isOrder = selectedNotif.templateCode.startsWith('ORDER') || !!orderCode;
              const isGame = selectedNotif.templateCode.includes('GAME') || /cây|vườn|tưới|khát|chuỗi/i.test(bodyText);
              const isCart = selectedNotif.templateCode.includes('CART') || /giỏ/i.test(bodyText);
              const isLoyalty = selectedNotif.templateCode.includes('VOUCHER') || selectedNotif.templateCode.includes('POINTS');
              // Thông báo giờ vàng trước đây KHÔNG có nút đi tiếp: khách đặt nhắc, đúng giờ mở
              // thông báo, đọc xong rồi phải tự back và tự tìm lại sản phẩm — đúng lúc chuyển
              // đổi cao nhất lại bắt đi vòng (P1-6 audit mạch lạc).
              const isFlash = selectedNotif.templateCode.startsWith('FLASH');
              const flashSlug = selectedNotif.payload.data?.product_slug ?? selectedNotif.payload.data?.productSlug;
              const isStorefront = selectedNotif.templateCode.startsWith('STOREFRONT');

              return (
                <Box
                  p={4}
                  style={{
                    background: 'var(--neutral-0)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-sm)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                  }}
                >
                  <Box flex alignItems="center" style={{ gap: 12 }}>
                    <Box style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--leaf-50)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                      <m.Icon size={24} color="var(--leaf-700)" strokeWidth={2} />
                    </Box>
                    <Box style={{ flex: 1 }}>
                      <Text bold size="normal" style={{ color: 'var(--neutral-900)' }}>
                        {m.title}
                      </Text>
                      <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
                        {new Date(selectedNotif.sentAt).toLocaleString('vi-VN')} ({relativeTime(selectedNotif.sentAt)})
                      </Text>
                    </Box>
                  </Box>

                  <div style={{ height: 1, background: 'var(--neutral-100)' }} />

                  <Text size="small" style={{ color: 'var(--neutral-700)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                    {bodyText}
                  </Text>

                  {isOrder && (
                    <Button
                      fullWidth
                      style={{ background: 'var(--primary-600)', minHeight: 44, marginTop: 8 }}
                      onClick={() => {
                        haptic('light');
                        setSelectedNotif(null);
                        navigate(orderCode ? `/order/${encodeURIComponent(orderCode)}` : '/orders');
                      }}
                    >
                      Xem chi tiết đơn hàng
                    </Button>
                  )}
                  {isFlash && !isOrder && (
                    <Button
                      fullWidth
                      style={{ background: 'var(--primary-600)', minHeight: 44, marginTop: 8 }}
                      onClick={() => {
                        haptic('light');
                        setSelectedNotif(null);
                        // Có slug trong payload thì tới thẳng sản phẩm; không thì về trang chủ,
                        // nơi dải "Ưu đãi giờ vàng" đang hiển thị.
                        navigate(flashSlug ? `/product/${encodeURIComponent(String(flashSlug))}` : '/');
                      }}
                    >
                      Xem ưu đãi giờ vàng ⚡
                    </Button>
                  )}
                  {isGame && !isOrder && !isFlash && (
                    <Button
                      fullWidth
                      style={{ background: 'var(--primary-600)', minHeight: 44, marginTop: 8 }}
                      onClick={() => {
                        haptic('light');
                        setSelectedNotif(null);
                        navigate('/game');
                      }}
                    >
                      Đến Vườn Xanh 🌿
                    </Button>
                  )}
                  {isCart && !isOrder && !isGame && (
                    <Button
                      fullWidth
                      style={{ background: 'var(--primary-600)', minHeight: 44, marginTop: 8 }}
                      onClick={() => {
                        haptic('light');
                        setSelectedNotif(null);
                        navigate('/cart');
                      }}
                    >
                      Xem giỏ hàng 🛒
                    </Button>
                  )}
                  {isLoyalty && !isOrder && !isGame && !isCart && (
                    <Button
                      fullWidth
                      style={{ background: 'var(--primary-600)', minHeight: 44, marginTop: 8 }}
                      onClick={() => {
                        haptic('light');
                        setSelectedNotif(null);
                        navigate('/loyalty');
                      }}
                    >
                      Xem ưu đãi 🎁
                    </Button>
                  )}
                  {isStorefront && !isOrder && !isGame && !isCart && !isLoyalty && (
                    <Button
                      fullWidth
                      style={{ background: 'var(--primary-600)', minHeight: 44, marginTop: 8 }}
                      onClick={() => {
                        haptic('light');
                        setSelectedNotif(null);
                        navigate('/storefront');
                      }}
                    >
                      Thêm vào gian hàng 🛍️
                    </Button>
                  )}
                </Box>
              );
            })()}
          </Box>
        </Box>
      )}
    </Page>
  );
}

