import { useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Page, Text, useParams, useNavigate, useSnackbar } from 'zmp-ui';
import { Copy, CheckCircle2, Clock } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBankQr } from '../services/payment-api';
import { haptic } from '../utils/haptic';
import { Skeleton } from '../components/ui/skeleton';
import { copyText } from '../utils/clipboard';
import { Button } from '../components/ui/button';
import { Money } from '../components/ui/price-tag';

export default function BankPaymentPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();

  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['bank-qr', code],
    queryFn: () => getBankQr(code!),
    enabled: !!code,
    // Tự dò trạng thái: Pancake/Bank đối soát chuyển khoản → webhook lật PAID; FE poll mỗi 4s.
    refetchInterval: (q) => (q.state.data?.paymentStatus === 'PAID' ? false : 4000),
  });

  const copy = (text: string, label: string) => {
    haptic('light');
    // Chỉ báo "Đã copy" SAU KHI ghi clipboard thật sự thành công — báo thành công giả ở đây là
    // khách dán nhầm số tài khoản cũ khi chuyển khoản.
    void copyText(text).then((ok) =>
      openSnackbar(
        ok
          ? { text: `Đã copy ${label}`, type: 'success', position: 'top' }
          : { text: `Không thể copy ${label}. Vui lòng copy thủ công.`, type: 'error', position: 'top' },
      ),
    );
  };

  // Cờ RIÊNG cho thao tác bấm tay. Dùng `isFetching` của query sẽ bật/tắt theo nhịp poll nền 4
  // giây, nên nút vừa quay spinner liên tục vừa bị disable đúng lúc khách chạm — chạm vào không
  // có gì xảy ra, không có phản hồi, ngay ở bước phải trả tiền.
  const [checking, setChecking] = useState(false);

  const handleCheckPayment = async () => {
    haptic('medium');
    setChecking(true);
    try {
      const res = await refetch();
      const status = res.data?.paymentStatus;
      if (status === 'PAID') {
        openSnackbar({
          text: '🎉 Đã nhận được thanh toán thành công! Đơn hàng của bạn đã được xác nhận.',
          type: 'success',
          position: 'top',
        });
      } else if (status === 'UNPAID') {
        openSnackbar({
          text: '⏳ Hệ thống chưa thấy tiền về. Ngân hàng thường xử lý từ 30s - 1 phút sau khi chuyển. Vui lòng kiểm tra lại sau ít phút nhé!',
          type: 'warning',
          position: 'top',
        });
      } else if (status === 'FAILED' || status === 'REFUNDED') {
        openSnackbar({
          text: '⚠️ Giao dịch không thành công hoặc đã được hoàn lại. Vui lòng liên hệ bộ phận hỗ trợ.',
          type: 'error',
          position: 'top',
        });
      } else {
        openSnackbar({
          text: '🔄 Đã làm mới trạng thái. Đang chờ hệ thống ngân hàng xác nhận.',
          type: 'info',
          position: 'top',
        });
      }
    } catch {
      openSnackbar({
        text: '❌ Không thể kết nối tới máy chủ. Vui lòng kiểm tra lại kết nối mạng.',
        type: 'error',
        position: 'top',
      });
    } finally {
      setChecking(false);
    }
  };

  if (isLoading) {
    return (
      <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
        <Box p={3} style={{ background: 'var(--color-bg-surface)' }}>
          <Skeleton width={200} height={20} />
          <Skeleton width={240} height={13} style={{ marginTop: 8 }} />
        </Box>
        <Box p={2}>
          <Box p={3} style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)' }}>
            <Skeleton width={240} height={240} style={{ margin: '0 auto' }} />
            <Skeleton width={140} height={24} style={{ margin: '10px auto 0' }} />
            <Box mt={3} flex flexDirection="column" style={{ gap: 8 }}>
              <Skeleton height={16} />
              <Skeleton height={16} />
              <Skeleton height={16} />
            </Box>
          </Box>
        </Box>
      </Page>
    );
  }

  if (isError || !data) {
    return (
      <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
        <Box style={{ textAlign: 'center', padding: '48px 24px' }}>
          <Text style={{ color: 'var(--color-text-secondary)' }}>Không tải được thông tin thanh toán.</Text>
          {/* loading+disabled không còn cùng gán 1 biến (Button, Task 10, đã tự chặn bấm-2-lần khi
              loading — xem components/ui/button.tsx): trước đây `disabled={isFetching}` đi kèm
              `loading={isFetching}` khiến spinner KHÔNG BAO GIỜ hiện (zmp-ui chỉ vẽ spinner khi
              loading && !disabled) — cùng lỗi audit A4-01/A4-02/A4-04 đang được sửa trong migration
              này. `isFetching` vẫn true suốt polling nền 4s lẫn lúc bấm tay, hành vi không đổi. */}
          <Button loading={isFetching} onPress={() => void refetch()} style={{ marginTop: 16 }}>
            Thử lại
          </Button>
          <Button variant="secondary" onPress={() => navigate(`/order/${code}`, { replace: true })} style={{ marginTop: 8 }}>
            Xem đơn hàng
          </Button>
        </Box>
      </Page>
    );
  }

  // ── Đã thanh toán ──
  if (data.paymentStatus === 'PAID') {
    return (
      <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
        <Box style={{ textAlign: 'center', padding: '56px 24px' }}>
          <CheckCircle2 size={64} color="var(--color-text-success)" style={{ margin: '0 auto' }} />
          <Text bold size="large" style={{ marginTop: 12 }}>Đã nhận thanh toán! 🎉</Text>
          <Text size="small" style={{ color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            Đơn {data.orderCode} đã được xác nhận. Cảm ơn bạn 🌿
          </Text>
          <Button
            fullWidth
            onPress={() => {
              // Không invalidate thì màn chi tiết/danh sách đơn đọc lại từ cache và vẫn hiện
              // "Chờ thanh toán" ngay sau khi khách vừa thấy "Đã nhận thanh toán" (P2-9 audit).
              void qc.invalidateQueries({ queryKey: ['order', data.orderCode] });
              void qc.invalidateQueries({ queryKey: ['orders'] });
              navigate(`/order/${data.orderCode}`, { replace: true });
            }}
            style={{ marginTop: 24 }}
          >
            Xem đơn hàng
          </Button>
          <Button fullWidth variant="secondary" onPress={() => navigate('/', { replace: true })} style={{ marginTop: 8 }}>
            Về trang chủ
          </Button>
        </Box>
      </Page>
    );
  }

  // ── Chờ thanh toán: hiển thị VietQR ──
  return (
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 90 }}>
      <Box p={3} style={{ background: 'var(--color-bg-surface)', textAlign: 'center' }}>
        <Text bold size="large">Quét QR để chuyển khoản</Text>
        <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', marginTop: 4 }}>
          Mở app ngân hàng / ví bất kỳ → quét mã VietQR bên dưới
        </Text>
      </Box>

      <Box p={2}>
        <Box p={3} style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', textAlign: 'center' }}>
          <img
            src={data.qrImageUrl}
            alt="VietQR"
            style={{ width: 240, height: 240, maxWidth: '70%', margin: '0 auto', display: 'block' }}
          />
          <Text bold size="large" style={{ color: 'var(--color-text-success)', marginTop: 8 }}>
            <Money amount={data.amount} />
          </Text>

          {/* Thông tin chuyển khoản thủ công (phòng khi không quét được) */}
          <Box mt={2} style={{ textAlign: 'left' }}>
            <Row label="Ngân hàng" value={data.bank.name} />
            <Row label="Số tài khoản" value={data.bank.accountNo} onCopy={() => copy(data.bank.accountNo, 'số tài khoản')} />
            <Row label="Chủ tài khoản" value={data.bank.accountName} />
            <Row label="Số tiền" value={<Money amount={data.amount} />} onCopy={() => copy(String(data.amount), 'số tiền')} />
            <Row label="Nội dung CK" value={data.memo} highlight onCopy={() => copy(data.memo, 'nội dung')} />
          </Box>
          <Text size="xSmall" style={{ color: 'var(--color-text-danger)', marginTop: 8 }}>
            ⚠️ Giữ nguyên nội dung <b>{data.memo}</b> để hệ thống tự xác nhận.
          </Text>
        </Box>

        <Box flex alignItems="center" justifyContent="center" style={{ gap: 6, marginTop: 14, color: 'var(--color-text-tertiary)' }}>
          <Clock size={15} />
          <Text size="small">Đang chờ thanh toán… tự cập nhật khi nhận được tiền</Text>
        </Box>

        {/* loading+disabled tách khỏi cùng 1 biến `checking` — cùng lý do đã ghi ở nút "Thử lại"
            phía trên: giữ cả 2 sẽ làm spinner không bao giờ hiện đúng lúc khách đang chờ xác nhận
            thanh toán, ngay bước quan trọng nhất của luồng tiền. Button (Task 10) tự chặn bấm-2-lần
            khi loading, không cần disabled làm việc đó nữa. */}
        <Button fullWidth loading={checking} onPress={handleCheckPayment} style={{ marginTop: 12 }}>
          Tôi đã chuyển khoản — Kiểm tra
        </Button>
        <Button fullWidth variant="secondary" onPress={() => navigate(`/order/${data.orderCode}`, { replace: true })} style={{ marginTop: 8 }}>
          Để sau / Xem đơn hàng
        </Button>
      </Box>
    </Page>
  );
}

function Row({ label, value, onCopy, highlight }: { label: string; value: ReactNode; onCopy?: () => void; highlight?: boolean }) {
  return (
    <Box flex alignItems="center" justifyContent="space-between" style={{ padding: '6px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
      <Text size="small" style={{ color: 'var(--color-text-tertiary)' }}>{label}</Text>
      <Box flex alignItems="center" style={{ gap: 6 }}>
        <Text size="small" bold style={highlight ? { color: 'var(--color-text-success)' } : undefined}>{value}</Text>
        {onCopy && <Copy size={15} color="var(--color-action-primary-bg)" onClick={onCopy} />}
      </Box>
    </Box>
  );
}
