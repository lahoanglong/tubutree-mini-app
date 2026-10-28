import { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Page, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, LogIn, LogOut, MapPin } from 'lucide-react';
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
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { Badge, type BadgeTone } from '../components/ui/badge';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Field } from '../components/ui/form';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { Skeleton } from '../components/ui/skeleton';
import { Heading, Text } from '../components/ui/text';
import { TimeInput } from '../components/ui/time-input';
import { ImageUpload } from '../components/image-upload';
import { PeriodNav } from '../components/period-nav';
import {
  mondayKeyOf,
  addDaysKey,
  weekDayKeys,
  keyToUtcMidnightISO,
  vnDateTimeISO,
  vnDateKey,
  isoToVnHHMM,
  minToHHMM,
  shortDayLabel,
  dowLabel,
} from '../utils/week';

const STATUS: Record<Shift['status'], { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

const TIME_RE = /^\d{1,2}:\d{2}$/;

export default function StaffPage() {
  const role = useAuthStore((s) => s.user?.role);
  const navigate = useNavigate();
  if (role !== 'STAFF' && role !== 'ADMIN') {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title="Ca làm của tôi" />
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

  const locFailRef = useRef<string | null>(null);
  const checkinM = useMutation({
    mutationFn: async (shiftId: string) => {
      locFailRef.current = null;
      const loc = await acquireLocationPayload((m) => {
        locFailRef.current = m;
      });
      return attnCheckin({ shiftId, ...loc });
    },
    onSuccess: (r) => {
      openSnackbar({
        text: r.isLate ? 'Đã vào ca (đi trễ — có thể bị phạt).' : 'Đã vào ca. Chúc làm việc vui!',
        type: r.isLate ? 'info' : 'success',
      });
      invalidate();
    },
    onError: (e) =>
      openSnackbar({
        text: locFailRef.current ? `${locFailRef.current} ${getErrorMessage(e)}` : getErrorMessage(e),
        type: 'error',
      }),
  });

  const checkoutM = useMutation({
    mutationFn: (at?: string) => attnCheckout(at),
    onSuccess: () => {
      openSnackbar({ text: 'Đã ra ca.', type: 'success' });
      setBackOpen(false);
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  // Checkout lùi giờ (quên checkout khi nghỉ trưa/về sớm)
  const [backOpen, setBackOpen] = useState(false);
  const [backTime, setBackTime] = useState('12:00');

  // Neo theo ngày CHECKIN thật (không phải "hôm nay") — ca qua đêm (checkin 23:30 hôm trước,
  // sửa giờ sau nửa đêm) nếu neo theo hôm nay sẽ ra checkout trước cả checkin. Ưu tiên thử
  // CÙNG ngày checkin trước; nếu giờ chọn <= giờ checkin (VD checkin 23:30, chọn 00:15 — ý người
  // dùng là NGÀY HÔM SAU) thì tự chuyển sang ngày kế tiếp. Sau đó validate checkout > checkin
  // và checkout <= hiện tại.
  const backoutCandidateISO = (() => {
    if (!open || !TIME_RE.test(backTime)) return null;
    const checkinMs = new Date(open.checkinAt).getTime();
    const checkinDay = vnDateKey(new Date(open.checkinAt));
    const sameDayISO = vnDateTimeISO(checkinDay, backTime);
    if (new Date(sameDayISO).getTime() > checkinMs) return sameDayISO;
    return vnDateTimeISO(addDaysKey(checkinDay, 1), backTime);
  })();
  const backoutInvalid =
    !open ||
    !backoutCandidateISO ||
    new Date(backoutCandidateISO).getTime() <= new Date(open.checkinAt).getTime() ||
    new Date(backoutCandidateISO).getTime() > Date.now();

  // Heartbeat mỗi 3 phút khi đang trong ca — rớt vùng thì backend tự checkout.
  const openId = open?.id ?? null;
  const hbRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!openId) return;
    let locFailNotified = false; // mỗi chuỗi lỗi vị trí chỉ báo một lần, không báo lại mỗi nhịp
    const tick = async () => {
      try {
        let locFailed = false;
        const loc = await acquireLocationPayload((m) => {
          locFailed = true;
          if (!locFailNotified) {
            locFailNotified = true;
            openSnackbar({ text: m, type: 'warning' });
          }
        });
        if (!locFailed) locFailNotified = false;
        const r = await attnHeartbeat(loc);
        if (r.closed) {
          openSnackbar({ text: 'Đã tự ra ca (ra khỏi vùng công ty).', type: 'info' });
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
  }, [openId]);

  const tone = open ? 'inverse' : 'primary';
  return (
    <Card
      padding={16}
      style={open ? { background: 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))', boxShadow: 'none' } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon icon={MapPin} size="sm" tone={open ? 'inverse' : 'brand'} />
        <Heading variant="title-sm" as="h2" tone={tone}>
          Chấm công hôm nay
        </Heading>
      </div>

      {statusQ.isLoading && <Skeleton height={40} />}

      {open ? (
        <>
          <Text variant="body-sm" tone="inverse" as="div">
            Đang trong ca · vào lúc {isoToVnHHMM(open.checkinAt)}
            {open.isLate ? ' · đi trễ' : ''}
          </Text>
          <Button
            fullWidth
            variant="secondary"
            icon={LogOut}
            style={{ marginTop: 10 }}
            loading={checkoutM.isPending}
            onPress={() => checkoutM.mutate(undefined)}
          >
            Ra ca
          </Button>
          <button
            type="button"
            className="tubu-press"
            onClick={() => {
              setBackTime(isoToVnHHMM(open.checkinAt));
              setBackOpen(true);
            }}
            style={{
              display: 'block',
              minHeight: 44,
              padding: 0,
              marginTop: 4,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 'var(--type-caption-size)',
              textDecoration: 'underline',
              color: 'var(--color-text-inverse)',
            }}
          >
            Quên ra ca? Chọn giờ đã về →
          </button>
          <Text variant="caption" tone="inverse" as="div">
            Nghỉ giữa ca? Ra ca rồi vào ca lại khi quay lại.
          </Text>
        </>
      ) : statusQ.isError ? (
        <div>
          <Text variant="body-sm" tone="secondary" as="div">
            Không tải được trạng thái chấm công.
          </Text>
          <Button variant="secondary" style={{ marginTop: 8 }} onPress={() => void statusQ.refetch()}>
            Thử lại
          </Button>
        </div>
      ) : statusQ.isLoading ? null : todayShifts.length === 0 ? (
        <Text variant="body-sm" tone="secondary" as="div">
          Hôm nay bạn không có ca đã duyệt.
        </Text>
      ) : (
        todayShifts.map((s) => (
          <div
            key={s.id}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 }}
          >
            <Text variant="body-sm">
              Ca {isoToVnHHMM(s.approvedStart ?? s.startAt)}–{isoToVnHHMM(s.approvedEnd ?? s.endAt)}
            </Text>
            <Button icon={LogIn} loading={checkinM.isPending} onPress={() => checkinM.mutate(s.id)}>
              Vào ca
            </Button>
          </div>
        ))
      )}
      <Text variant="caption" tone={open ? 'inverse' : 'tertiary'} as="div" style={{ marginTop: 8 }}>
        Cần ở đúng mạng WiFi công ty & trong vùng để chấm công.
      </Text>

      <BottomSheet
        open={backOpen}
        onClose={() => setBackOpen(false)}
        title="Ra ca lùi giờ"
        footer={
          <Button
            fullWidth
            loading={checkoutM.isPending}
            disabled={backoutInvalid}
            onPress={() => backoutCandidateISO && checkoutM.mutate(backoutCandidateISO)}
          >
            Xác nhận ra ca
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Text variant="caption" tone="secondary" as="div">
            Chọn giờ bạn đã thực sự rời đi (chỉ được chọn giờ trong quá khứ, sau giờ vào ca).
          </Text>
          <Field label="Giờ đã về">
            <TimeInput value={backTime} onChange={setBackTime} />
          </Field>
          {backoutInvalid && open && TIME_RE.test(backTime) && (
            <Text variant="caption" tone="danger" as="div">
              Giờ đã chọn phải sau giờ vào ca ({isoToVnHHMM(open.checkinAt)}) và không được ở tương lai.
            </Text>
          )}
        </div>
      </BottomSheet>
    </Card>
  );
}

function StaffHub() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [mondayKey, setMondayKey] = useState(() => mondayKeyOf(new Date()));
  const dayKeys = useMemo(() => weekDayKeys(mondayKey), [mondayKey]);
  const todayKey = vnDateKey(new Date());
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

  // ── Đăng ký nhanh: 1 khung giờ áp cho nhiều ngày trong tuần ──
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickTplId, setQuickTplId] = useState<string | null>(null);
  const [quickStart, setQuickStart] = useState('08:00');
  const [quickEnd, setQuickEnd] = useState('17:00');
  const [quickDays, setQuickDays] = useState<Set<string>>(new Set());

  const openQuick = () => {
    setQuickTplId(null);
    setQuickStart('08:00');
    setQuickEnd('17:00');
    setQuickDays(new Set(dayKeys.slice(0, 5).filter((dk) => dk >= todayKey))); // mặc định T2–T6 (từ hôm nay)
    setQuickOpen(true);
  };
  const toggleQuickDay = (dk: string) =>
    setQuickDays((prev) => {
      const next = new Set(prev);
      if (next.has(dk)) next.delete(dk);
      else next.add(dk);
      return next;
    });
  const quickTimes = () => {
    if (quickTplId) {
      const t = tplQ.data?.find((x) => x.id === quickTplId);
      if (t) return { start: minToHHMM(t.startMin), end: minToHHMM(t.endMin), templateId: t.id };
    }
    return { start: quickStart, end: quickEnd, templateId: undefined as string | undefined };
  };
  const quickM = useMutation({
    mutationFn: () => {
      const { start, end, templateId } = quickTimes();
      const items = [...quickDays].sort().map((dk) => ({
        workDate: dk,
        startAt: vnDateTimeISO(dk, start),
        endAt: vnDateTimeISO(dk, end),
        templateId,
      }));
      return createShifts(items);
    },
    onSuccess: (r) => {
      openSnackbar({ text: `Đã đăng ký ${r.created} ca chờ duyệt.`, type: 'success' });
      setQuickOpen(false);
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const copyM = useMutation({
    mutationFn: () =>
      copyWeek(keyToUtcMidnightISO(addDaysKey(mondayKey, -7)), keyToUtcMidnightISO(mondayKey)),
    onSuccess: (r) => {
      openSnackbar({
        text: r.created > 0 ? `Đã chép ${r.created} ca từ tuần trước.` : 'Tuần trước không có ca để chép.',
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
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 96 }}>
      <PageHeader title="Ca làm của tôi" />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TodayCard />

        {/* Điều hướng tuần */}
        <PeriodNav
          label={`${shortDayLabel(mondayKey)} – ${shortDayLabel(addDaysKey(mondayKey, 6))}`}
          prevLabel="Tuần trước"
          nextLabel="Tuần sau"
          onPrev={() => setMondayKey(addDaysKey(mondayKey, -7))}
          onNext={() => setMondayKey(addDaysKey(mondayKey, 7))}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button icon={Plus} style={{ flex: '1 1 150px' }} onPress={openQuick}>
            Đăng ký ca
          </Button>
          <Button variant="secondary" icon={Copy} style={{ flex: '1 1 150px' }} loading={copyM.isPending} onPress={() => copyM.mutate()}>
            Chép tuần trước
          </Button>
        </div>

        {(tplQ.isLoading || shiftsQ.isLoading) && <Skeleton height={120} radius="var(--radius-card)" />}
        {shiftsQ.isError && (
          <ErrorState message={getLoadErrorMessage(shiftsQ.error)} onRetry={() => void shiftsQ.refetch()} />
        )}

        {shiftsQ.data &&
          dayKeys.map((dk) => {
            const dayName = `${dowLabel(dk)} ${shortDayLabel(dk)}`;
            return (
              <Card key={dk}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Heading variant="title-sm" as="h2">
                    {dowLabel(dk)} · {shortDayLabel(dk)}
                  </Heading>
                  {dk >= todayKey && (
                    <Button variant="ghost" icon={Plus} aria-label={`Thêm ca ${dayName}`} onPress={() => openAdd(dk)}>
                      Thêm
                    </Button>
                  )}
                </div>
                {(byDay[dk] ?? []).length === 0 && (
                  <Text variant="caption" tone="tertiary" as="div">
                    Chưa đăng ký ca.
                  </Text>
                )}
                {(byDay[dk] ?? []).map((s) => {
                  const st = STATUS[s.status];
                  const start = isoToVnHHMM(s.approvedStart ?? s.startAt);
                  const end = isoToVnHHMM(s.approvedEnd ?? s.endAt);
                  const adjusted = !!s.approvedStart || !!s.approvedEnd;
                  return (
                    <div
                      key={s.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '8px 0',
                        borderTop: '1px solid var(--color-border-subtle)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text variant="body-sm" as="div">
                          {start} – {end}
                          {adjusted && (
                            <Text variant="caption" tone="tertiary">
                              {' '}
                              (đã chỉnh)
                            </Text>
                          )}
                        </Text>
                        <div style={{ marginTop: 2 }}>
                          <Badge tone={st.tone} size="sm">
                            {st.label}
                            {s.status === 'CANCELLED' && s.cancelPenalty ? ' · phạt 1h' : ''}
                          </Badge>
                        </div>
                        {s.status === 'REJECTED' && s.rejectReason && (
                          <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 2 }}>
                            Lý do: {s.rejectReason}
                          </Text>
                        )}
                      </div>
                      {s.status === 'PENDING' && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Button variant="ghost" aria-label={`Sửa ca ${dayName}`} onPress={() => openEdit(s)}>
                            Sửa
                          </Button>
                          <Button
                            variant="ghost"
                            aria-label={`Xoá ca ${dayName}`}
                            style={{ color: 'var(--color-text-danger)' }}
                            disabled={delM.isPending}
                            onPress={() => delM.mutate(s.id)}
                          >
                            Xoá
                          </Button>
                        </div>
                      )}
                      {s.status === 'APPROVED' && (
                        <Button
                          variant="ghost"
                          aria-label={`Huỷ ca ${dayName}`}
                          style={{ color: 'var(--color-text-danger)' }}
                          onPress={() => setCancelId(s.id)}
                        >
                          Huỷ ca
                        </Button>
                      )}
                    </div>
                  );
                })}
              </Card>
            );
          })}
      </div>

      {/* Sheet thêm/sửa */}
      <BottomSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={`${editId ? 'Sửa ca' : 'Thêm ca'} · ${dowLabel(formDay)} ${shortDayLabel(formDay)}`}
        footer={
          <Button
            fullWidth
            loading={saveM.isPending}
            disabled={!custom && !editId ? !tplId : !TIME_RE.test(customStart) || !TIME_RE.test(customEnd)}
            onPress={() => saveM.mutate()}
          >
            {editId ? 'Lưu' : 'Gửi duyệt'}
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!editId && (tplQ.data?.length ?? 0) > 0 && (
            <>
              <Text variant="caption" tone="secondary" as="div">
                Chọn ca chuẩn
              </Text>
              <div role="group" aria-label="Ca chuẩn" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {tplQ.data!.map((t: ShiftTemplate) => {
                  const picked = !custom && tplId === t.id;
                  return (
                    <Button
                      key={t.id}
                      variant={picked ? 'primary' : 'secondary'}
                      aria-pressed={picked}
                      onPress={() => {
                        setCustom(false);
                        setTplId(t.id);
                      }}
                    >
                      {t.name} ({minToHHMM(t.startMin)}–{minToHHMM(t.endMin)})
                    </Button>
                  );
                })}
                <Button variant={custom ? 'primary' : 'secondary'} aria-pressed={custom} onPress={() => setCustom(true)}>
                  Giờ khác
                </Button>
              </div>
            </>
          )}

          {(custom || editId || (tplQ.data?.length ?? 0) === 0) && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Field label="Bắt đầu">
                  <TimeInput value={customStart} onChange={setCustomStart} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Kết thúc">
                  <TimeInput value={customEnd} onChange={setCustomEnd} />
                </Field>
              </div>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* Sheet đăng ký nhanh nhiều ngày */}
      <BottomSheet
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Đăng ký nhanh cả tuần"
        footer={
          <Button
            fullWidth
            loading={quickM.isPending}
            disabled={quickDays.size === 0 || (!quickTplId && (!TIME_RE.test(quickStart) || !TIME_RE.test(quickEnd)))}
            onPress={() => quickM.mutate()}
          >
            Gửi duyệt {quickDays.size > 0 ? `(${quickDays.size} ngày)` : ''}
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(tplQ.data?.length ?? 0) > 0 && (
            <div role="group" aria-label="Ca chuẩn" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tplQ.data!.map((t) => (
                <Button
                  key={t.id}
                  variant={quickTplId === t.id ? 'primary' : 'secondary'}
                  aria-pressed={quickTplId === t.id}
                  onPress={() => setQuickTplId(quickTplId === t.id ? null : t.id)}
                >
                  {t.name} ({minToHHMM(t.startMin)}–{minToHHMM(t.endMin)})
                </Button>
              ))}
            </div>
          )}

          {!quickTplId && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Field label="Bắt đầu">
                  <TimeInput value={quickStart} onChange={setQuickStart} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Kết thúc">
                  <TimeInput value={quickEnd} onChange={setQuickEnd} />
                </Field>
              </div>
            </div>
          )}

          <Text variant="caption" tone="secondary" as="div">
            Chọn ngày áp dụng
          </Text>
          <div role="group" aria-label="Ngày áp dụng" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {dayKeys.map((dk) => (
              <Button
                key={dk}
                disabled={dk < todayKey}
                variant={quickDays.has(dk) ? 'primary' : 'secondary'}
                aria-pressed={quickDays.has(dk)}
                onPress={() => toggleQuickDay(dk)}
              >
                {dowLabel(dk)} {shortDayLabel(dk)}
              </Button>
            ))}
          </div>
        </div>
      </BottomSheet>

      {/* Sheet huỷ ca */}
      <BottomSheet
        open={!!cancelId}
        onClose={() => setCancelId(null)}
        title="Huỷ ca đã duyệt"
        footer={
          <Button
            fullWidth
            loading={cancelM.isPending}
            disabled={cancelReason.trim().length === 0 || (cancelEmergency && !cancelEvidence)}
            onPress={() => cancelM.mutate()}
          >
            Xác nhận huỷ
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Text variant="caption" tone="secondary" as="div">
            Huỷ trước 3 ngày: miễn phạt. Trễ hơn: phạt 1h công (trừ đột xuất có chứng cứ, tối đa 3 lần/tháng).
          </Text>
          <Field label="Lý do huỷ">
            <Input.TextArea placeholder="Lý do huỷ" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </Field>
          <SwitchRow label="Đột xuất (có chứng cứ)" on={cancelEmergency} onToggle={() => setCancelEmergency((v) => !v)} />
          {cancelEmergency && (
            <ImageUpload label="Ảnh chứng cứ" value={cancelEvidence} onChange={setCancelEvidence} />
          )}
        </div>
      </BottomSheet>
    </Page>
  );
}

/** Cả hàng là công tắc (vùng chạm >= 44px), không chỉ viên thuốc 26px bên phải. */
function SwitchRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div
      role="switch"
      aria-checked={on}
      aria-label={label}
      {...rowKeyboardProps()}
      className="tubu-press"
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 44,
        padding: '4px 0',
        boxSizing: 'border-box',
        cursor: 'pointer',
      }}
    >
      <Text variant="body-sm">{label}</Text>
      <span
        aria-hidden
        style={{
          width: 44,
          height: 26,
          flexShrink: 0,
          borderRadius: 'var(--radius-pill)',
          // Trạng thái tắt dùng border-strong: thanh trượt phải đạt 3:1 với nền thẻ (WCAG 1.4.11).
          background: on ? 'var(--color-action-primary-bg)' : 'var(--color-border-strong)',
          position: 'relative',
          transition: 'background var(--motion-enter)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: on ? 21 : 3,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'var(--color-bg-surface)',
            boxShadow: 'var(--elevation-1)',
            transition: 'left var(--motion-enter)',
          }}
        />
      </span>
    </div>
  );
}
