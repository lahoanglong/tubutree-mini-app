import { useMemo, useState } from 'react';
import { Input, Page, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, ShieldCheck, Check, X, Clock, Plus, MessagesSquare, Download } from 'lucide-react';
import { listStaff, grantStaff, revokeStaff, type StaffRole } from '../services/staff-api';
import {
  adminGetShifts,
  approveShift,
  rejectShift,
  bulkApproveShifts,
  adminGetTemplates,
  createTemplate,
  deleteTemplate,
  type AdminShift,
} from '../services/shifts-api';
import {
  adminGetPayroll,
  adminGetDetail,
  setRate,
  finalizePayroll,
  reopenPayroll,
  markPaid,
  type AdminPayrollRow,
  type PayrollStatus,
} from '../services/payroll-api';
import { adminEditSession } from '../services/attendance-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { vi } from '../i18n/vi';
import { Badge, type BadgeTone } from '../components/ui/badge';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Field } from '../components/ui/form';
import { KeyValueRow } from '../components/ui/key-value-row';
import { PageHeader } from '../components/ui/page-header';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { SearchField } from '../components/ui/search-field';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { Skeleton } from '../components/ui/skeleton';
import { Heading, Text } from '../components/ui/text';
import { TimeInput } from '../components/ui/time-input';
import { ImageUpload } from '../components/image-upload';
import { PeriodNav } from '../components/period-nav';
import { formatVnd, formatDateTime } from '../utils/format';
import {
  mondayKeyOf,
  addDaysKey,
  keyToUtcMidnightISO,
  vnDateTimeISO,
  isoToVnHHMM,
  minToHHMM,
  hhmmToMin,
  shortDayLabel,
  dowLabel,
  currentVnYearMonth,
  shiftYearMonth,
  vnDateKey,
} from '../utils/week';

import {
  getPendingRefillReturns,
  approveRefillReturn,
  rejectRefillReturn,
  type PendingRefillItem,
} from '../services/refill-api';

export default function AdminPage() {
  const role = useAuthStore((s) => s.user?.role);
  if (role !== 'ADMIN') {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title="Quản trị nhân sự" />
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Text tone="secondary">Chỉ quản trị viên mới truy cập được trang này.</Text>
        </div>
      </Page>
    );
  }
  return <AdminHub />;
}

type Tab = 'staff' | 'shifts' | 'payroll' | 'refill';

const TABS: { key: Tab; label: string }[] = [
  { key: 'staff', label: 'Nhân sự' },
  { key: 'shifts', label: 'Duyệt ca' },
  { key: 'payroll', label: 'Lương' },
  { key: 'refill', label: 'Duyệt đổi vỏ' },
];

const SECTION_STYLE = { padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 } as const;

function AdminHub() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('staff');
  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 96 }}>
      <PageHeader title="Quản trị nhân sự" />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ alignSelf: 'stretch' }}>
          <SegmentedTabs scroll items={TABS} value={tab} onChange={(key) => setTab(key as Tab)} />
        </div>
        <Button variant="secondary" icon={MessagesSquare} onPress={() => navigate('/admin/community')}>
          {vi.community.moderation}
        </Button>
      </div>
      <div role="tabpanel" aria-label={TABS.find((x) => x.key === tab)?.label}>
        {tab === 'staff' ? (
          <StaffSection />
        ) : tab === 'shifts' ? (
          <ShiftsSection />
        ) : tab === 'payroll' ? (
          <PayrollSection />
        ) : (
          <RefillAdminSection />
        )}
      </div>
    </Page>
  );
}

const SHIFT_STATUS: Record<AdminShift['status'], { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

const PAY_STATUS: Record<PayrollStatus, string> = { OPEN: 'Đang tính', FINALIZED: 'Đã chốt', PAID: 'Đã trả' };
const fmtHM = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;

function PayrollSection() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [ym, setYm] = useState(() => currentVnYearMonth());
  const payQ = useQuery({ queryKey: ['admin-payroll', ym.year, ym.month], queryFn: () => adminGetPayroll(ym.year, ym.month) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-payroll', ym.year, ym.month] });

  const [qrRow, setQrRow] = useState<AdminPayrollRow | null>(null);
  const [rateRow, setRateRow] = useState<AdminPayrollRow | null>(null);
  const [rateVal, setRateVal] = useState('');
  const [payRow, setPayRow] = useState<AdminPayrollRow | null>(null);
  const [proof, setProof] = useState('');
  const [note, setNote] = useState('');
  const [detailRow, setDetailRow] = useState<AdminPayrollRow | null>(null);

  const rateM = useMutation({
    mutationFn: () => setRate(rateRow!.staff.id, Number(rateVal)),
    onSuccess: () => {
      openSnackbar({ text: 'Đã lưu đơn giá.', type: 'success' });
      setRateRow(null);
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const finalizeM = useMutation({
    mutationFn: (r: AdminPayrollRow) => finalizePayroll(r.staff.id, ym.year, ym.month),
    onSuccess: () => {
      openSnackbar({ text: 'Đã chốt lương.', type: 'success' });
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const reopenM = useMutation({
    mutationFn: (r: AdminPayrollRow) => reopenPayroll(r.staff.id, ym.year, ym.month),
    onSuccess: () => {
      openSnackbar({ text: 'Đã mở lại bảng lương — sửa xong nhớ chốt lại.', type: 'success' });
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const paidM = useMutation({
    mutationFn: () => markPaid(payRow!.staff.id, { year: ym.year, month: ym.month, proofImageUrl: proof, note: note || undefined }),
    onSuccess: () => {
      openSnackbar({ text: 'Đã đánh dấu đã trả lương.', type: 'success' });
      setPayRow(null);
      setProof('');
      setNote('');
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <div style={SECTION_STYLE}>
      <Heading variant="title-md" as="h2">
        Lương
      </Heading>
      <PeriodNav
        label={`Tháng ${ym.month}/${ym.year}`}
        prevLabel="Tháng trước"
        nextLabel="Tháng sau"
        onPrev={() => setYm(shiftYearMonth(ym.year, ym.month, -1))}
        onNext={() => setYm(shiftYearMonth(ym.year, ym.month, 1))}
      />

      {payQ.isLoading && <Skeleton height={120} radius="var(--radius-card)" />}
      {payQ.isError && <ErrorState message={getErrorMessage(payQ.error)} onRetry={() => void payQ.refetch()} />}

      {payQ.data?.map((row) => {
        const name = row.staff.fullName ?? row.staff.phone ?? 'NV';
        // Chỉ dòng đang chạy có spinner; dòng khác khoá để không chốt/mở lại hai nhân viên cùng lúc.
        const finalizing = finalizeM.isPending && finalizeM.variables?.staff.id === row.staff.id;
        const reopening = reopenM.isPending && reopenM.variables?.staff.id === row.staff.id;
        return (
          <Card key={row.staff.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Heading variant="title-sm" as="h3">
                  {name}
                </Heading>
                <Text variant="caption" tone="secondary" as="div">
                  {fmtHM(row.month.totalMinutes)} · {formatVnd(row.profile?.hourlyRate ?? 0)}/h · {PAY_STATUS[row.month.status]}
                </Text>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Text as="div" tone="brand" style={{ fontWeight: 700 }}>
                  {formatVnd(row.month.net)}
                </Text>
                {row.month.totalFines > 0 && (
                  <Text variant="caption" tone="danger" as="div">
                    −{formatVnd(row.month.totalFines)}
                  </Text>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <Button variant="secondary" aria-label={`Xem giờ · ${name}`} onPress={() => setDetailRow(row)}>
                Xem giờ
              </Button>
              <Button
                variant="secondary"
                aria-label={`Đơn giá · ${name}`}
                onPress={() => {
                  setRateRow(row);
                  setRateVal(String(row.profile?.hourlyRate ?? 0));
                }}
              >
                Đơn giá
              </Button>
              {(row.qrImageUrl || row.profile?.qrImageUrl) && (
                <Button variant="secondary" aria-label={`QR chuyển · ${name}`} onPress={() => setQrRow(row)}>
                  QR chuyển
                </Button>
              )}
              {row.month.status === 'OPEN' && (
                <Button
                  variant="secondary"
                  aria-label={`Chốt · ${name}`}
                  loading={finalizing}
                  disabled={finalizeM.isPending && !finalizing}
                  onPress={() => finalizeM.mutate(row)}
                >
                  Chốt
                </Button>
              )}
              {row.month.status !== 'PAID' && (
                <Button
                  aria-label={`Đã chuyển · ${name}`}
                  onPress={() => {
                    setPayRow(row);
                    setProof('');
                    setNote('');
                  }}
                >
                  Đã chuyển
                </Button>
              )}
              {/* Chốt/đã trả xong mà phát hiện sai giờ thì trước đây hết cách sửa trong app. */}
              {row.month.status !== 'OPEN' && (
                <Button
                  variant="ghost"
                  aria-label={`Mở lại · ${name}`}
                  loading={reopening}
                  disabled={reopenM.isPending && !reopening}
                  onPress={() => {
                    if (!window.confirm(`Mở lại bảng lương T${ym.month}/${ym.year} của ${row.staff.fullName ?? 'NV'}? Cần chốt lại sau khi sửa.`)) return;
                    reopenM.mutate(row);
                  }}
                >
                  Mở lại
                </Button>
              )}
            </div>
          </Card>
        );
      })}
      {payQ.data && payQ.data.length === 0 && <EmptyState art="box" heading="Chưa có nhân sự" />}

      {/* Sheet QR */}
      <BottomSheet open={!!qrRow} onClose={() => setQrRow(null)} title={`Chuyển lương ${qrRow?.staff.fullName ?? ''}`}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <Text variant="price-xl" tone="brand">
            {formatVnd(qrRow?.month.net ?? 0)}
          </Text>
          {qrRow && (qrRow.qrImageUrl || qrRow.profile?.qrImageUrl) && (
            <img src={(qrRow.qrImageUrl ?? qrRow.profile?.qrImageUrl) as string} alt="QR" style={{ maxWidth: 260, width: '100%' }} />
          )}
          {qrRow?.profile?.bankAccountNo && (
            <Text variant="body-sm">
              {qrRow.profile.bankAccountName} · {qrRow.profile.bankAccountNo}
            </Text>
          )}
          <Text variant="caption" tone="secondary" as="div">
            Quét chuyển khoản rồi bấm "Đã chuyển" để tải ảnh xác nhận.
          </Text>
        </div>
      </BottomSheet>

      {/* Sheet đơn giá */}
      <BottomSheet
        open={!!rateRow}
        onClose={() => setRateRow(null)}
        title={`Đơn giá giờ · ${rateRow?.staff.fullName ?? ''}`}
        footer={
          <Button fullWidth loading={rateM.isPending} disabled={!/^\d+$/.test(rateVal)} onPress={() => rateM.mutate()}>
            Lưu đơn giá
          </Button>
        }
      >
        <Field label="Đơn giá (VND/giờ)">
          <Input type="number" value={rateVal} onChange={(e) => setRateVal(e.target.value)} />
        </Field>
      </BottomSheet>

      {/* Sheet đã chuyển */}
      <BottomSheet
        open={!!payRow}
        onClose={() => setPayRow(null)}
        title={`Xác nhận đã chuyển · ${payRow?.staff.fullName ?? ''}`}
        footer={
          <Button fullWidth loading={paidM.isPending} disabled={!proof} onPress={() => paidM.mutate()}>
            Đánh dấu đã trả
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <KeyValueRow label="Số tiền" value={formatVnd(payRow?.month.net ?? 0)} emphasis />
          <ImageUpload label="Ảnh xác nhận chuyển khoản *" value={proof} onChange={setProof} />
          <Field label="Ghi chú (tuỳ chọn)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </BottomSheet>

      {/* Sheet xem giờ + sửa phiên */}
      <DetailSheet row={detailRow} year={ym.year} month={ym.month} onClose={() => setDetailRow(null)} onChanged={invalidate} />
    </div>
  );
}

function DetailSheet({
  row,
  year,
  month,
  onClose,
  onChanged,
}: {
  row: AdminPayrollRow | null;
  year: number;
  month: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const staffId = row?.staff.id ?? '';
  const detailQ = useQuery({
    queryKey: ['admin-payroll-detail', staffId, year, month],
    queryFn: () => adminGetDetail(staffId, year, month),
    enabled: !!row,
  });

  const [editId, setEditId] = useState<string | null>(null);
  const [ci, setCi] = useState('08:00');
  const [co, setCo] = useState('17:00');

  const editM = useMutation({
    mutationFn: (dayKey: string) =>
      adminEditSession(editId as string, {
        // Ca qua đêm: checkout 02:00 thuộc NGÀY HÔM SAU. Dựng cả hai mốc theo cùng một ngày như
        // trước sẽ gửi checkout < checkin → BE từ chối, và quản lý bấm bao nhiêu lần cũng lỗi mà
        // không có cách nào sửa. Màn của nhân viên đã xử lý đúng (staff.tsx) — chỉ màn này sót.
        //
        // `co < ci` chứ KHÔNG phải `<=`: phiên chưa checkout được khởi tạo co = ci, nên dấu `=`
        // sẽ đẩy checkout sang hôm sau và ghi thành ca đúng 24 tiếng — BE chỉ chặn
        // checkout <= checkin nên nó lọt, rồi payroll trả tiền cho 24 giờ đó.
        checkinAt: vnDateTimeISO(dayKey, ci),
        checkoutAt: vnDateTimeISO(co < ci ? addDaysKey(dayKey, 1) : dayKey, co),
      }),
    onSuccess: () => {
      openSnackbar({ text: 'Đã sửa giờ & tính lại.', type: 'success' });
      setEditId(null);
      qc.invalidateQueries({ queryKey: ['admin-payroll-detail', staffId, year, month] });
      onChanged();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <BottomSheet open={!!row} onClose={onClose} title={`Giờ công · ${row?.staff.fullName ?? ''} · T${month}/${year}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60vh', overflowY: 'auto' }}>
        {detailQ.isLoading && <Skeleton height={100} radius="var(--radius-card)" />}
        {detailQ.data && (
          <>
            <Text variant="body-sm" as="div">
              Tổng: <strong>{fmtHM(detailQ.data.month.totalMinutes)}</strong> · Thực nhận <strong>{formatVnd(detailQ.data.month.net)}</strong>
            </Text>
            {detailQ.data.days.map((d) => {
              const dayKey = d.workDate.slice(0, 10);
              const sess = detailQ.data!.sessions.filter((s) => vnDateKey(new Date(s.checkinAt)) === dayKey);
              return (
                <div key={d.id} style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <Text variant="body-sm" style={{ fontWeight: 700 }}>
                      {dowLabel(dayKey)} {shortDayLabel(dayKey)} · {fmtHM(d.workedMinutes)}
                    </Text>
                    <Text variant="body-sm">{formatVnd(d.net)}</Text>
                  </div>
                  {sess.map((s) => (
                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingLeft: 8, marginTop: 2 }}>
                      <Text variant="caption" tone="secondary">
                        {isoToVnHHMM(s.checkinAt)} → {s.checkoutAt ? isoToVnHHMM(s.checkoutAt) : 'đang mở'}{s.isLate ? ' · trễ' : ''}
                      </Text>
                      <Button
                        variant="ghost"
                        aria-label={`Sửa giờ phiên ${isoToVnHHMM(s.checkinAt)}`}
                        onPress={() => {
                          setEditId(s.id);
                          setCi(isoToVnHHMM(s.checkinAt));
                          setCo(s.checkoutAt ? isoToVnHHMM(s.checkoutAt) : isoToVnHHMM(s.checkinAt));
                        }}
                      >
                        Sửa giờ
                      </Button>
                    </div>
                  ))}
                  {sess.length === 0 && (
                    <Text variant="caption" tone="tertiary" as="div" style={{ paddingLeft: 8 }}>
                      Không có phiên.
                    </Text>
                  )}

                  {editId && sess.some((s) => s.id === editId) && (
                    <div style={{ paddingLeft: 8, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <Field label="Giờ vào">
                            <TimeInput value={ci} onChange={setCi} />
                          </Field>
                        </div>
                        <div style={{ flex: 1 }}>
                          <Field label="Giờ ra">
                            <TimeInput value={co} onChange={setCo} />
                          </Field>
                        </div>
                      </div>
                      {/* co === ci là phiên chưa checkout (ô giờ ra khởi tạo bằng giờ vào) —
                          lưu lúc đó là ghi một khoảng 0 phút hoặc, nếu suy sang hôm sau, cả 24
                          tiếng. Bắt quản lý nhập giờ ra thật trước. */}
                      {co === ci && (
                        <Text variant="caption" tone="warning" as="div">
                          Nhập giờ ra khác giờ vào để lưu.
                        </Text>
                      )}
                      <Button loading={editM.isPending} disabled={co === ci} onPress={() => editM.mutate(dayKey)}>
                        Lưu giờ
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {detailQ.data.days.length === 0 && (
              <Text variant="body-sm" tone="secondary" as="div">
                Chưa có công tháng này.
              </Text>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}

const PHONE_RE = /^0\d{8,10}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;

function StaffSection() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const staffQ = useQuery({ queryKey: ['admin-staff'], queryFn: listStaff });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('STAFF');

  const grantM = useMutation({
    mutationFn: () => grantStaff(phone.trim(), role),
    onSuccess: (r) => {
      openSnackbar({
        text: r.applied ? 'Đã cấp quyền & áp ngay.' : 'Đã lưu quyền (sẽ áp khi họ mở app).',
        type: 'success',
      });
      setSheetOpen(false);
      setPhone('');
      qc.invalidateQueries({ queryKey: ['admin-staff'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const revokeM = useMutation({
    mutationFn: (p: string) => revokeStaff(p),
    onSuccess: (res) => {
      openSnackbar(
        res.storeBlocked
          ? {
              text: 'Đã gỡ quyền, nhưng gian hàng đối tác của người này còn việc dở nên được giữ nguyên và họ có thể chưa dùng được Cổng người bán. Xử lý ở tab "Đơn đối tác & đối soát" trên web admin rồi tắt cờ đối tác, hoặc đặt lại vai trò DEALER cho người này.',
              type: 'warning',
            }
          : { text: 'Đã thu hồi quyền.', type: 'success' },
      );
      qc.invalidateQueries({ queryKey: ['admin-staff'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  // Cấp ADMIN là privilege-escalation rủi ro cao hơn hẳn cấp STAFF — thêm bước xác nhận phụ
  // (mirror pattern window.confirm trong apps/web/src/app/admin/page.tsx's GrantRoleForm).
  const submitGrant = () => {
    if (role === 'ADMIN' && !window.confirm(`Xác nhận cấp quyền ADMIN (toàn quyền quản trị) cho SĐT ${phone.trim()}?`)) {
      return;
    }
    grantM.mutate();
  };

  return (
    <div style={SECTION_STYLE}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Heading variant="title-md" as="h2">
          Nhân sự
        </Heading>
        <Button icon={UserPlus} onPress={() => setSheetOpen(true)}>
          Thêm
        </Button>
      </div>

      {staffQ.isLoading && <Skeleton height={80} radius="var(--radius-card)" />}
      {staffQ.isError && <ErrorState message={getErrorMessage(staffQ.error)} onRetry={() => void staffQ.refetch()} />}

      {staffQ.data && (
        <>
          {staffQ.data.members.map((m) => (
            <Card key={m.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text as="div" style={{ fontWeight: 700 }}>
                    {m.fullName ?? 'Chưa có tên'}
                  </Text>
                  <Text variant="caption" tone="secondary" as="div">
                    {m.phone ?? '—'} · {m.role === 'ADMIN' ? 'Quản trị' : 'Nhân viên'}
                  </Text>
                </div>
                {m.phone && (
                  <Button
                    variant="ghost"
                    aria-label={`Thu hồi · ${m.fullName ?? m.phone}`}
                    style={{ color: 'var(--color-text-danger)' }}
                    disabled={revokeM.isPending}
                    onPress={() => {
                      // Thao tác một chạm, không hoàn tác được từ trong app: hạ quyền nhầm một
                      // quản trị viên thì chỉ người còn quyền mới cấp lại được. Cấp quyền ADMIN
                      // đã hỏi lại ở submitGrant — thu hồi thì chưa.
                      if (
                        !window.confirm(
                          `Thu hồi quyền của ${m.fullName ?? m.phone}? Người này sẽ mất toàn bộ quyền nhân viên/quản trị.`,
                        )
                      ) {
                        return;
                      }
                      revokeM.mutate(m.phone as string);
                    }}
                  >
                    Thu hồi
                  </Button>
                )}
              </div>
            </Card>
          ))}

          {staffQ.data.members.length === 0 && (
            <EmptyState art="box" heading="Chưa có nhân sự" body="Bấm “Thêm” để cấp quyền theo số điện thoại." />
          )}

          {staffQ.data.pendingInvites.length > 0 && (
            <>
              <Heading variant="title-sm" as="h3" style={{ marginTop: 8 }}>
                Chờ mở app
              </Heading>
              {staffQ.data.pendingInvites.map((p) => (
                <Card key={p.phone} variant="flat">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <Text variant="body-sm">
                      {p.phone} · {p.role === 'ADMIN' ? 'Quản trị' : 'Nhân viên'}
                    </Text>
                    <Button
                      variant="ghost"
                      aria-label={`Huỷ lời mời · ${p.phone}`}
                      disabled={revokeM.isPending}
                      onPress={() => revokeM.mutate(p.phone)}
                    >
                      Huỷ
                    </Button>
                  </div>
                </Card>
              ))}
            </>
          )}
        </>
      )}

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Thêm nhân sự theo SĐT"
        footer={
          <Button fullWidth loading={grantM.isPending} disabled={!PHONE_RE.test(phone.trim())} onPress={submitGrant}>
            Lưu quyền
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Số điện thoại">
            <Input type="number" placeholder="Số điện thoại (VD 09xxxxxxxx)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <div role="group" aria-label="Vai trò" style={{ display: 'flex', gap: 8 }}>
            <Button
              variant={role === 'STAFF' ? 'primary' : 'secondary'}
              aria-pressed={role === 'STAFF'}
              icon={UserPlus}
              style={{ flex: 1 }}
              onPress={() => setRole('STAFF')}
            >
              Nhân viên
            </Button>
            <Button
              variant={role === 'ADMIN' ? 'primary' : 'secondary'}
              aria-pressed={role === 'ADMIN'}
              icon={ShieldCheck}
              style={{ flex: 1 }}
              onPress={() => setRole('ADMIN')}
            >
              Quản trị
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

function ShiftsSection() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [mondayKey, setMondayKey] = useState(() => mondayKeyOf(new Date()));
  const fromISO = keyToUtcMidnightISO(mondayKey);
  const toISO = `${addDaysKey(mondayKey, 6)}T23:59:59.999Z`;

  const shiftsQ = useQuery({
    queryKey: ['admin-shifts', mondayKey],
    queryFn: () => adminGetShifts(fromISO, toISO),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-shifts', mondayKey] });

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; shifts: AdminShift[] }>();
    for (const s of shiftsQ.data ?? []) {
      const name = s.staff.fullName ?? s.staff.phone ?? 'NV';
      const entry = map.get(s.staffId) ?? { name, shifts: [] };
      entry.shifts.push(s);
      map.set(s.staffId, entry);
    }
    return [...map.values()];
  }, [shiftsQ.data]);

  const pendingIds = useMemo(
    () => (shiftsQ.data ?? []).filter((s) => s.status === 'PENDING').map((s) => s.id),
    [shiftsQ.data],
  );

  const approveM = useMutation({
    mutationFn: (v: { id: string; approvedStart?: string; approvedEnd?: string }) =>
      approveShift(v.id, v.approvedStart ? { approvedStart: v.approvedStart, approvedEnd: v.approvedEnd } : undefined),
    onSuccess: () => {
      openSnackbar({ text: 'Đã duyệt ca.', type: 'success' });
      setAdjust(null);
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const rejectM = useMutation({
    mutationFn: (v: { id: string; reason: string }) => rejectShift(v.id, v.reason),
    onSuccess: () => {
      openSnackbar({ text: 'Đã từ chối ca.', type: 'success' });
      setRejectId(null);
      setRejectReason('');
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const bulkM = useMutation({
    mutationFn: () => bulkApproveShifts(pendingIds),
    onSuccess: (r) => {
      openSnackbar({ text: `Đã duyệt ${r.approved} ca.`, type: 'success' });
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const [adjust, setAdjust] = useState<{ id: string; dayKey: string } | null>(null);
  const [adjStart, setAdjStart] = useState('08:00');
  const [adjEnd, setAdjEnd] = useState('12:00');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [tplOpen, setTplOpen] = useState(false);

  const openAdjust = (s: AdminShift) => {
    setAdjust({ id: s.id, dayKey: s.workDate.slice(0, 10) });
    setAdjStart(isoToVnHHMM(s.startAt));
    setAdjEnd(isoToVnHHMM(s.endAt));
  };

  return (
    <div style={SECTION_STYLE}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Heading variant="title-md" as="h2">
          Duyệt ca
        </Heading>
        <Button variant="secondary" icon={Clock} onPress={() => setTplOpen(true)}>
          Ca chuẩn
        </Button>
      </div>

      <PeriodNav
        label={`${shortDayLabel(mondayKey)} – ${shortDayLabel(addDaysKey(mondayKey, 6))}`}
        prevLabel="Tuần trước"
        nextLabel="Tuần sau"
        onPrev={() => setMondayKey(addDaysKey(mondayKey, -7))}
        onNext={() => setMondayKey(addDaysKey(mondayKey, 7))}
      />

      {pendingIds.length > 0 && (
        <Button loading={bulkM.isPending} onPress={() => bulkM.mutate()}>
          Duyệt tất cả ({pendingIds.length})
        </Button>
      )}

      {shiftsQ.isLoading && <Skeleton height={120} radius="var(--radius-card)" />}
      {shiftsQ.isError && <ErrorState message={getErrorMessage(shiftsQ.error)} onRetry={() => void shiftsQ.refetch()} />}
      {shiftsQ.data && grouped.length === 0 && (
        <EmptyState art="box" heading="Không có ca nào trong tuần này" />
      )}

      {grouped.map((g) => (
        <Card key={g.name}>
          <Heading variant="title-sm" as="h3" style={{ marginBottom: 6 }}>
            {g.name}
          </Heading>
          {g.shifts.map((s) => {
            const start = isoToVnHHMM(s.approvedStart ?? s.startAt);
            const end = isoToVnHHMM(s.approvedEnd ?? s.endAt);
            const st = SHIFT_STATUS[s.status];
            const dayName = `${dowLabel(s.workDate.slice(0, 10))} ${shortDayLabel(s.workDate.slice(0, 10))}`;
            const approving = approveM.isPending && approveM.variables?.id === s.id;
            return (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                  padding: '8px 0',
                  borderTop: '1px solid var(--color-border-subtle)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="body-sm" as="div">
                    {dayName} · {start}–{end}
                  </Text>
                  <div style={{ marginTop: 2 }}>
                    <Badge tone={st.tone} size="sm">
                      {st.label}
                    </Badge>
                  </div>
                </div>
                {s.status === 'PENDING' && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <Button variant="ghost" icon={Clock} aria-label={`Chỉnh giờ ${g.name} ${dayName}`} onPress={() => openAdjust(s)}>
                      Chỉnh giờ
                    </Button>
                    <Button
                      variant="ghost"
                      icon={Check}
                      aria-label={`Duyệt ca ${g.name} ${dayName}`}
                      loading={approving}
                      onPress={() => approveM.mutate({ id: s.id })}
                    >
                      Duyệt
                    </Button>
                    <Button
                      variant="ghost"
                      icon={X}
                      aria-label={`Từ chối ca ${g.name} ${dayName}`}
                      style={{ color: 'var(--color-text-danger)' }}
                      onPress={() => setRejectId(s.id)}
                    >
                      Từ chối
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      ))}

      {/* Sheet chỉnh giờ + duyệt */}
      <BottomSheet
        open={!!adjust}
        onClose={() => setAdjust(null)}
        title="Chỉnh giờ & duyệt"
        footer={
          <Button
            fullWidth
            loading={approveM.isPending}
            disabled={!TIME_RE.test(adjStart) || !TIME_RE.test(adjEnd)}
            onPress={() =>
              adjust &&
              approveM.mutate({
                id: adjust.id,
                approvedStart: vnDateTimeISO(adjust.dayKey, adjStart),
                approvedEnd: vnDateTimeISO(adjust.dayKey, adjEnd),
              })
            }
          >
            Duyệt với giờ đã chỉnh
          </Button>
        }
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Field label="Bắt đầu">
              <Input type="text" value={adjStart} onChange={(e) => setAdjStart(e.target.value)} />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Kết thúc">
              <Input type="text" value={adjEnd} onChange={(e) => setAdjEnd(e.target.value)} />
            </Field>
          </div>
        </div>
      </BottomSheet>

      {/* Sheet từ chối */}
      <BottomSheet
        open={!!rejectId}
        onClose={() => setRejectId(null)}
        title="Từ chối ca"
        footer={
          <Button
            fullWidth
            loading={rejectM.isPending}
            disabled={rejectReason.trim().length === 0}
            onPress={() => rejectId && rejectM.mutate({ id: rejectId, reason: rejectReason.trim() })}
          >
            Xác nhận từ chối
          </Button>
        }
      >
        <Field label="Lý do">
          <Input.TextArea placeholder="Lý do" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
        </Field>
      </BottomSheet>

      <TemplateSheet visible={tplOpen} onClose={() => setTplOpen(false)} />
    </div>
  );
}

function TemplateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const tplQ = useQuery({ queryKey: ['admin-templates'], queryFn: adminGetTemplates, enabled: visible });
  const [name, setName] = useState('');
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('12:00');

  const addM = useMutation({
    mutationFn: () => createTemplate({ name: name.trim(), startMin: hhmmToMin(start), endMin: hhmmToMin(end) }),
    onSuccess: () => {
      openSnackbar({ text: 'Đã thêm ca chuẩn.', type: 'success' });
      setName('');
      qc.invalidateQueries({ queryKey: ['admin-templates'] });
      qc.invalidateQueries({ queryKey: ['shift-templates'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const delM = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-templates'] });
      qc.invalidateQueries({ queryKey: ['shift-templates'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <BottomSheet
      open={visible}
      onClose={onClose}
      title="Ca chuẩn"
      footer={
        <Button
          fullWidth
          icon={Plus}
          loading={addM.isPending}
          disabled={!name.trim() || !TIME_RE.test(start) || !TIME_RE.test(end)}
          onPress={() => addM.mutate()}
        >
          Thêm ca chuẩn
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(tplQ.data ?? []).map((t) => (
          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Text variant="body-sm">
              {t.name} · {minToHHMM(t.startMin)}–{minToHHMM(t.endMin)}
            </Text>
            <Button
              variant="ghost"
              aria-label={`Xoá ca chuẩn ${t.name}`}
              style={{ color: 'var(--color-text-danger)' }}
              disabled={delM.isPending}
              onPress={() => delM.mutate(t.id)}
            >
              Xoá
            </Button>
          </div>
        ))}
        <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Field label="Tên ca">
            <Input placeholder="Tên ca (VD Ca sáng)" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Field label="Bắt đầu">
                <Input type="text" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Kết thúc">
                <Input type="text" value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}

/**
 * Escape 1 field CSV chứa dữ liệu do người dùng nhập (tên, SĐT...):
 * - Nhân đôi dấu " để không vỡ cấu trúc cột (VD tên có dấu ngoặc kép).
 * - Nếu bắt đầu bằng =, +, -, @ thì thêm ' phía trước để Excel/Sheets
 *   không hiểu nhầm là công thức (CSV/formula injection).
 */
function csvField(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function RefillAdminSection() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [filterText, setFilterText] = useState('');
  const [received, setReceived] = useState<Record<string, number>>({});
  const pendingQ = useQuery({ queryKey: ['admin-refill-pending'], queryFn: getPendingRefillReturns });

  const approveM = useMutation({
    mutationFn: ({ id, receivedQuantity }: { id: string; receivedQuantity: number }) => approveRefillReturn(id, receivedQuantity),
    onSuccess: () => {
      openSnackbar({ text: 'Đã duyệt yêu cầu đổi vỏ chai.', type: 'success' });
      qc.invalidateQueries({ queryKey: ['admin-refill-pending'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const rejectM = useMutation({
    mutationFn: (id: string) => rejectRefillReturn(id),
    onSuccess: () => {
      openSnackbar({ text: 'Đã từ chối yêu cầu.', type: 'info' });
      qc.invalidateQueries({ queryKey: ['admin-refill-pending'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const filteredItems = pendingQ.data?.filter((r: PendingRefillItem) => {
    if (!filterText.trim()) return true;
    const q = filterText.toLowerCase();
    const name = (r.user.fullName ?? '').toLowerCase();
    const phone = (r.user.phone ?? '').toLowerCase();
    return name.includes(q) || phone.includes(q);
  }) ?? [];

  const exportCsv = () => {
    // Xuất đúng những gì admin đang thấy trên màn hình (đã lọc theo ô tìm kiếm),
    // KHÔNG xuất toàn bộ pendingQ.data — kẻo CSV lệch với danh sách đang lọc.
    if (filteredItems.length === 0) {
      openSnackbar({ text: 'Không có dữ liệu để xuất CSV', type: 'info' });
      return;
    }
    const headers = ['ID', 'Khách hàng', 'SĐT', 'Số vỏ chai', 'Số nước', 'Thời gian', 'Điểm nhận'];
    const rows = filteredItems.map((r: PendingRefillItem) => [
      r.id,
      csvField(r.user.fullName ?? ''),
      csvField(r.user.phone ?? ''),
      r.quantity,
      r.seedsAwarded,
      csvField(formatDateTime(r.createdAt)),
      csvField(r.pickupLocation?.name ?? ''),
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `bao_cao_doi_vo_chai_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    openSnackbar({ text: 'Đã xuất file báo cáo CSV!', type: 'success' });
  };

  return (
    <div style={SECTION_STYLE}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Heading variant="title-md" as="h2">
          Duyệt đổi vỏ chai ({filteredItems.length})
        </Heading>
        <Button variant="secondary" icon={Download} onPress={exportCsv}>
          Xuất CSV
        </Button>
      </div>

      <SearchField
        value={filterText}
        onChange={setFilterText}
        onSubmit={() => undefined}
        label="Tìm theo tên hoặc SĐT"
        clearLabel="Xoá từ khoá tìm"
        placeholder="Tìm theo tên hoặc SĐT..."
      />

      {pendingQ.isLoading && <Skeleton height={100} radius="var(--radius-card)" />}
      {pendingQ.isError && <ErrorState message={getErrorMessage(pendingQ.error)} onRetry={() => void pendingQ.refetch()} />}

      {pendingQ.data && filteredItems.length === 0 && (
        <EmptyState
          art={filterText ? 'search' : 'box'}
          heading={filterText ? 'Không tìm thấy yêu cầu phù hợp' : 'Không có yêu cầu đổi vỏ chai nào đang chờ duyệt'}
        />
      )}

      {filteredItems.map((r: PendingRefillItem) => {
        const name = r.user.fullName ?? r.user.phone ?? 'Khách hàng';
        // Chỉ yêu cầu đang xử lý có spinner; mọi nút còn lại khoá để không duyệt và từ chối chồng nhau.
        const approving = approveM.isPending && approveM.variables?.id === r.id;
        const receivedQuantity = Math.min(received[r.id] ?? r.quantity, r.quantity);
        const seedsPerBottle = r.quantity > 0 ? r.seedsAwarded / r.quantity : 0;
        const seedsPreview = Math.round(receivedQuantity * seedsPerBottle);
        const rejecting = rejectM.isPending && rejectM.variables === r.id;
        return (
          <Card key={r.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text as="div" style={{ fontWeight: 700 }}>
                  {name}
                </Text>
                <Text variant="caption" tone="secondary" as="div">
                  {r.user.phone ?? '—'} · Đổi <strong>{r.quantity} vỏ</strong> (+{r.seedsAwarded})
                </Text>
                {r.pickupLocation && (
                  <Text variant="caption" tone="secondary" as="div">
                    Mang tới: {r.pickupLocation.name} · {r.pickupLocation.address}
                  </Text>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button
                  variant="ghost"
                  icon={Check}
                  aria-label={`Duyệt · ${name}`}
                  loading={approving}
                  disabled={rejectM.isPending || (approveM.isPending && !approving)}
                  onPress={() => approveM.mutate({ id: r.id, receivedQuantity })}
                >
                  Duyệt
                </Button>
                <Button
                  variant="ghost"
                  icon={X}
                  aria-label={`Từ chối · ${name}`}
                  style={{ color: 'var(--color-text-danger)' }}
                  loading={rejecting}
                  disabled={approveM.isPending || (rejectM.isPending && !rejecting)}
                  onPress={() => rejectM.mutate(r.id)}
                >
                  Từ chối
                </Button>
              </div>
            </div>
            {r.quantity > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px solid var(--color-border-subtle)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Text as="div" style={{ fontWeight: 600 }}>
                    Vỏ thực nhận
                  </Text>
                  <Text variant="caption" tone="secondary" as="div">
                    Đếm tại điểm nhận · +{seedsPreview} giọt nước
                  </Text>
                </div>
                <QuantitySelector
                  size="sm"
                  value={receivedQuantity}
                  min={1}
                  max={r.quantity}
                  onChange={(n) => setReceived((prev) => ({ ...prev, [r.id]: n }))}
                />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
