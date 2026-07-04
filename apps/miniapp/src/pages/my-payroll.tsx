import { useMemo, useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Wallet, Landmark, ChevronDown } from 'lucide-react';
import { getMyPayroll, updateBank, type PayrollStatus, type PayrollDay } from '../services/payroll-api';
import { getHistory, type SessionHistory } from '../services/attendance-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { Skeleton } from '../components/ui/skeleton';
import { ImageUpload } from '../components/image-upload';
import { formatVnd } from '../utils/format';
import {
  currentVnYearMonth,
  shiftYearMonth,
  dowLabel,
  dayOfMonth,
  mondayKeyOf,
  shortDayLabel,
  isoToVnHHMM,
  keyToUtcMidnightISO,
  vnDateKey,
} from '../utils/week';

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
  const monFrom = keyToUtcMidnightISO(`${ym.year}-${String(ym.month).padStart(2, '0')}-01`);
  const nextM = shiftYearMonth(ym.year, ym.month, 1);
  const monTo = keyToUtcMidnightISO(`${nextM.year}-${String(nextM.month).padStart(2, '0')}-01`);
  const histQ = useQuery({ queryKey: ['my-attn-history', ym.year, ym.month], queryFn: () => getHistory(monFrom, monTo) });
  const [openDay, setOpenDay] = useState<string | null>(null);

  // Gom phiên theo ngày VN (checkinAt là mốc UTC → đổi sang ngày VN để khớp workDate).
  const sessionsByDay = useMemo(() => {
    const map: Record<string, SessionHistory[]> = {};
    for (const s of histQ.data ?? []) {
      const key = vnDateKey(new Date(s.checkinAt));
      (map[key] ??= []).push(s);
    }
    return map;
  }, [histQ.data]);

  // Gom ngày theo TUẦN (T2–CN) + subtotal.
  const weeks = useMemo(() => {
    const byWeek: Record<string, PayrollDay[]> = {};
    for (const d of payQ.data?.days ?? []) {
      const wk = mondayKeyOf(new Date(d.workDate));
      (byWeek[wk] ??= []).push(d);
    }
    return Object.entries(byWeek)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([wk, days]) => ({
        wk,
        days,
        minutes: days.reduce((s, d) => s + d.workedMinutes, 0),
        net: days.reduce((s, d) => s + d.net, 0),
      }));
  }, [payQ.data]);

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
              <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.9)' }}>Đơn giá: {formatVnd(payQ.data?.profile?.hourlyRate ?? 0)}/h</Text>
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

        {/* Chi tiết theo TUẦN → xổ ngày → xổ phiên checkin/out */}
        {weeks.map((w, i) => (
          <Box key={w.wk} style={{ background: 'var(--neutral-0)', borderRadius: 12, padding: 12 }}>
            <Box flex justifyContent="space-between" alignItems="center" style={{ marginBottom: 4 }}>
              <Text bold>Tuần {i + 1} ({shortDayLabel(w.wk)}–{shortDayLabel(new Date(new Date(`${w.wk}T00:00:00Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10))})</Text>
              <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>{fmtH(w.minutes)} · {formatVnd(w.net)}</Text>
            </Box>
            {w.days.map((d) => {
              const key = d.workDate.slice(0, 10);
              const sess = sessionsByDay[key] ?? [];
              const isOpen = openDay === key;
              return (
                <Box key={d.id} style={{ borderTop: '1px solid var(--neutral-100)' }}>
                  <Box
                    flex
                    justifyContent="space-between"
                    alignItems="center"
                    style={{ padding: '6px 0' }}
                    onClick={() => setOpenDay(isOpen ? null : key)}
                  >
                    <Box flex alignItems="center" style={{ gap: 4 }}>
                      <ChevronDown size={14} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                      <Text size="small">{dowLabel(key)} {dayOfMonth(key)} · {fmtH(d.workedMinutes)}</Text>
                    </Box>
                    <Box style={{ textAlign: 'right' }}>
                      <Text size="small" bold>{formatVnd(d.net)}</Text>
                      {d.fines > 0 && <Text size="xSmall" style={{ color: 'var(--danger, #d64545)' }}>−{formatVnd(d.fines)} phạt</Text>}
                    </Box>
                  </Box>
                  {isOpen && (
                    <Box style={{ paddingLeft: 18, paddingBottom: 6 }}>
                      {sess.length === 0 && <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>Không có phiên chấm công.</Text>}
                      {sess.map((s) => (
                        <Text key={s.id} size="xSmall" style={{ color: 'var(--neutral-500)', display: 'block' }}>
                          {isoToVnHHMM(s.checkinAt)} → {s.checkoutAt ? isoToVnHHMM(s.checkoutAt) : 'đang mở'}
                          {s.isLate ? ' · trễ' : ''}
                        </Text>
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        ))}
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
