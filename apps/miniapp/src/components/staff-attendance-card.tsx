import { useEffect, useRef, useState } from 'react';
import { useSnackbar } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogIn, LogOut, MapPin } from 'lucide-react';
import {
  getAttendanceStatus,
  acquireLocationPayload,
  checkin as attnCheckin,
  checkout as attnCheckout,
  heartbeat as attnHeartbeat,
} from '../services/attendance-api';
import { getErrorMessage, isStaleStateError, isTargetGoneError } from '../services/api';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Field } from './ui/form';
import { Icon } from './ui/icon';
import { Skeleton } from './ui/skeleton';
import { Heading, Text } from './ui/text';
import { TimeInput } from './ui/time-input';
import { useLockedMutation } from './game/use-locked-mutation';
import { useSheetSeq } from '../hooks/use-sheet-seq';
import { addDaysKey, isoToVnHHMM, vnDateKey, vnDateTimeISO } from '../utils/week';
import { closeAfterFresh, settleWithin } from '../utils/settle-within';

const TIME_RE = /^\d{1,2}:\d{2}$/;

/**
 * Vào ca, ra ca và heartbeat cần token vị trí của Zalo nên chỉ làm được trong Mini App; website chỉ xem được trạng thái
 * (apps/web/src/components/staff/today-card.tsx). Phần còn lại của màn nhân sự (xếp ca, lương) đã chuyển sang website.
 */
export function StaffAttendanceCard() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const statusQ = useQuery({ queryKey: ['attn-status'], queryFn: getAttendanceStatus });
  const open = statusQ.data?.openSession ?? null;
  const todayShifts = statusQ.data?.shifts ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['attn-status'] });
  // Máy chủ từ chối vì phiên chấm công đã khác màn (đã vào ca/ra ca rồi...): trả Promise từ onError để khoá `attending` và nút giữ tới khi
  // trạng thái mới về (tối đa `settleWithin`), kẻo bấm lại trên trạng thái cũ nhận đúng lỗi đó. Mất mạng, 401, 5xx không nói gì về phiên: nhả ngay.
  const refreshIfStale = (e: unknown) => (isStaleStateError(e) ? settleWithin(invalidate()) : undefined);

  const locFailRef = useRef<string | null>(null);
  // Vào ca, Ra ca và Ra ca lùi giờ cùng đổi phiên chấm công của một người: một việc mỗi lúc. Khoá ref vì `isPending`
  // chỉ đúng sau lần vẽ kế tiếp (chạm "Vào ca" rồi "Ra ca" sát nhau vẫn gửi cả hai và phiên bị mở lẫn đóng).
  const attending = useRef(false);
  const releaseAttending = () => {
    attending.current = false;
  };
  const exclusive = (run: () => void) => {
    if (attending.current) return;
    attending.current = true;
    run();
  };

  const [backOpen, setBackOpen] = useState(false);
  const backSeq = useSheetSeq(backOpen);
  const [backTime, setBackTime] = useState('12:00');

  const checkinM = useLockedMutation({
    onSettled: releaseAttending,
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
    onError: (e) => {
      openSnackbar({
        text: locFailRef.current ? `${locFailRef.current} ${getErrorMessage(e)}` : getErrorMessage(e),
        type: 'error',
      });
      return refreshIfStale(e);
    },
  }, (shiftId) => shiftId);

  const checkoutM = useLockedMutation({
    onSettled: releaseAttending,
    mutationFn: (at?: string) => attnCheckout(at),
    onMutate: () => backSeq.mark(),
    onSuccess: (_r, _at, sent) => {
      openSnackbar({ text: 'Đã ra ca.', type: 'success' });
      // Tấm đóng được lúc lệnh chạy: khách đóng rồi mở lại (đang gõ giờ) thì phản hồi của lần mở trước không đóng lần mở này.
      if (backSeq.isCurrent(sent)) setBackOpen(false);
      invalidate();
    },
    onError: (e, _at, sent) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Tấm "Ra ca lùi giờ" có ô giờ: chỉ đóng khi phiên không còn hoặc vừa đổi (404/409, đã ra ca ở máy khác); 400/422 là giờ chọn chưa hợp lệ, giữ tấm để sửa.
      // Đóng sau khi trạng thái chấm công mới về, không đóng trước: tấm biến mất mà màn còn phiên cũ. Chỉ đóng nếu LÚC ĐÓ tấm vẫn là lần mở đã gửi lệnh.
      const held = refreshIfStale(e);
      if (!isTargetGoneError(e)) return held;
      return closeAfterFresh(held, () => {
        if (backSeq.isCurrent(sent)) setBackOpen(false);
      });
    },
  });
  const attendBusy = checkinM.isPending || checkoutM.isPending;

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
  useEffect(() => {
    if (!openId) return;
    // Lấy vị trí có thể mất vài giây: nếu nhân viên ra ca (hoặc rời trang) trong lúc đó thì nhịp cũ không được gửi
    // heartbeat cho phiên đã đóng, cũng không báo lỗi vị trí cho phiên đã đóng. Câu trả lời "closed" của một heartbeat
    // đã gửi thì vẫn báo: máy chủ thật sự đã tự ra ca, kể cả khi người dùng vừa rời trang.
    let alive = true;
    let locFailNotified = false; // mỗi chuỗi lỗi vị trí chỉ báo một lần, không báo lại mỗi nhịp
    const tick = async () => {
      try {
        let locFailed = false;
        const loc = await acquireLocationPayload((m) => {
          locFailed = true;
          if (alive && !locFailNotified) {
            locFailNotified = true;
            openSnackbar({ text: m, type: 'warning' });
          }
        });
        if (!alive) return;
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
    const timer = setInterval(tick, 3 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [openId]);

  const tone = open ? 'inverse' : 'primary';
  return (
    <Card
      padding={16}
      style={open ? { background: 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))', boxShadow: 'none' } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-inline-sm)', marginBottom: 'var(--space-stack-sm)' }}>
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
            style={{ marginTop: 'var(--space-stack-sm)' }}
            loading={attendBusy}
            onPress={() => exclusive(() => checkoutM.mutate(undefined))}
          >
            Ra ca
          </Button>
          <Button
            fullWidth
            variant="ghost"
            onPress={() => {
              setBackTime(isoToVnHHMM(open.checkinAt));
              setBackOpen(true);
            }}
          >
            Quên ra ca? Chọn giờ đã về
          </Button>
          <Text variant="caption" tone="inverse" as="div">
            Nghỉ giữa ca? Ra ca rồi vào ca lại khi quay lại.
          </Text>
        </>
      ) : statusQ.isError ? (
        <div>
          <Text variant="body-sm" tone="secondary" as="div">
            Không tải được trạng thái chấm công.
          </Text>
          <Button variant="secondary" style={{ marginTop: 'var(--space-stack-sm)' }} onPress={() => statusQ.refetch()}>
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
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-stack-sm)', gap: 'var(--space-inline-sm)' }}
          >
            <Text variant="body-sm" numeric>
              Ca {isoToVnHHMM(s.approvedStart ?? s.startAt)}–{isoToVnHHMM(s.approvedEnd ?? s.endAt)}
            </Text>
            <Button icon={LogIn} loading={attendBusy} onPress={() => exclusive(() => checkinM.mutate(s.id))}>
              Vào ca
            </Button>
          </div>
        ))
      )}
      <Text variant="caption" tone={open ? 'inverse' : 'tertiary'} as="div" style={{ marginTop: 'var(--space-stack-sm)' }}>
        Cần ở đúng mạng WiFi công ty & trong vùng để chấm công.
      </Text>

      <BottomSheet
        open={backOpen}
        onClose={() => setBackOpen(false)}
        title="Ra ca lùi giờ"
        footer={
          <Button
            fullWidth
            loading={attendBusy}
            disabled={backoutInvalid}
            onPress={() => backoutCandidateISO && exclusive(() => checkoutM.mutate(backoutCandidateISO))}
          >
            Xác nhận ra ca
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}>
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
