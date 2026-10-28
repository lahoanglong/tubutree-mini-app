import { useEffect, useMemo, useState } from 'react';
import { Input, Page, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Landmark, ChevronDown } from 'lucide-react';
import { getMyPayroll, updateBank, type PayrollStatus, type PayrollDay, type StaffProfile } from '../services/payroll-api';
import { getHistory, type SessionHistory } from '../services/attendance-api';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Field } from '../components/ui/form';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
import { ImageUpload } from '../components/image-upload';
import { PeriodNav } from '../components/period-nav';
import { formatVnd } from '../utils/format';
import {
  currentVnYearMonth,
  shiftYearMonth,
  dowLabel,
  dayOfMonth,
  mondayKeyOf,
  shortDayLabel,
  isoToVnHHMM,
  vnDateTimeISO,
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
  const navigate = useNavigate();
  if (role !== 'STAFF' && role !== 'ADMIN') {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title="Lương của tôi" />
        <EmptyState
          art="leaf"
          heading="Trang dành cho nhân viên"
          body="Tài khoản này chưa có quyền nhân viên. Liên hệ quản trị để được cấp quyền."
          ctaLabel="Về Cá nhân"
          onCta={() => navigate('/profile')}
        />
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
  // Biên phải theo GIỜ VN, không phải UTC: BE lọc lịch sử theo `checkinAt` thật, lệch 7 tiếng
  // nghĩa là phiên checkin 06:00 sáng ngày 1 (= 23:00 UTC ngày cuối tháng trước) rơi ra ngoài
  // khoảng — bảng lương vẫn hiện giờ công và tiền của ngày đó, nhưng bấm xổ ra lại báo "Không có
  // phiên chấm công", nhân viên tưởng hệ thống tính khống. BE cho admin đã sửa đúng chỗ này.
  const monFrom = vnDateTimeISO(`${ym.year}-${String(ym.month).padStart(2, '0')}-01`, '00:00');
  const nextM = shiftYearMonth(ym.year, ym.month, 1);
  const monTo = vnDateTimeISO(`${nextM.year}-${String(nextM.month).padStart(2, '0')}-01`, '00:00');
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

  // Hồ sơ ngân hàng không đổi theo tháng — giữ lại giá trị lần fetch THÀNH CÔNG gần nhất.
  // Tránh: đổi tháng → payQ.data tạm về undefined trong lúc refetch → nếu bấm "Thông tin nhận
  // lương" đúng lúc đó, openBank() sẽ nạp field RỖNG vào form; bấm "Lưu" sẽ gửi chuỗi rỗng và
  // updateBank() ở BE (prisma upsert `update: dto`) ĐÈ mất bankBin/accountNo/accountName đã lưu.
  const [profileCache, setProfileCache] = useState<StaffProfile | null>(null);
  useEffect(() => {
    if (payQ.data) setProfileCache(payQ.data.profile);
  }, [payQ.data]);

  const [bankOpen, setBankOpen] = useState(false);
  const [bin, setBin] = useState('');
  const [accNo, setAccNo] = useState('');
  const [accName, setAccName] = useState('');
  const [qr, setQr] = useState('');

  const openBank = () => {
    setBin(profileCache?.bankBin ?? '');
    setAccNo(profileCache?.bankAccountNo ?? '');
    setAccName(profileCache?.bankAccountName ?? '');
    setQr(profileCache?.qrImageUrl ?? '');
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
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 96 }}>
      <PageHeader title="Lương của tôi" />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PeriodNav
          label={`Tháng ${ym.month}/${ym.year}`}
          prevLabel="Tháng trước"
          nextLabel="Tháng sau"
          onPrev={() => setYm(shiftYearMonth(ym.year, ym.month, -1))}
          onNext={() => setYm(shiftYearMonth(ym.year, ym.month, 1))}
        />

        {payQ.isLoading && <Skeleton height={120} radius="var(--radius-card)" />}
        {payQ.isError && <ErrorState message={getLoadErrorMessage(payQ.error)} onRetry={() => void payQ.refetch()} />}

        {m && (
          <div
            style={{
              background: 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))',
              borderRadius: 'var(--radius-card)',
              padding: 16,
            }}
          >
            <Text variant="body-sm" tone="inverse" as="div">
              Thực nhận tháng {m.month}/{m.year}
            </Text>
            <Text variant="price-xl" tone="inverse" as="div" style={{ marginTop: 2 }}>
              {formatVnd(m.net)}
            </Text>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
              <Text variant="caption" tone="inverse">Giờ công: {fmtH(m.totalMinutes)}</Text>
              <Text variant="caption" tone="inverse">Đơn giá: {formatVnd(payQ.data?.profile?.hourlyRate ?? 0)}/h</Text>
              <Text variant="caption" tone="inverse">Lương gộp: {formatVnd(m.gross)}</Text>
              <Text variant="caption" tone="inverse">Phạt: {formatVnd(m.totalFines)}</Text>
            </div>
            <div style={{ marginTop: 8 }}>
              <Badge tone="neutral">{STATUS_LABEL[m.status]}</Badge>
            </div>
            {m.status === 'PAID' && m.proofImageUrl && (
              <div style={{ marginTop: 10 }}>
                <Text variant="caption" tone="inverse" as="div" style={{ marginBottom: 4 }}>
                  Ảnh xác nhận đã chuyển:
                </Text>
                <img src={m.proofImageUrl} alt="Xác nhận chuyển khoản" style={{ maxWidth: '100%', borderRadius: 'var(--radius-media)' }} />
              </div>
            )}
          </div>
        )}

        <Button variant="secondary" icon={Landmark} onPress={openBank}>
          Thông tin nhận lương
        </Button>

        {/* Chi tiết theo TUẦN → xổ ngày → xổ phiên checkin/out */}
        {weeks.map((w, i) => (
          <Card key={w.wk}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Text style={{ fontWeight: 700 }}>
                Tuần {i + 1} ({shortDayLabel(w.wk)}–{shortDayLabel(new Date(new Date(`${w.wk}T00:00:00Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10))})
              </Text>
              <Text variant="body-sm" tone="brand" style={{ fontWeight: 700 }}>
                {fmtH(w.minutes)} · {formatVnd(w.net)}
              </Text>
            </div>
            {w.days.map((d) => {
              const key = d.workDate.slice(0, 10);
              const sess = sessionsByDay[key] ?? [];
              const isOpen = openDay === key;
              return (
                <div key={d.id} style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                  <div
                    role="button"
                    aria-expanded={isOpen}
                    {...rowKeyboardProps()}
                    className="tubu-press"
                    onClick={() => setOpenDay(isOpen ? null : key)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      minHeight: 44,
                      padding: '6px 0',
                      boxSizing: 'border-box',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Icon
                        icon={ChevronDown}
                        size="sm"
                        tone="muted"
                        style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--motion-enter)' }}
                      />
                      <Text variant="body-sm">{dowLabel(key)} {dayOfMonth(key)} · {fmtH(d.workedMinutes)}</Text>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Text variant="body-sm" as="div" style={{ fontWeight: 700 }}>{formatVnd(d.net)}</Text>
                      {d.fines > 0 && <Text variant="caption" tone="danger" as="div">−{formatVnd(d.fines)} phạt</Text>}
                    </div>
                  </div>
                  {isOpen && (
                    <div style={{ paddingLeft: 24, paddingBottom: 6 }}>
                      {sess.length === 0 && <Text variant="caption" tone="tertiary" as="div">Không có phiên chấm công.</Text>}
                      {sess.map((s) => (
                        <Text key={s.id} variant="caption" tone="secondary" as="div">
                          {isoToVnHHMM(s.checkinAt)} → {s.checkoutAt ? isoToVnHHMM(s.checkoutAt) : 'đang mở'}
                          {s.isLate ? ' · trễ' : ''}
                        </Text>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        ))}
        {payQ.data && payQ.data.days.length === 0 && (
          <EmptyState art="box" heading="Chưa có dữ liệu công tháng này." variant="inline" />
        )}
      </div>

      <BottomSheet
        open={bankOpen}
        onClose={() => setBankOpen(false)}
        title="Thông tin nhận lương"
        footer={
          <Button fullWidth loading={bankM.isPending} onPress={() => bankM.mutate()}>
            Lưu
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Mã số ngân hàng (6 chữ số, VD 970407; chưa biết thì tải ảnh QR ở dưới)">
            <Input inputMode="numeric" value={bin} onChange={(e) => setBin(e.target.value)} />
          </Field>
          <Field label="Số tài khoản">
            <Input inputMode="numeric" value={accNo} onChange={(e) => setAccNo(e.target.value)} />
          </Field>
          <Field label="Tên chủ tài khoản">
            <Input value={accName} onChange={(e) => setAccName(e.target.value)} />
          </Field>
          <Text variant="caption" tone="tertiary" as="div">Hoặc tải ảnh QR nhận tiền (ưu tiên nếu có):</Text>
          <ImageUpload label="QR nhận lương" value={qr} onChange={setQr} />
        </div>
      </BottomSheet>
    </Page>
  );
}
