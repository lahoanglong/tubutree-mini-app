'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminEventParticipants,
  adminEvents,
  closeEvent,
  createEvent,
  pickEventWinner,
  type AdminCommunityEvent,
  type CreateEventInput,
} from '@tubutree/app-core/api/feed';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { formatNumber } from '@/components/game/format';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/admin-error-text';
import { hasVisibleText } from '@/lib/admin-visible-text';
import { formatDateTime } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { IMAGES_UPLOADING } from '@/lib/image-compress';
import { settleWithin } from '@/lib/settle-within';
import { useUploadBusy } from '@/lib/use-upload-busy';
import { vnDateTimeISO } from '@/lib/week';
import { useConfirm } from './confirm-dialog';
import { ImageUrlField } from './image-url-field';
import { BTN_DANGER_OUTLINE, BTN_PRIMARY, BTN_SECONDARY, chipClass, Field, INPUT_CLASS, LoadError, Notice, ListSkeleton } from './ui';

type Status = 'OPEN' | 'CLOSED';
type Msg = { tone: 'success' | 'warning' | 'danger'; text: string };

const EVENTS_KEY = ['admin-community-events'];
const PARTICIPANTS_KEY = 'admin-community-event-participants';
/** Nút đang chạy báo bận bằng aria-disabled thay `disabled` DOM: Chromium thả focus về body khi nút đang giữ focus bị disabled. */
const BUSY_CLASS = 'aria-disabled:opacity-60';
const points = (n: number) => `${formatNumber(n)} Điểm Xanh`;
/** Ô datetime-local là giờ Việt Nam, không theo múi giờ của máy đang mở trang. */
const vnIso = (local: string) => {
  const [day = '', time = ''] = local.split('T');
  return vnDateTimeISO(day, time.slice(0, 5));
};

/**
 * Sự kiện cộng đồng cho ADMIN, cùng việc với màn kiểm duyệt của Mini App: tạo sự kiện, đóng sự kiện không chọn người thắng,
 * chọn người thắng trong số người đã có bài dự thi được đăng (người thắng được cộng Điểm Xanh và nhận thông báo).
 */
export function EventsPanel() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('OPEN');
  const [msg, setMsg] = useState<Msg | null>(null);
  const q = useQuery({ queryKey: [...EVENTS_KEY, status], queryFn: () => adminEvents(coreHttp, status) });
  // Trả Promise để lệnh ghi giữ khoá nút tới khi danh sách làm mới về, kẻo nút Chốt/Đóng của sự kiện đã xong còn bấm được.
  const refresh = () => qc.invalidateQueries({ queryKey: EVENTS_KEY });

  return (
    <div className="space-y-3">
      <CreateEventForm
        onCreated={() => {
          setMsg({ tone: 'success', text: 'Đã tạo sự kiện.' });
          return refresh();
        }}
      />
      {msg && (
        <Notice tone={msg.tone} role={msg.tone === 'success' ? 'status' : 'alert'}>
          {msg.text}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Trạng thái sự kiện">
        {(['OPEN', 'CLOSED'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={chipClass(status === s)}
            aria-pressed={status === s}
            onClick={() => {
              setMsg(null);
              setStatus(s);
            }}
          >
            {s === 'OPEN' ? 'Đang mở' : 'Đã đóng'}
          </button>
        ))}
      </div>
      {q.isLoading && <ListSkeleton label="Đang tải danh sách sự kiện" rows={3} className="h-24" />}
      {q.isError && (
        <LoadError onRetry={() => q.refetch({ cancelRefetch: false })} retrying={q.isFetching}>
          Không tải được danh sách sự kiện.
        </LoadError>
      )}
      {q.data && q.data.length === 0 && (
        <p className="text-xs text-stone-500">{status === 'OPEN' ? 'Chưa có sự kiện nào đang mở.' : 'Chưa có sự kiện nào đã đóng.'}</p>
      )}
      <ul className="space-y-2">
        {q.data?.map((e) => (status === 'OPEN' ? <OpenEventRow key={e.id} event={e} onMessage={setMsg} onDone={refresh} /> : <ClosedEventRow key={e.id} event={e} />))}
      </ul>
    </div>
  );
}

function EventHead({ event: e }: { event: AdminCommunityEvent }) {
  return (
    <>
      <div className="break-words font-medium text-stone-900">{e.title}</div>
      {e.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-800">{e.description}</p>}
      <p className="mt-1 text-xs tabular-nums text-stone-600">
        Bắt đầu {formatDateTime(e.startAt)} · Kết thúc {formatDateTime(e.endAt)} · Thưởng {e.rewardPoints > 0 ? points(e.rewardPoints) : 'không có quà'}
      </p>
    </>
  );
}

function ClosedEventRow({ event: e }: { event: AdminCommunityEvent }) {
  return (
    <li data-event={e.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
      <EventHead event={e} />
      <p className="mt-2 text-sm text-stone-800">{e.winner ? <>Người thắng: <strong>{e.winner.name}</strong></> : 'Đã đóng, không chọn người thắng.'}</p>
    </li>
  );
}

function OpenEventRow({ event: e, onMessage, onDone }: { event: AdminCommunityEvent; onMessage: (m: Msg | null) => void; onDone: () => Promise<unknown> }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const participantsQ = useQuery({
    queryKey: [PARTICIPANTS_KEY, e.id],
    queryFn: () => adminEventParticipants(coreHttp, e.id),
    enabled: choosing,
  });
  const participants = participantsQ.data ?? [];
  const chosen = participants.find((p) => p.userId === selected) ?? null;

  // Ref vì `isPending` chỉ đúng sau lần vẽ kế: hai lệnh Chốt/Đóng xác nhận sát nhau trong cùng một nhịp vẫn gửi cả hai.
  const acting = useRef(false);
  const exclusive = (run: () => void) => {
    if (acting.current) return;
    acting.current = true;
    run();
  };
  const releaseActing = () => {
    acting.current = false;
  };
  // Lệnh bị từ chối vì trạng thái đã đổi (sự kiện đã đóng hoặc đã có người thắng, bài dự thi bị gỡ, sự kiện không còn): hàng đang hiện dữ
  // liệu cũ nên tải lại cả danh sách lẫn người dự thi và giữ khoá tới khi xong, kẻo bấm lại ra đúng lỗi cũ. Lỗi mạng/5xx/401 thì trạng thái
  // chưa chắc đã đổi, và tải lại hỏng sẽ thay danh sách bằng màn lỗi, nên không tải lại.
  const refreshWhenRejected = (err: unknown) => {
    const status = errorStatus(err);
    if (status !== 400 && status !== 404 && status !== 409) return undefined;
    return settleWithin(Promise.all([onDone(), qc.invalidateQueries({ queryKey: [PARTICIPANTS_KEY, e.id] })]));
  };

  // onSuccess trả Promise: mutation chỉ hết `isPending` (và onSettled nhả khoá) khi danh sách làm mới về, tối đa `settleWithin`. Nhả sớm thì
  // hàng còn nút Chốt/Đóng của sự kiện đã xong, bấm lại ra lỗi "đã đóng" ngay sau câu báo thành công.
  const close = useMutation({
    mutationFn: () => closeEvent(coreHttp, e.id),
    onMutate: () => onMessage(null),
    onSuccess: () => {
      onMessage({ tone: 'success', text: 'Đã đóng sự kiện.' });
      return settleWithin(onDone());
    },
    onError: (err) => {
      onMessage({ tone: 'danger', text: actionErrorText(err) });
      return refreshWhenRejected(err);
    },
    onSettled: releaseActing,
  });
  const pick = useMutation({
    mutationFn: (userId: string) => pickEventWinner(coreHttp, e.id, userId) as Promise<{ ok: boolean; rewarded?: boolean }>,
    onMutate: () => onMessage(null),
    onSuccess: (res, userId) => {
      const name = participants.find((p) => p.userId === userId)?.name ?? 'người này';
      if (e.rewardPoints > 0 && res.rewarded === false) {
        onMessage({ tone: 'warning', text: `Đã chốt ${name} là người thắng nhưng CHƯA cộng được Điểm Xanh thưởng. Báo kỹ thuật kiểm tra ngay.` });
      } else if (e.rewardPoints > 0 && res.rewarded === true) {
        onMessage({ tone: 'success', text: `Đã chốt ${name} là người thắng và cộng ${points(e.rewardPoints)}.` });
      } else {
        onMessage({ tone: 'success', text: `Đã chốt ${name} là người thắng.` });
      }
      return settleWithin(onDone());
    },
    onError: (err) => {
      onMessage({ tone: 'danger', text: actionErrorText(err) });
      return refreshWhenRejected(err);
    },
    onSettled: releaseActing,
  });
  const busy = close.isPending || pick.isPending;

  const askClose = async () => {
    if (acting.current) return;
    const ok = await confirm({
      title: 'Đóng sự kiện này?',
      message: `Đóng "${e.title}" mà không chọn người thắng. Sự kiện đóng rồi không mở lại được và không ai được thưởng.`,
      confirmLabel: 'Đóng sự kiện',
      tone: 'danger',
    });
    if (ok) exclusive(() => close.mutate());
  };
  const askPick = async () => {
    if (!chosen || acting.current) return;
    const ok = await confirm({
      title: `Chốt ${chosen.name} là người thắng?`,
      message:
        e.rewardPoints > 0
          ? `${chosen.name} được cộng ${points(e.rewardPoints)} và nhận thông báo. Sự kiện đóng lại, không đổi được người thắng.`
          : `${chosen.name} nhận thông báo là người thắng (sự kiện không có quà). Sự kiện đóng lại, không đổi được người thắng.`,
      confirmLabel: 'Chốt người thắng',
    });
    if (ok) exclusive(() => pick.mutate(chosen.userId));
  };

  return (
    <li data-event={e.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
      {dialog}
      <EventHead event={e} />
      {choosing && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium text-stone-700">Chọn người thắng trong số người đã có bài dự thi được đăng</p>
          {participantsQ.isLoading && <ListSkeleton label="Đang tải người dự thi" rows={2} className="h-10" />}
          {participantsQ.isError && (
            <LoadError onRetry={() => participantsQ.refetch({ cancelRefetch: false })} retrying={participantsQ.isFetching}>
              Không tải được người dự thi.
            </LoadError>
          )}
          {participantsQ.data && participants.length === 0 && (
            <p className="text-xs text-stone-500">Chưa có bài dự thi nào được đăng. Khi có bài, bạn chọn người thắng từ danh sách này.</p>
          )}
          {participants.length > 0 && (
            <div role="radiogroup" aria-label="Người dự thi" className="space-y-1.5">
              {participants.map((p) => {
                const active = p.userId === selected;
                return (
                  <button
                    key={p.userId}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelected(p.userId)}
                    className={`block min-h-[44px] w-full rounded-control border px-3 py-2 text-left text-sm ${active ? 'border-forest-600 bg-forest-50' : 'border-stone-200 bg-stone-0 hover:bg-stone-50'}`}
                  >
                    <span className="block font-medium text-stone-900">{p.name}</span>
                    <span className="block truncate text-xs text-stone-600">{p.postTitle}</span>
                    <span className="block text-xs tabular-nums text-stone-500">
                      {p.postCount} bài dự thi · mới nhất {formatDateTime(p.postedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {participants.length > 0 && (
            <button
              type="button"
              disabled={!chosen}
              aria-busy={busy || undefined}
              aria-disabled={busy || undefined}
              onClick={() => void askPick()}
              className={`${BTN_PRIMARY} ${BUSY_CLASS}`}
            >
              {chosen ? `Chốt ${chosen.name} là người thắng` : 'Chọn một người ở trên'}
            </button>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!choosing && (
          <button
            type="button"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (acting.current) return;
              setChoosing(true);
            }}
            className={`${BTN_SECONDARY} ${BUSY_CLASS}`}
          >
            Chọn người thắng
          </button>
        )}
        <button
          type="button"
          aria-busy={busy || undefined}
          aria-disabled={busy || undefined}
          onClick={() => void askClose()}
          className={`${BTN_DANGER_OUTLINE} ${BUSY_CLASS}`}
        >
          Đóng sự kiện
        </button>
      </div>
    </li>
  );
}

function CreateEventForm({ onCreated }: { onCreated: () => Promise<unknown> }) {
  const config = useQuery({ ...publicConfigQuery(coreHttp), retry: false }).data;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [reward, setReward] = useState('0');
  const [err, setErr] = useState<string | null>(null);
  // Tạo sự kiện lúc ảnh bìa còn đang lên sẽ tạo không bìa; ảnh về sau rơi sang biểu mẫu trống kế tiếp.
  const { busy: coverBusy, onBusyChange } = useUploadBusy();

  // Ref vì `isPending` chỉ đúng sau lần vẽ kế (Enter hai lần sát nhau vẫn gửi hai lệnh). Khoá giữ tới khi danh sách làm mới về (tối đa
  // `settleWithin`); các ô nhập vẫn sửa được trong lúc đó để người dùng soạn sự kiện kế tiếp. Riêng ô ảnh bìa chỉ khoá lúc lệnh tạo còn
  // bay (ảnh chọn lúc đó rơi sang biểu mẫu trống kế tiếp), không khoá lúc chỉ còn chờ danh sách làm mới.
  const creating = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const create = useMutation({
    mutationFn: (dto: CreateEventInput) => createEvent(coreHttp, dto),
    onSuccess: () => {
      setTitle('');
      setDescription('');
      setCoverUrl('');
      setStartAt('');
      setEndAt('');
      setReward('0');
      setErr(null);
      setRefreshing(true);
      return settleWithin(onCreated());
    },
    onError: (e) => setErr(actionErrorText(e)),
    onSettled: () => {
      creating.current = false;
      setRefreshing(false);
    },
  });

  const rewardOk = reward === '' || /^\d+$/.test(reward);
  const orderOk = !startAt || !endAt || endAt > startAt;
  const valid = hasVisibleText(title) && !!startAt && !!endAt && orderOk && rewardOk;
  const rewardHint =
    config?.loyalty && config.community
      ? `1 điểm = ${formatVnd(config.loyalty.vndPerPointRedeem)}, tối đa ${formatNumber(config.community.eventRewardMaxPoints)} điểm. Để 0 nếu không có quà.`
      : 'Điểm Xanh thưởng cho người thắng sự kiện. Để 0 nếu không có quà.';

  return (
    <form
      className="space-y-2.5 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!valid || creating.current || create.isPending || coverBusy) return;
        creating.current = true;
        setErr(null);
        create.mutate({
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(coverUrl ? { coverUrl } : {}),
          startAt: vnIso(startAt),
          endAt: vnIso(endAt),
          rewardPoints: Number(reward || 0),
        });
      }}
    >
      <h3 className="text-sm font-semibold text-stone-900">Tạo sự kiện</h3>
      <Field label="Tên sự kiện">
        <input name="eventTitle" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLASS} />
      </Field>
      <Field label="Mô tả (không bắt buộc)">
        <textarea name="eventDescription" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT_CLASS} />
      </Field>
      <ImageUrlField label="Ảnh bìa sự kiện" value={coverUrl} onChange={setCoverUrl} onBusyChange={onBusyChange} disabled={create.isPending && !refreshing} />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Bắt đầu (giờ Việt Nam)">
          <input type="datetime-local" name="eventStart" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={INPUT_CLASS} />
        </Field>
        <Field label="Kết thúc (giờ Việt Nam)">
          <input type="datetime-local" name="eventEnd" value={endAt} onChange={(e) => setEndAt(e.target.value)} className={INPUT_CLASS} />
        </Field>
      </div>
      {!orderOk && <p className="text-xs text-danger-fg">Giờ kết thúc phải sau giờ bắt đầu.</p>}
      <Field label="Thưởng Điểm Xanh cho người thắng" hint={rewardHint}>
        <input type="number" inputMode="numeric" min={0} step={1} name="eventReward" value={reward} onChange={(e) => setReward(e.target.value)} className={`${INPUT_CLASS} tabular-nums`} />
      </Field>
      {err && (
        <Notice tone="danger" role="alert">
          {err}
        </Notice>
      )}
      {/* Form được xoá ngay khi tạo xong nên `valid` sụp trong lúc còn giữ khoá: chỉ disabled khi không chạy, để nút không đổi trạng thái giữa chừng. Khoá nhả (tối đa 4 giây sau) thì form trống nên nút disabled và focus rời nút, giống Mini. */}
      <button
        type="submit"
        disabled={(!valid && !create.isPending) || coverBusy}
        aria-busy={create.isPending || undefined}
        aria-disabled={create.isPending || undefined}
        className={`${BTN_PRIMARY} ${BUSY_CLASS}`}
      >
        {create.isPending ? 'Đang tạo…' : coverBusy ? IMAGES_UPLOADING : 'Tạo sự kiện'}
      </button>
    </form>
  );
}
