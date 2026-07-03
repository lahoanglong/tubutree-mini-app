import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Copy,
  Trash2,
  Pencil,
  CalendarClock,
  LogIn,
  LogOut,
  MapPin,
} from 'lucide-react';
import {
  getAttendanceStatus,
  acquireLocationPayload,
  checkin as attnCheckin,
  checkout as attnCheckout,
  heartbeat as attnHeartbeat,
} from '../services/attendance-api';
import {
  getShifts,
  getShiftTemplates,
  createShifts,
  updateShift,
  deleteShift,
  copyWeek,
  cancelShift,
  type Shift,
  type ShiftTemplate,
} from '../services/shifts-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { Skeleton } from '../components/ui/skeleton';
import { ImageUpload } from '../components/image-upload';
import {
  mondayKeyOf,
  addDaysKey,
  weekDayKeys,
  keyToUtcMidnightISO,
  vnDateTimeISO,
  isoToVnHHMM,
  minToHHMM,
  shortDayLabel,
  dowLabel,
} from '../utils/week';

const STATUS: Record<Shift['status'], { label: string; bg: string; fg: string }> = {
  PENDING: { label: 'Chờ duyệt', bg: 'rgba(201,123,74,0.14)', fg: '#b5652f' },
  APPROVED: { label: 'Đã duyệt', bg: 'rgba(80,144,24,0.14)', fg: '#3f7314' },
  REJECTED: { label: 'Từ chối', bg: 'rgba(214,69,69,0.12)', fg: '#c0392b' },
  CANCELLED: { label: 'Đã huỷ', bg: 'var(--neutral-100)', fg: 'var(--neutral-500)' },
};

export default function StaffPage() {
  const role = useAuthStore((s) => s.user?.role);
  if (role !== 'STAFF' && role !== 'ADMIN') {
    return (
      <Page className="page">
        <Box p={6} style={{ textAlign: 'center' }}>
          <Text style={{ color: 'var(--neutral-600)' }}>
            Trang dành cho nhân viên. Liên hệ quản trị để được cấp quyền.
          </Text>
        </Box>
      </Page>
    );
  }
  return <StaffHub />;
}

/** Thẻ "Hôm nay" — checkin/checkout theo IP+GPS + heartbeat tự động khi đang trong ca. */
function TodayCard() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const statusQ = useQuery({ queryKey: ['attn-status'], queryFn: getAttendanceStatus });
  const open = statusQ.data?.openSession ?? null;
  const todayShifts = statusQ.data?.shifts ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['attn-status'] });

  const checkinM = useMutation({
    mutationFn: async (shiftId: string) => {
      const loc = await acquireLocationPayload();
      return attnCheckin({ shiftId, ...loc });
    },
    onSuccess: (r) => {
      openSnackbar({
        text: r.isLate ? 'Đã checkin (đi trễ — có thể bị phạt).' : 'Đã checkin. Chúc làm việc vui!',
        type: r.isLate ? 'info' : 'success',
      });
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const checkoutM = useMutation({
    mutationFn: () => attnCheckout(),
    onSuccess: () => {
      openSnackbar({ text: 'Đã checkout.', type: 'success' });
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  // Heartbeat mỗi 3 phút khi đang trong ca — rớt vùng thì backend tự checkout.
  const openId = open?.id ?? null;
  const hbRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!openId) return;
    const tick = async () => {
      try {
        const loc = await acquireLocationPayload();
        const r = await attnHeartbeat(loc);
        if (r.closed) {
          openSnackbar({ text: 'Đã tự checkout (ra khỏi vùng công ty).', type: 'info' });
          invalidate();
        }
      } catch {
        /* bỏ qua nhịp lỗi */
      }
    };
    hbRef.current = setInterval(tick, 3 * 60 * 1000);
    return () => {
      if (hbRef.current) clearInterval(hbRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  return (
    <Box
      style={{
        background: open ? 'linear-gradient(135deg, var(--leaf-600), var(--leaf-700))' : 'var(--neutral-0)',
        color: open ? '#fff' : 'inherit',
        borderRadius: 14,
        padding: 16,
      }}
    >
      <Box flex alignItems="center" style={{ gap: 8, marginBottom: 8 }}>
        <MapPin size={18} color={open ? '#fff' : 'var(--leaf-700)'} />
        <Text bold style={{ color: open ? '#fff' : 'inherit' }}>
          Chấm công hôm nay
        </Text>
      </Box>

      {statusQ.isLoading && <Skeleton style={{ height: 40, borderRadius: 10 }} />}

      {open ? (
        <>
          <Text size="small" style={{ color: 'rgba(255,255,255,0.9)' }}>
            Đang trong ca · vào lúc {isoToVnHHMM(open.checkinAt)}
            {open.isLate ? ' · đi trễ' : ''}
          </Text>
          <Button
            fullWidth
            variant="secondary"
            prefixIcon={<LogOut size={16} />}
            style={{ marginTop: 10 }}
            loading={checkoutM.isPending}
            onClick={() => checkoutM.mutate()}
          >
            Checkout
          </Button>
          <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.8)', marginTop: 6 }}>
            Nghỉ giữa ca? Bấm Checkout rồi Checkin lại khi quay lại.
          </Text>
        </>
      ) : todayShifts.length === 0 ? (
        <Text size="small" style={{ color: 'var(--neutral-500)' }}>
          Hôm nay bạn không có ca đã duyệt.
        </Text>
      ) : (
        todayShifts.map((s) => (
          <Box
            key={s.id}
            flex
            alignItems="center"
            justifyContent="space-between"
            style={{ marginTop: 8, gap: 8 }}
          >
            <Text size="small">
              Ca {isoToVnHHMM(s.approvedStart ?? s.startAt)}–{isoToVnHHMM(s.approvedEnd ?? s.endAt)}
            </Text>
            <Button
              size="small"
              prefixIcon={<LogIn size={15} />}
              loading={checkinM.isPending}
              onClick={() => checkinM.mutate(s.id)}
            >
              Checkin
            </Button>
          </Box>
        ))
      )}
      <Text size="xSmall" style={{ color: open ? 'rgba(255,255,255,0.8)' : 'var(--neutral-400)', marginTop: 8 }}>
        Cần ở đúng mạng WiFi công ty & trong vùng để chấm công.
      </Text>
    </Box>
  );
}

function StaffHub() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [mondayKey, setMondayKey] = useState(() => mondayKeyOf(new Date()));
  const dayKeys = useMemo(() => weekDayKeys(mondayKey), [mondayKey]);
  const fromISO = keyToUtcMidnightISO(mondayKey);
  const toISO = `${addDaysKey(mondayKey, 6)}T23:59:59.999Z`;

  const tplQ = useQuery({ queryKey: ['shift-templates'], queryFn: getShiftTemplates });
  const shiftsQ = useQuery({
    queryKey: ['my-shifts', mondayKey],
    queryFn: () => getShifts(fromISO, toISO),
  });

  const byDay = useMemo(() => {
    const map: Record<string, Shift[]> = {};
    for (const s of shiftsQ.data ?? []) {
      const key = s.workDate.slice(0, 10);
      (map[key] ??= []).push(s);
    }
    return map;
  }, [shiftsQ.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['my-shifts', mondayKey] });

  // ── Sheet thêm/sửa ca ──
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formDay, setFormDay] = useState(mondayKey);
  const [tplId, setTplId] = useState<string | null>(null);
  const [customStart, setCustomStart] = useState('08:00');
  const [customEnd, setCustomEnd] = useState('12:00');
  const [custom, setCustom] = useState(false);

  const openAdd = (dayKey: string) => {
    setEditId(null);
    setFormDay(dayKey);
    setTplId(null);
    setCustom(false);
    setCustomStart('08:00');
    setCustomEnd('12:00');
    setFormOpen(true);
  };
  const openEdit = (s: Shift) => {
    setEditId(s.id);
    setFormDay(s.workDate.slice(0, 10));
    setCustom(true);
    setCustomStart(isoToVnHHMM(s.startAt));
    setCustomEnd(isoToVnHHMM(s.endAt));
    setTplId(null);
    setFormOpen(true);
  };

  const resolvedTimes = () => {
    if (!custom && tplId) {
      const t = tplQ.data?.find((x) => x.id === tplId);
      if (t) return { start: minToHHMM(t.startMin), end: minToHHMM(t.endMin), templateId: t.id };
    }
    return { start: customStart, end: customEnd, templateId: undefined as string | undefined };
  };

  const saveM = useMutation({
    mutationFn: async () => {
      const { start, end, templateId } = resolvedTimes();
      const startAt = vnDateTimeISO(formDay, start);
      const endAt = vnDateTimeISO(formDay, end);
      if (editId) return updateShift(editId, { startAt, endAt });
      return createShifts([{ workDate: formDay, startAt, endAt, templateId }]);
    },
    onSuccess: () => {
      openSnackbar({ text: editId ? 'Đã cập nhật ca.' : 'Đã gửi ca chờ duyệt.', type: 'success' });
      setFormOpen(false);
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const delM = useMutation({
    mutationFn: (id: string) => deleteShift(id),
    onSuccess: () => {
      openSnackbar({ text: 'Đã xoá ca.', type: 'success' });
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const copyM = useMutation({
    mutationFn: () =>
      copyWeek(keyToUtcMidnightISO(addDaysKey(mondayKey, -7)), keyToUtcMidnightISO(mondayKey)),
    onSuccess: (r) => {
      openSnackbar({
        text: r.created > 0 ? `Đã copy ${r.created} ca từ tuần trước.` : 'Tuần trước không có ca để copy.',
        type: r.created > 0 ? 'success' : 'info',
      });
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  // ── Sheet huỷ ca ──
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelEmergency, setCancelEmergency] = useState(false);
  const [cancelEvidence, setCancelEvidence] = useState('');

  const cancelM = useMutation({
    mutationFn: () =>
      cancelShift(cancelId as string, {
        reason: cancelReason.trim(),
        isEmergency: cancelEmergency,
        evidenceUrl: cancelEvidence || undefined,
      }),
    onSuccess: (r) => {
      openSnackbar({
        text: r.penalty ? 'Đã huỷ ca — bị tính phạt 1h công.' : 'Đã huỷ ca (không phạt).',
        type: r.penalty ? 'info' : 'success',
      });
      setCancelId(null);
      setCancelReason('');
      setCancelEmergency(false);
      setCancelEvidence('');
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 96 }}>
      <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
        <Box flex alignItems="center" style={{ gap: 8 }}>
          <CalendarClock size={22} color="var(--leaf-700)" />
          <Text.Title size="small">Ca làm của tôi</Text.Title>
        </Box>

        <TodayCard />

        {/* Điều hướng tuần */}
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

        <Button
          size="small"
          variant="secondary"
          prefixIcon={<Copy size={15} />}
          loading={copyM.isPending}
          onClick={() => copyM.mutate()}
        >
          Copy ca tuần trước
        </Button>

        {(tplQ.isLoading || shiftsQ.isLoading) && <Skeleton style={{ height: 120, borderRadius: 12 }} />}
        {shiftsQ.isError && (
          <Text style={{ color: 'var(--danger, #d64545)' }}>{getErrorMessage(shiftsQ.error)}</Text>
        )}

        {shiftsQ.data &&
          dayKeys.map((dk) => (
            <Box key={dk} style={{ background: 'var(--neutral-0)', borderRadius: 12, padding: 12 }}>
              <Box flex justifyContent="space-between" alignItems="center" style={{ marginBottom: 6 }}>
                <Text bold>
                  {dowLabel(dk)} · {shortDayLabel(dk)}
                </Text>
                <Button size="small" variant="tertiary" prefixIcon={<Plus size={15} />} onClick={() => openAdd(dk)}>
                  Thêm
                </Button>
              </Box>
              {(byDay[dk] ?? []).length === 0 && (
                <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                  Chưa đăng ký ca.
                </Text>
              )}
              {(byDay[dk] ?? []).map((s) => {
                const st = STATUS[s.status];
                const start = isoToVnHHMM(s.approvedStart ?? s.startAt);
                const end = isoToVnHHMM(s.approvedEnd ?? s.endAt);
                const adjusted = !!s.approvedStart || !!s.approvedEnd;
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
                        {start} – {end}
                        {adjusted && (
                          <Text size="xSmall" style={{ display: 'inline', color: 'var(--neutral-400)' }}>
                            {' '}
                            (đã chỉnh)
                          </Text>
                        )}
                      </Text>
                      <Box
                        style={{
                          display: 'inline-block',
                          marginTop: 2,
                          padding: '1px 8px',
                          borderRadius: 999,
                          background: st.bg,
                        }}
                      >
                        <Text size="xSmall" style={{ color: st.fg }}>
                          {st.label}
                          {s.status === 'CANCELLED' && s.cancelPenalty ? ' · phạt 1h' : ''}
                        </Text>
                      </Box>
                    </Box>
                    {s.status === 'PENDING' && (
                      <Box flex style={{ gap: 4 }}>
                        <Button size="small" variant="tertiary" onClick={() => openEdit(s)}>
                          <Pencil size={15} />
                        </Button>
                        <Button
                          size="small"
                          variant="tertiary"
                          style={{ color: 'var(--danger, #d64545)' }}
                          onClick={() => delM.mutate(s.id)}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </Box>
                    )}
                    {s.status === 'APPROVED' && (
                      <Button
                        size="small"
                        variant="tertiary"
                        style={{ color: 'var(--danger, #d64545)' }}
                        onClick={() => setCancelId(s.id)}
                      >
                        Huỷ ca
                      </Button>
                    )}
                  </Box>
                );
              })}
            </Box>
          ))}
      </Box>

      {/* Sheet thêm/sửa */}
      <Sheet visible={formOpen} onClose={() => setFormOpen(false)} autoHeight>
        <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Text.Title size="small">
            {editId ? 'Sửa ca' : 'Thêm ca'} · {dowLabel(formDay)} {shortDayLabel(formDay)}
          </Text.Title>

          {!editId && (tplQ.data?.length ?? 0) > 0 && (
            <>
              <Text size="small" style={{ color: 'var(--neutral-500)' }}>
                Chọn ca chuẩn
              </Text>
              <Box flex style={{ gap: 8, flexWrap: 'wrap' }}>
                {tplQ.data!.map((t: ShiftTemplate) => (
                  <Button
                    key={t.id}
                    size="small"
                    variant={!custom && tplId === t.id ? undefined : 'secondary'}
                    onClick={() => {
                      setCustom(false);
                      setTplId(t.id);
                    }}
                  >
                    {t.name} ({minToHHMM(t.startMin)}–{minToHHMM(t.endMin)})
                  </Button>
                ))}
                <Button
                  size="small"
                  variant={custom ? undefined : 'secondary'}
                  onClick={() => setCustom(true)}
                >
                  Giờ khác
                </Button>
              </Box>
            </>
          )}

          {(custom || editId || (tplQ.data?.length ?? 0) === 0) && (
            <Box flex style={{ gap: 8 }}>
              <Box style={{ flex: 1 }}>
                <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                  Bắt đầu
                </Text>
                <Input type="text" placeholder="08:00" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                  Kết thúc
                </Text>
                <Input type="text" placeholder="12:00" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </Box>
            </Box>
          )}

          <Button
            fullWidth
            loading={saveM.isPending}
            disabled={!custom && !editId ? !tplId : !/^\d{1,2}:\d{2}$/.test(customStart) || !/^\d{1,2}:\d{2}$/.test(customEnd)}
            onClick={() => saveM.mutate()}
          >
            {editId ? 'Lưu' : 'Gửi duyệt'}
          </Button>
        </Box>
      </Sheet>

      {/* Sheet huỷ ca */}
      <Sheet visible={!!cancelId} onClose={() => setCancelId(null)} autoHeight>
        <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Text.Title size="small">Huỷ ca đã duyệt</Text.Title>
          <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
            Huỷ trước 3 ngày: miễn phạt. Trễ hơn: phạt 1h công (trừ đột xuất có chứng cứ, tối đa 3 lần/tháng).
          </Text>
          <Input.TextArea
            placeholder="Lý do huỷ"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <Box
            flex
            alignItems="center"
            justifyContent="space-between"
            style={{ padding: '4px 0' }}
            onClick={() => setCancelEmergency((v) => !v)}
          >
            <Text size="small">Đột xuất (có chứng cứ)</Text>
            <Box
              style={{
                width: 44,
                height: 26,
                borderRadius: 999,
                background: cancelEmergency ? 'var(--leaf-600)' : 'var(--neutral-200)',
                position: 'relative',
                transition: 'background .15s',
              }}
            >
              <Box
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  background: '#fff',
                  position: 'absolute',
                  top: 2,
                  left: cancelEmergency ? 20 : 2,
                  transition: 'left .15s',
                }}
              />
            </Box>
          </Box>
          {cancelEmergency && (
            <ImageUpload label="Ảnh chứng cứ" value={cancelEvidence} onChange={setCancelEvidence} />
          )}
          <Button
            fullWidth
            loading={cancelM.isPending}
            disabled={cancelReason.trim().length === 0 || (cancelEmergency && !cancelEvidence)}
            onClick={() => cancelM.mutate()}
          >
            Xác nhận huỷ
          </Button>
        </Box>
      </Sheet>
    </Page>
  );
}
