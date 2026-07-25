import { useMemo, useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus,
  ShieldCheck,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Clock,
  Plus,
  MessagesSquare,
} from 'lucide-react';
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
  markPaid,
  type AdminPayrollRow,
  type PayrollStatus,
} from '../services/payroll-api';
import { adminEditSession } from '../services/attendance-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { vi } from '../i18n/vi';
import { Skeleton } from '../components/ui/skeleton';
import { TimeInput } from '../components/ui/time-input';
import { ImageUpload } from '../components/image-upload';
import { formatVnd } from '../utils/format';
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
      <Page className="page">
        <Box p={6} style={{ textAlign: 'center' }}>
          <Text style={{ color: 'var(--neutral-600)' }}>
            Chỉ quản trị viên mới truy cập được trang này.
          </Text>
        </Box>
      </Page>
    );
  }
  return <AdminHub />;
}

type Tab = 'staff' | 'shifts' | 'payroll' | 'refill';

function AdminHub() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('staff');
  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 96 }}>
      <Box p={4} flex style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button size="small" variant={tab === 'staff' ? undefined : 'secondary'} onClick={() => setTab('staff')}>
          Nhân sự
        </Button>
        <Button size="small" variant={tab === 'shifts' ? undefined : 'secondary'} onClick={() => setTab('shifts')}>
          Duyệt ca
        </Button>
        <Button size="small" variant={tab === 'payroll' ? undefined : 'secondary'} onClick={() => setTab('payroll')}>
          Lương
        </Button>
        <Button size="small" variant={tab === 'refill' ? undefined : 'secondary'} onClick={() => setTab('refill')}>
          Duyệt đổi vỏ
        </Button>
        <Button
          size="small"
          variant="secondary"
          prefixIcon={<MessagesSquare size={16} />}
          onClick={() => navigate('/admin/community')}
        >
          {vi.community.moderation}
        </Button>
      </Box>
      {tab === 'staff' ? (
        <StaffSection />
      ) : tab === 'shifts' ? (
        <ShiftsSection />
      ) : tab === 'payroll' ? (
        <PayrollSection />
      ) : (
        <RefillAdminSection />
      )}
    </Page>
  );
}

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
    <Box px={4} pb={4} flex flexDirection="column" style={{ gap: 12 }}>
      <Box flex alignItems="center" justifyContent="space-between" style={{ background: 'var(--neutral-0)', borderRadius: 12, padding: '8px 12px' }}>
        <Button size="small" variant="tertiary" onClick={() => setYm(shiftYearMonth(ym.year, ym.month, -1))}>
          <ChevronLeft size={18} />
        </Button>
        <Text size="small" bold>Tháng {ym.month}/{ym.year}</Text>
        <Button size="small" variant="tertiary" onClick={() => setYm(shiftYearMonth(ym.year, ym.month, 1))}>
          <ChevronRight size={18} />
        </Button>
      </Box>

      {payQ.isLoading && <Skeleton style={{ height: 120, borderRadius: 12 }} />}
      {payQ.isError && <Text style={{ color: 'var(--danger, #d64545)' }}>{getErrorMessage(payQ.error)}</Text>}

      {payQ.data?.map((row) => (
        <Box key={row.staff.id} style={{ background: 'var(--neutral-0)', borderRadius: 12, padding: 12 }}>
          <Box flex justifyContent="space-between" alignItems="center">
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text bold>{row.staff.fullName ?? row.staff.phone ?? 'NV'}</Text>
              <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                {fmtHM(row.month.totalMinutes)} · {formatVnd(row.profile?.hourlyRate ?? 0)}/h · {PAY_STATUS[row.month.status]}
              </Text>
            </Box>
            <Box style={{ textAlign: 'right' }}>
              <Text bold style={{ color: 'var(--leaf-700)' }}>{formatVnd(row.month.net)}</Text>
              {row.month.totalFines > 0 && <Text size="xSmall" style={{ color: 'var(--danger, #d64545)' }}>−{formatVnd(row.month.totalFines)}</Text>}
            </Box>
          </Box>
          <Box flex style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Button size="small" variant="secondary" onClick={() => setDetailRow(row)}>Xem giờ</Button>
            <Button size="small" variant="secondary" onClick={() => { setRateRow(row); setRateVal(String(row.profile?.hourlyRate ?? 0)); }}>Đơn giá</Button>
            {(row.qrImageUrl || row.profile?.qrImageUrl) && (
              <Button size="small" variant="secondary" onClick={() => setQrRow(row)}>QR chuyển</Button>
            )}
            {row.month.status === 'OPEN' && (
              <Button size="small" variant="secondary" loading={finalizeM.isPending} onClick={() => finalizeM.mutate(row)}>Chốt</Button>
            )}
            {row.month.status !== 'PAID' && (
              <Button size="small" onClick={() => { setPayRow(row); setProof(''); setNote(''); }}>Đã chuyển</Button>
            )}
          </Box>
        </Box>
      ))}
      {payQ.data && payQ.data.length === 0 && (
        <Text size="small" style={{ color: 'var(--neutral-500)' }}>Chưa có nhân sự.</Text>
      )}

      {/* Sheet QR */}
      <Sheet visible={!!qrRow} onClose={() => setQrRow(null)} autoHeight>
        <Box p={4} flex flexDirection="column" alignItems="center" style={{ gap: 10 }}>
          <Text.Title size="small">Chuyển lương {qrRow?.staff.fullName ?? ''}</Text.Title>
          <Text bold style={{ color: 'var(--leaf-700)', fontSize: 22 }}>{formatVnd(qrRow?.month.net ?? 0)}</Text>
          {qrRow && (qrRow.qrImageUrl || qrRow.profile?.qrImageUrl) && (
            <img src={(qrRow.qrImageUrl ?? qrRow.profile?.qrImageUrl) as string} alt="QR" style={{ maxWidth: 260, width: '100%' }} />
          )}
          {qrRow?.profile?.bankAccountNo && (
            <Text size="small">{qrRow.profile.bankAccountName} · {qrRow.profile.bankAccountNo}</Text>
          )}
          <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>Quét chuyển khoản rồi bấm "Đã chuyển" để tải ảnh xác nhận.</Text>
        </Box>
      </Sheet>

      {/* Sheet đơn giá */}
      <Sheet visible={!!rateRow} onClose={() => setRateRow(null)} autoHeight>
        <Box p={4} flex flexDirection="column" style={{ gap: 10 }}>
          <Text.Title size="small">Đơn giá giờ · {rateRow?.staff.fullName ?? ''}</Text.Title>
          <Input type="number" label="Đơn giá (VND/giờ)" value={rateVal} onChange={(e) => setRateVal(e.target.value)} />
          <Button fullWidth loading={rateM.isPending} disabled={!/^\d+$/.test(rateVal)} onClick={() => rateM.mutate()}>Lưu đơn giá</Button>
        </Box>
      </Sheet>

      {/* Sheet đã chuyển */}
      <Sheet visible={!!payRow} onClose={() => setPayRow(null)} autoHeight>
        <Box p={4} flex flexDirection="column" style={{ gap: 10 }}>
          <Text.Title size="small">Xác nhận đã chuyển · {payRow?.staff.fullName ?? ''}</Text.Title>
          <Text size="small">Số tiền: <b>{formatVnd(payRow?.month.net ?? 0)}</b></Text>
          <ImageUpload label="Ảnh xác nhận chuyển khoản *" value={proof} onChange={setProof} />
          <Input label="Ghi chú (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button fullWidth loading={paidM.isPending} disabled={!proof} onClick={() => paidM.mutate()}>Đánh dấu đã trả</Button>
        </Box>
      </Sheet>

      {/* Sheet xem giờ + sửa phiên */}
      <DetailSheet row={detailRow} year={ym.year} month={ym.month} onClose={() => setDetailRow(null)} onChanged={invalidate} />
    </Box>
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
        checkinAt: vnDateTimeISO(dayKey, ci),
        checkoutAt: vnDateTimeISO(dayKey, co),
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
    <Sheet visible={!!row} onClose={onClose} autoHeight>
      <Box p={4} flex flexDirection="column" style={{ gap: 10, maxHeight: '70vh', overflowY: 'auto' }}>
        <Text.Title size="small">Giờ công · {row?.staff.fullName ?? ''} · T{month}/{year}</Text.Title>
        {detailQ.isLoading && <Skeleton style={{ height: 100, borderRadius: 10 }} />}
        {detailQ.data && (
          <>
            <Text size="small">
              Tổng: <b>{fmtHM(detailQ.data.month.totalMinutes)}</b> · Thực nhận <b>{formatVnd(detailQ.data.month.net)}</b>
            </Text>
            {detailQ.data.days.map((d) => {
              const dayKey = d.workDate.slice(0, 10);
              const sess = detailQ.data!.sessions.filter((s) => vnDateKey(new Date(s.checkinAt)) === dayKey);
              return (
                <Box key={d.id} style={{ borderTop: '1px solid var(--neutral-100)', paddingTop: 6 }}>
                  <Box flex justifyContent="space-between">
                    <Text size="small" bold>{dowLabel(dayKey)} {shortDayLabel(dayKey)} · {fmtHM(d.workedMinutes)}</Text>
                    <Text size="small">{formatVnd(d.net)}</Text>
                  </Box>
                  {sess.map((s) => (
                    <Box key={s.id} flex justifyContent="space-between" alignItems="center" style={{ paddingLeft: 8, marginTop: 2 }}>
                      <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                        {isoToVnHHMM(s.checkinAt)} → {s.checkoutAt ? isoToVnHHMM(s.checkoutAt) : 'đang mở'}{s.isLate ? ' · trễ' : ''}
                      </Text>
                      <Button
                        size="small"
                        variant="tertiary"
                        onClick={() => {
                          setEditId(s.id);
                          setCi(isoToVnHHMM(s.checkinAt));
                          setCo(s.checkoutAt ? isoToVnHHMM(s.checkoutAt) : isoToVnHHMM(s.checkinAt));
                        }}
                      >
                        Sửa giờ
                      </Button>
                    </Box>
                  ))}
                  {sess.length === 0 && <Text size="xSmall" style={{ color: 'var(--neutral-400)', paddingLeft: 8 }}>Không có phiên.</Text>}

                  {editId && sess.some((s) => s.id === editId) && (
                    <Box style={{ paddingLeft: 8, marginTop: 6 }} flex flexDirection="column">
                      <Box flex style={{ gap: 8 }}>
                        <TimeInput value={ci} onChange={setCi} style={{ flex: 1 }} />
                        <TimeInput value={co} onChange={setCo} style={{ flex: 1 }} />
                      </Box>
                      <Button size="small" style={{ marginTop: 6 }} loading={editM.isPending} onClick={() => editM.mutate(dayKey)}>
                        Lưu giờ
                      </Button>
                    </Box>
                  )}
                </Box>
              );
            })}
            {detailQ.data.days.length === 0 && <Text size="small" style={{ color: 'var(--neutral-500)' }}>Chưa có công tháng này.</Text>}
          </>
        )}
      </Box>
    </Sheet>
  );
}

const PHONE_RE = /^0\d{8,10}$/;

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
    onSuccess: () => {
      openSnackbar({ text: 'Đã thu hồi quyền.', type: 'success' });
      qc.invalidateQueries({ queryKey: ['admin-staff'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Box px={4} pb={4} flex flexDirection="column" style={{ gap: 12 }}>
      <Box flex justifyContent="space-between" alignItems="center">
        <Text.Title size="small">Nhân sự</Text.Title>
        <Button size="small" prefixIcon={<UserPlus size={16} />} onClick={() => setSheetOpen(true)}>
          Thêm
        </Button>
      </Box>

      {staffQ.isLoading && <Skeleton style={{ height: 80, borderRadius: 12 }} />}
      {staffQ.isError && <Text style={{ color: 'var(--danger, #d64545)' }}>{getErrorMessage(staffQ.error)}</Text>}

      {staffQ.data && (
        <>
          {staffQ.data.members.map((m) => (
            <Box
              key={m.id}
              flex
              justifyContent="space-between"
              alignItems="center"
              style={{ padding: 12, background: 'var(--neutral-0)', borderRadius: 12, gap: 8 }}
            >
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text bold>{m.fullName ?? 'Chưa có tên'}</Text>
                <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                  {m.phone ?? '—'} · {m.role === 'ADMIN' ? 'Quản trị' : 'Nhân viên'}
                </Text>
              </Box>
              {m.phone && (
                <Button
                  size="small"
                  variant="tertiary"
                  prefixIcon={<Trash2 size={15} />}
                  style={{ color: 'var(--danger, #d64545)' }}
                  onClick={() => revokeM.mutate(m.phone as string)}
                >
                  Thu hồi
                </Button>
              )}
            </Box>
          ))}

          {staffQ.data.members.length === 0 && (
            <Text size="small" style={{ color: 'var(--neutral-500)' }}>
              Chưa có nhân sự. Bấm “Thêm” để cấp quyền theo số điện thoại.
            </Text>
          )}

          {staffQ.data.pendingInvites.length > 0 && (
            <>
              <Text bold style={{ marginTop: 8 }}>
                Chờ mở app
              </Text>
              {staffQ.data.pendingInvites.map((p) => (
                <Box
                  key={p.phone}
                  flex
                  justifyContent="space-between"
                  alignItems="center"
                  style={{ padding: 12, background: 'var(--neutral-100)', borderRadius: 12, gap: 8 }}
                >
                  <Text size="small">
                    {p.phone} · {p.role === 'ADMIN' ? 'Quản trị' : 'Nhân viên'}
                  </Text>
                  <Button size="small" variant="tertiary" onClick={() => revokeM.mutate(p.phone)}>
                    Huỷ
                  </Button>
                </Box>
              ))}
            </>
          )}
        </>
      )}

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} autoHeight>
        <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Text.Title size="small">Thêm nhân sự theo SĐT</Text.Title>
          <Input
            type="number"
            placeholder="Số điện thoại (VD 09xxxxxxxx)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Box flex style={{ gap: 8 }}>
            <Button
              variant={role === 'STAFF' ? undefined : 'secondary'}
              prefixIcon={<UserPlus size={16} />}
              style={{ flex: 1 }}
              onClick={() => setRole('STAFF')}
            >
              Nhân viên
            </Button>
            <Button
              variant={role === 'ADMIN' ? undefined : 'secondary'}
              prefixIcon={<ShieldCheck size={16} />}
              style={{ flex: 1 }}
              onClick={() => setRole('ADMIN')}
            >
              Quản trị
            </Button>
          </Box>
          <Button
            fullWidth
            loading={grantM.isPending}
            disabled={!PHONE_RE.test(phone.trim())}
            onClick={() => grantM.mutate()}
          >
            Lưu quyền
          </Button>
        </Box>
      </Sheet>
    </Box>
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
    <Box px={4} pb={4} flex flexDirection="column" style={{ gap: 12 }}>
      <Box flex justifyContent="space-between" alignItems="center">
        <Text.Title size="small">Duyệt ca</Text.Title>
        <Button size="small" variant="secondary" prefixIcon={<Clock size={15} />} onClick={() => setTplOpen(true)}>
          Ca chuẩn
        </Button>
      </Box>

      <Box
        flex
        alignItems="center"
        justifyContent="space-between"
        style={{ background: 'var(--neutral-0)', borderRadius: 12, padding: '8px 12px' }}
      >
        <Button size="small" variant="tertiary" onClick={() => setMondayKey(addDaysKey(mondayKey, -7))}>
          <ChevronLeft size={18} />
        </Button>
        <Text size="small" bold>
          {shortDayLabel(mondayKey)} – {shortDayLabel(addDaysKey(mondayKey, 6))}
        </Text>
        <Button size="small" variant="tertiary" onClick={() => setMondayKey(addDaysKey(mondayKey, 7))}>
          <ChevronRight size={18} />
        </Button>
      </Box>

      {pendingIds.length > 0 && (
        <Button size="small" loading={bulkM.isPending} onClick={() => bulkM.mutate()}>
          Duyệt tất cả ({pendingIds.length})
        </Button>
      )}

      {shiftsQ.isLoading && <Skeleton style={{ height: 120, borderRadius: 12 }} />}
      {shiftsQ.isError && <Text style={{ color: 'var(--danger, #d64545)' }}>{getErrorMessage(shiftsQ.error)}</Text>}
      {shiftsQ.data && grouped.length === 0 && (
        <Text size="small" style={{ color: 'var(--neutral-500)' }}>
          Không có ca nào trong tuần này.
        </Text>
      )}

      {grouped.map((g) => (
        <Box key={g.name} style={{ background: 'var(--neutral-0)', borderRadius: 12, padding: 12 }}>
          <Text bold style={{ marginBottom: 6 }}>
            {g.name}
          </Text>
          {g.shifts.map((s) => {
            const start = isoToVnHHMM(s.approvedStart ?? s.startAt);
            const end = isoToVnHHMM(s.approvedEnd ?? s.endAt);
            return (
              <Box
                key={s.id}
                flex
                alignItems="center"
                justifyContent="space-between"
                style={{ padding: '8px 0', borderTop: '1px solid var(--neutral-100)', gap: 8 }}
              >
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size="small">
                    {dowLabel(s.workDate.slice(0, 10))} {shortDayLabel(s.workDate.slice(0, 10))} · {start}–{end}
                  </Text>
                  <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                    {s.status === 'PENDING'
                      ? 'Chờ duyệt'
                      : s.status === 'APPROVED'
                        ? 'Đã duyệt'
                        : s.status === 'REJECTED'
                          ? 'Từ chối'
                          : 'Đã huỷ'}
                  </Text>
                </Box>
                {s.status === 'PENDING' && (
                  <Box flex style={{ gap: 4 }}>
                    <Button size="small" variant="tertiary" onClick={() => openAdjust(s)}>
                      <Clock size={15} />
                    </Button>
                    <Button
                      size="small"
                      variant="tertiary"
                      style={{ color: 'var(--leaf-700)' }}
                      onClick={() => approveM.mutate({ id: s.id })}
                    >
                      <Check size={16} />
                    </Button>
                    <Button
                      size="small"
                      variant="tertiary"
                      style={{ color: 'var(--danger, #d64545)' }}
                      onClick={() => setRejectId(s.id)}
                    >
                      <X size={16} />
                    </Button>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      ))}

      {/* Sheet chỉnh giờ + duyệt */}
      <Sheet visible={!!adjust} onClose={() => setAdjust(null)} autoHeight>
        <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Text.Title size="small">Chỉnh giờ & duyệt</Text.Title>
          <Box flex style={{ gap: 8 }}>
            <Box style={{ flex: 1 }}>
              <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                Bắt đầu
              </Text>
              <Input type="text" value={adjStart} onChange={(e) => setAdjStart(e.target.value)} />
            </Box>
            <Box style={{ flex: 1 }}>
              <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                Kết thúc
              </Text>
              <Input type="text" value={adjEnd} onChange={(e) => setAdjEnd(e.target.value)} />
            </Box>
          </Box>
          <Button
            fullWidth
            loading={approveM.isPending}
            disabled={!/^\d{1,2}:\d{2}$/.test(adjStart) || !/^\d{1,2}:\d{2}$/.test(adjEnd)}
            onClick={() =>
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
        </Box>
      </Sheet>

      {/* Sheet từ chối */}
      <Sheet visible={!!rejectId} onClose={() => setRejectId(null)} autoHeight>
        <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Text.Title size="small">Từ chối ca</Text.Title>
          <Input.TextArea placeholder="Lý do" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          <Button
            fullWidth
            loading={rejectM.isPending}
            disabled={rejectReason.trim().length === 0}
            onClick={() => rejectId && rejectM.mutate({ id: rejectId, reason: rejectReason.trim() })}
          >
            Xác nhận từ chối
          </Button>
        </Box>
      </Sheet>

      <TemplateSheet visible={tplOpen} onClose={() => setTplOpen(false)} />
    </Box>
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
    <Sheet visible={visible} onClose={onClose} autoHeight>
      <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
        <Text.Title size="small">Ca chuẩn</Text.Title>
        {(tplQ.data ?? []).map((t) => (
          <Box key={t.id} flex justifyContent="space-between" alignItems="center">
            <Text size="small">
              {t.name} · {minToHHMM(t.startMin)}–{minToHHMM(t.endMin)}
            </Text>
            <Button size="small" variant="tertiary" style={{ color: 'var(--danger, #d64545)' }} onClick={() => delM.mutate(t.id)}>
              <Trash2 size={15} />
            </Button>
          </Box>
        ))}
        <Box style={{ borderTop: '1px solid var(--neutral-100)', paddingTop: 10 }}>
          <Input placeholder="Tên ca (VD Ca sáng)" value={name} onChange={(e) => setName(e.target.value)} />
          <Box flex style={{ gap: 8, marginTop: 8 }}>
            <Input type="text" value={start} onChange={(e) => setStart(e.target.value)} style={{ flex: 1 }} />
            <Input type="text" value={end} onChange={(e) => setEnd(e.target.value)} style={{ flex: 1 }} />
          </Box>
          <Button
            fullWidth
            style={{ marginTop: 10 }}
            prefixIcon={<Plus size={15} />}
            loading={addM.isPending}
            disabled={!name.trim() || !/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)}
            onClick={() => addM.mutate()}
          >
            Thêm ca chuẩn
          </Button>
        </Box>
      </Box>
    </Sheet>
  );
}

function RefillAdminSection() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const pendingQ = useQuery({ queryKey: ['admin-refill-pending'], queryFn: getPendingRefillReturns });

  const approveM = useMutation({
    mutationFn: (id: string) => approveRefillReturn(id),
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

  return (
    <Box px={4} pb={4} flex flexDirection="column" style={{ gap: 12 }}>
      <Box flex justifyContent="space-between" alignItems="center">
        <Text.Title size="small">Duyệt đổi vỏ chai</Text.Title>
      </Box>

      {pendingQ.isLoading && <Skeleton style={{ height: 100, borderRadius: 12 }} />}
      {pendingQ.isError && <Text style={{ color: 'var(--danger, #d64545)' }}>{getErrorMessage(pendingQ.error)}</Text>}

      {pendingQ.data && pendingQ.data.length === 0 && (
        <Text size="small" style={{ color: 'var(--neutral-500)' }}>
          Không có yêu cầu đổi vỏ chai nào đang chờ duyệt.
        </Text>
      )}

      {pendingQ.data?.map((r: PendingRefillItem) => (
        <Box key={r.id} style={{ background: 'var(--neutral-0)', borderRadius: 12, padding: 12 }}>
          <Box flex justifyContent="space-between" alignItems="center">
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text bold>{r.user.fullName ?? r.user.phone ?? 'Khách hàng'}</Text>
              <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                {r.user.phone ?? '—'} · Đổi <b>{r.quantity} vỏ</b> (+{r.seedsAwarded}💧)
              </Text>
            </Box>
            <Box flex style={{ gap: 6 }}>
              <Button
                size="small"
                variant="tertiary"
                style={{ color: 'var(--leaf-700)' }}
                loading={approveM.isPending}
                onClick={() => approveM.mutate(r.id)}
              >
                <Check size={16} /> Duyệt
              </Button>
              <Button
                size="small"
                variant="tertiary"
                style={{ color: 'var(--danger, #d64545)' }}
                loading={rejectM.isPending}
                onClick={() => rejectM.mutate(r.id)}
              >
                <X size={16} /> Từ chối
              </Button>
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
