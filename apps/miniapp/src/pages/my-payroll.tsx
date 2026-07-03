import { useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Wallet, Landmark } from 'lucide-react';
import { getMyPayroll, updateBank, type PayrollStatus } from '../services/payroll-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { Skeleton } from '../components/ui/skeleton';
import { ImageUpload } from '../components/image-upload';
import { formatVnd } from '../utils/format';
import { currentVnYearMonth, shiftYearMonth, dowLabel, dayOfMonth } from '../utils/week';

const STATUS_LABEL: Record<PayrollStatus, string> = {
  OPEN: 'Đang tính',
  FINALIZED: 'Đã chốt',
  PAID: 'Đã trả',
};

const fmtH = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;

export default function MyPayrollPage() {
  const role = useAuthStore((s) => s.user?.role);
  if (role !== 'STAFF' && role !== 'ADMIN') {
    return (
      <Page className="page">
        <Box p={6} style={{ textAlign: 'center' }}>
          <Text style={{ color: 'var(--neutral-600)' }}>Trang dành cho nhân viên.</Text>
        </Box>
      </Page>
    );
  }
  return <MyPayrollHub />;
}

function MyPayrollHub() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [ym, setYm] = useState(() => currentVnYearMonth());
  const payQ = useQuery({ queryKey: ['my-payroll', ym.year, ym.month], queryFn: () => getMyPayroll(ym.year, ym.month) });

  const [bankOpen, setBankOpen] = useState(false);
  const [bin, setBin] = useState('');
  const [accNo, setAccNo] = useState('');
  const [accName, setAccName] = useState('');
  const [qr, setQr] = useState('');

  const openBank = () => {
    const p = payQ.data?.profile;
    setBin(p?.bankBin ?? '');
    setAccNo(p?.bankAccountNo ?? '');
    setAccName(p?.bankAccountName ?? '');
    setQr(p?.qrImageUrl ?? '');
    setBankOpen(true);
  };

  const bankM = useMutation({
    mutationFn: () =>
      updateBank({ bankBin: bin.trim(), bankAccountNo: accNo.trim(), bankAccountName: accName.trim(), qrImageUrl: qr || undefined }),
    onSuccess: () => {
      openSnackbar({ text: 'Đã lưu thông tin nhận lương.', type: 'success' });
      setBankOpen(false);
      qc.invalidateQueries({ queryKey: ['my-payroll'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const m = payQ.data?.month;

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 96 }}>
      <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
        <Box flex alignItems="center" style={{ gap: 8 }}>
          <Wallet size={22} color="var(--leaf-700)" />
          <Text.Title size="small">Lương của tôi</Text.Title>
        </Box>

        {/* Chuyển tháng */}
        <Box flex alignItems="center" justifyContent="space-between" style={{ background: 'var(--neutral-0)', borderRadius: 12, padding: '8px 12px' }}>
          <Button size="small" variant="tertiary" onClick={() => setYm(shiftYearMonth(ym.year, ym.month, -1))}>
            <ChevronLeft size={18} />
          </Button>
          <Text size="small" bold>
            Tháng {ym.month}/{ym.year}
          </Text>
          <Button size="small" variant="tertiary" onClick={() => setYm(shiftYearMonth(ym.year, ym.month, 1))}>
            <ChevronRight size={18} />
          </Button>
        </Box>

        {payQ.isLoading && <Skeleton style={{ height: 120, borderRadius: 12 }} />}
        {payQ.isError && <Text style={{ color: 'var(--danger, #d64545)' }}>{getErrorMessage(payQ.error)}</Text>}

        {m && (
          <Box style={{ background: 'linear-gradient(135deg, var(--leaf-600), var(--leaf-700))', color: '#fff', borderRadius: 14, padding: 16 }}>
            <Text size="small" style={{ color: 'rgba(255,255,255,0.9)' }}>Thực nhận tháng {m.month}/{m.year}</Text>
            <Text bold style={{ color: '#fff', fontSize: 28, marginTop: 2 }}>{formatVnd(m.net)}</Text>
            <Box flex style={{ gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
              <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.9)' }}>Giờ công: {fmtH(m.totalMinutes)}</Text>
              <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.9)' }}>Lương gộp: {formatVnd(m.gross)}</Text>
              <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.9)' }}>Phạt: {formatVnd(m.totalFines)}</Text>
            </Box>
            <Box style={{ display: 'inline-block', marginTop: 8, padding: '2px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.2)' }}>
              <Text size="xSmall" style={{ color: '#fff' }}>{STATUS_LABEL[m.status]}</Text>
            </Box>
            {m.status === 'PAID' && m.proofImageUrl && (
              <Box style={{ marginTop: 10 }}>
                <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.9)', marginBottom: 4 }}>Ảnh xác nhận đã chuyển:</Text>
                <img src={m.proofImageUrl} alt="Xác nhận chuyển khoản" style={{ maxWidth: '100%', borderRadius: 8 }} />
              </Box>
            )}
          </Box>
        )}

        <Button size="small" variant="secondary" prefixIcon={<Landmark size={15} />} onClick={openBank}>
          Thông tin nhận lương
        </Button>

        {/* Chi tiết ngày */}
        {payQ.data && payQ.data.days.length > 0 && (
          <Box style={{ background: 'var(--neutral-0)', borderRadius: 12, padding: 12 }}>
            <Text bold style={{ marginBottom: 6 }}>Chi tiết theo ngày</Text>
            {payQ.data.days.map((d) => (
              <Box key={d.id} flex justifyContent="space-between" alignItems="center" style={{ padding: '6px 0', borderTop: '1px solid var(--neutral-100)' }}>
                <Text size="small">{dowLabel(d.workDate.slice(0, 10))} {dayOfMonth(d.workDate.slice(0, 10))} · {fmtH(d.workedMinutes)}</Text>
                <Box style={{ textAlign: 'right' }}>
                  <Text size="small" bold>{formatVnd(d.net)}</Text>
                  {d.fines > 0 && <Text size="xSmall" style={{ color: 'var(--danger, #d64545)' }}>−{formatVnd(d.fines)} phạt</Text>}
                </Box>
              </Box>
            ))}
          </Box>
        )}
        {payQ.data && payQ.data.days.length === 0 && (
          <Text size="small" style={{ color: 'var(--neutral-500)' }}>Chưa có dữ liệu công tháng này.</Text>
        )}
      </Box>

      {/* Sheet bank */}
      <Sheet visible={bankOpen} onClose={() => setBankOpen(false)} autoHeight>
        <Box p={4} flex flexDirection="column" style={{ gap: 10 }}>
          <Text.Title size="small">Thông tin nhận lương</Text.Title>
          <Input label="Mã ngân hàng (BIN Napas, VD 970407)" value={bin} onChange={(e) => setBin(e.target.value)} />
          <Input label="Số tài khoản" value={accNo} onChange={(e) => setAccNo(e.target.value)} />
          <Input label="Tên chủ tài khoản" value={accName} onChange={(e) => setAccName(e.target.value)} />
          <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>Hoặc tải ảnh QR nhận tiền (ưu tiên nếu có):</Text>
          <ImageUpload label="QR nhận lương" value={qr} onChange={setQr} />
          <Button fullWidth loading={bankM.isPending} onClick={() => bankM.mutate()}>Lưu</Button>
        </Box>
      </Sheet>
    </Page>
  );
}
