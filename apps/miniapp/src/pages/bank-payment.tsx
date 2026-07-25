import { Box, Page, Text, Button, Spinner, useParams, useNavigate, useSnackbar } from 'zmp-ui';
import { Copy, CheckCircle2, Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getBankQr } from '../services/payment-api';
import { haptic } from '../utils/haptic';

function fmtVnd(n: number): string {
  return n.toLocaleString('vi-VN') + 'đ';
}

export default function BankPaymentPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['bank-qr', code],
    queryFn: () => getBankQr(code!),
    enabled: !!code,
    // Tự dò trạng thái: Pancake đối soát chuyển khoản → webhook lật PAID; FE poll mỗi 8s.
    refetchInterval: (q) => (q.state.data?.paymentStatus === 'PAID' ? false : 8000),
  });

  const copy = (text: string, label: string) => {
    haptic('light');
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      openSnackbar({ text: `Đã copy ${label}`, type: 'success', position: 'top' });
    }
  };

  const handleCheckPayment = async () => {
    haptic('medium');
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
    }
  };

  if (isLoading) return <Page className="page"><Box flex justifyContent="center" p={6}><Spinner /></Box></Page>;

  if (isError || !data) {
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <Box style={{ textAlign: 'center', padding: '48px 24px' }}>
          <Text style={{ color: 'var(--neutral-600)' }}>Không tải được thông tin thanh toán.</Text>
          <Button onClick={() => navigate(`/order/${code}`, { replace: true })} style={{ marginTop: 16 }}>Xem đơn hàng</Button>
        </Box>
      </Page>
    );
  }

  // ── Đã thanh toán ──
  if (data.paymentStatus === 'PAID') {
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <Box style={{ textAlign: 'center', padding: '56px 24px' }}>
          <CheckCircle2 size={64} color="var(--leaf-600)" style={{ margin: '0 auto' }} />
          <Text bold size="large" style={{ marginTop: 12 }}>Đã nhận thanh toán! 🎉</Text>
          <Text size="small" style={{ color: 'var(--neutral-500)', marginTop: 4 }}>
            Đơn {data.orderCode} đã được xác nhận. Cảm ơn bạn 🌿
          </Text>
          <Button fullWidth onClick={() => navigate(`/order/${data.orderCode}`, { replace: true })} style={{ marginTop: 24, background: 'var(--leaf-600)' }}>
            Xem đơn hàng
          </Button>
          <Button fullWidth variant="secondary" onClick={() => navigate('/', { replace: true })} style={{ marginTop: 8 }}>
            Về trang chủ
          </Button>
        </Box>
      </Page>
    );
  }

  // ── Chờ thanh toán: hiển thị VietQR ──
  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 90 }}>
      <Box p={3} style={{ background: 'var(--neutral-0)', textAlign: 'center' }}>
        <Text bold size="large">Quét QR để chuyển khoản</Text>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
          Mở app ngân hàng / ví bất kỳ → quét mã VietQR bên dưới
        </Text>
      </Box>

      <Box p={2}>
        <Box p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
          <img
            src={data.qrImageUrl}
            alt="VietQR"
            style={{ width: 240, height: 240, maxWidth: '70%', margin: '0 auto', display: 'block' }}
          />
          <Text bold size="large" style={{ color: 'var(--leaf-700)', marginTop: 8 }}>{fmtVnd(data.amount)}</Text>

          {/* Thông tin chuyển khoản thủ công (phòng khi không quét được) */}
          <Box mt={2} style={{ textAlign: 'left' }}>
            <Row label="Ngân hàng" value={data.bank.name} />
            <Row label="Số tài khoản" value={data.bank.accountNo} onCopy={() => copy(data.bank.accountNo, 'số tài khoản')} />
            <Row label="Chủ tài khoản" value={data.bank.accountName} />
            <Row label="Số tiền" value={fmtVnd(data.amount)} onCopy={() => copy(String(data.amount), 'số tiền')} />
            <Row label="Nội dung CK" value={data.memo} highlight onCopy={() => copy(data.memo, 'nội dung')} />
          </Box>
          <Text size="xSmall" style={{ color: 'var(--danger, #b91c1c)', marginTop: 8 }}>
            ⚠️ Giữ nguyên nội dung <b>{data.memo}</b> để hệ thống tự xác nhận.
          </Text>
        </Box>

        <Box flex alignItems="center" justifyContent="center" style={{ gap: 6, marginTop: 14, color: 'var(--neutral-500)' }}>
          <Clock size={15} />
          <Text size="small">Đang chờ thanh toán… tự cập nhật khi nhận được tiền</Text>
        </Box>

        <Button fullWidth loading={isFetching} onClick={handleCheckPayment} style={{ marginTop: 12, background: 'var(--leaf-600)' }}>
          Tôi đã chuyển khoản — Kiểm tra
        </Button>
        <Button fullWidth variant="secondary" onClick={() => navigate(`/order/${data.orderCode}`, { replace: true })} style={{ marginTop: 8 }}>
          Để sau / Xem đơn hàng
        </Button>
      </Box>
    </Page>
  );
}

function Row({ label, value, onCopy, highlight }: { label: string; value: string; onCopy?: () => void; highlight?: boolean }) {
  return (
    <Box flex alignItems="center" justifyContent="space-between" style={{ padding: '6px 0', borderTop: '1px solid var(--neutral-100)' }}>
      <Text size="small" style={{ color: 'var(--neutral-400)' }}>{label}</Text>
      <Box flex alignItems="center" style={{ gap: 6 }}>
        <Text size="small" bold style={highlight ? { color: 'var(--leaf-700)' } : undefined}>{value}</Text>
        {onCopy && <Copy size={15} color="var(--primary-600)" onClick={onCopy} />}
      </Box>
    </Box>
  );
}
