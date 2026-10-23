'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveExternalClaim,
  attachExternalClaimAttempt,
  getExternalClaim,
  keepExternalClaimPoints,
  listExternalClaimAttempts,
  listExternalClaims,
  nextPageParam,
  rejectExternalClaimAttempt,
  reverseExternalClaim,
  voidExternalClaim,
  type AdminExternalAttemptRow,
  type AdminExternalClaimRow,
  type AdminExternalClaimAttentionFilter,
  type ExternalClaimState,
} from '@/lib/admin-client';
import {
  ATTENTION_FILTER_LABEL,
  EVENT_ACTION_LABEL,
  attachDialogMessage,
  ORDER_STATUS_LABEL,
  PHONE_STALE_LABEL,
  adminClaimErrorText,
  approveNeedsNote,
  approveNoteError,
  isNoteRequiredError,
  creditedOnClosedOrder,
  isIntroducer,
  CLAIM_SOURCE_LABEL,
  CLAIM_STATE_LABEL,
  CLAIM_STATE_ORDER,
  CLAIM_STATE_TONE,
  claimActions,
  type ClaimActor,
  groupThousands,
} from '@/lib/external-claims';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { formatVnd } from '@/lib/shop-client';
import { useConfirm } from './confirm-dialog';
import { useDebounced } from './search-picker';
import { BTN_SECONDARY, BTN_XS_DANGER, BTN_XS_PRIMARY, BTN_XS_SECONDARY, DlRow, FIELD_XS, Notice, ToneBadge, chipClass, LoadError } from './ui';

type Who = ClaimActor;

/**
 * Điểm Xanh cho đơn sàn khách tự nhập mã vận đơn. CSKH duyệt claim cần kiểm, huỷ (có lý do, có thể mở lại mã) và xử lý lần gửi
 * mã chưa ghép được; chỉ ADMIN đảo điểm đã cộng. KE_TOAN chỉ xem. SĐT luôn che.
 */
export function ExternalClaimsTab({ isAdmin, canAct, meId }: Who) {
  const [state, setState] = useState<ExternalClaimState | ''>('REVIEW');
  const [typed, setTyped] = useState('');
  const [attention, setAttention] = useState<AdminExternalClaimAttentionFilter | ''>('');
  const q = useDebounced(typed.trim(), 300);
  const claims = useInfiniteQuery({
    queryKey: ['admin-external-claims', state, q, attention],
    queryFn: ({ pageParam }) => listExternalClaims({ state: state || undefined, q: q || undefined, attention: attention || undefined }, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageParam(last.meta),
  });
  const rows = claims.data?.pages.flatMap((p) => p.data) ?? [];
  const total = claims.data?.pages[0]?.meta.total;
  const who = { isAdmin, canAct, meId };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">Tích điểm đơn sàn</h2>
        {total !== undefined && <span className="text-xs text-stone-500">{total} yêu cầu</span>}
      </div>
      <Notice>
        Khách nhập mã vận đơn đơn sàn trong Mini App để tích Điểm Xanh. Điểm chỉ được cộng khi đơn giao thành công và qua thời gian đối soát.
        Không ai xử lý được yêu cầu của chính mình, và người gắn đơn hoặc đưa yêu cầu vào chờ duyệt không tự duyệt được.
        {!canAct && ' Bạn chỉ có quyền xem.'}
      </Notice>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Lọc theo trạng thái">
          {[...CLAIM_STATE_ORDER, ''].map((s) => (
            <button key={s || 'all'} type="button" role="tab" aria-selected={state === s} onClick={() => {
                setState(s as ExternalClaimState | '');
                setAttention('');
              }} className={chipClass(state === s)}>
              {s ? CLAIM_STATE_LABEL[s as ExternalClaimState] : 'Tất cả'}
            </button>
          ))}
        </div>
        <select
          aria-label="Lọc việc cần chú ý"
          value={attention}
          onChange={(e) => {
            const v = e.target.value as AdminExternalClaimAttentionFilter | '';
            setAttention(v);
            if (v) setState('');
          }}
          className={FIELD_XS}
        >
          <option value="">Mọi yêu cầu</option>
          {(Object.keys(ATTENTION_FILTER_LABEL) as AdminExternalClaimAttentionFilter[]).map((k) => (
            <option key={k} value={k}>{ATTENTION_FILTER_LABEL[k]}</option>
          ))}
        </select>
        <input
          type="search"
          aria-label="Tìm yêu cầu tích điểm"
          placeholder="Mã vận đơn, mã đơn Pancake, mã yêu cầu hoặc SĐT đầy đủ"
          maxLength={100}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className={`${FIELD_XS} w-full sm:w-96`}
        />
      </div>
      {claims.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {claims.isError && <LoadError onRetry={() => void claims.refetch()} retrying={claims.isFetching}>Không tải được danh sách yêu cầu.</LoadError>}
      {claims.isSuccess && rows.length === 0 && <p className="text-sm text-stone-500">Không có yêu cầu nào khớp.</p>}
      <ul className="space-y-2">
        {rows.map((c) => (
          <ClaimRow key={c.id} claim={c} who={who} />
        ))}
      </ul>
      {claims.hasNextPage && (
        <div className="text-center">
          <button type="button" onClick={() => void claims.fetchNextPage()} disabled={claims.isFetchingNextPage} className={BTN_SECONDARY}>
            {claims.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
          </button>
        </div>
      )}
      <AttemptsSection who={who} />
    </div>
  );
}

function ClaimRow({ claim: c, who }: { claim: AdminExternalClaimRow; who: Who }) {
  const qc = useQueryClient();
  const { confirm, ask, dialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ['admin-external-claim', c.id], queryFn: () => getExternalClaim(c.id), enabled: open });
  const row = detail.data ?? c;
  const acts = claimActions(c, who);
  const blockedApprove = acts.approve && isIntroducer(detail.data?.events ?? [], who.meId);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-external-claims'] });
    void qc.invalidateQueries({ queryKey: ['admin-external-claim', c.id] });
    void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
  };
  const mut = useMutation({
    mutationFn: (run: () => Promise<string | null>) => run(),
    onSuccess: (msg) => {
      setErr(null);
      setDone(msg);
      refresh();
    },
    onError: (e) => {
      setErr(adminClaimErrorText(e));
      refresh();
    },
  });

  const approveWithNote = async (initial = '', error?: string): Promise<void> => {
    const note = await ask({
      title: 'Duyệt yêu cầu: SĐT xác minh đã cũ',
      message: `Mốc xác minh SĐT của thành viên đã cũ nên chưa chắc số vẫn của người đó. Hãy kiểm người nhận (ví dụ gọi xác nhận) rồi ghi lại cách bạn đã xác nhận cho mã ${c.maskedCode}. Không ghi số điện thoại đầy đủ vào ghi chú. Điểm được tính lại theo tiền hàng mới nhất của đơn.`,
      confirmLabel: 'Duyệt',
      input: { label: 'Ghi chú (đã xác nhận người nhận bằng cách nào)', maxLength: 300, required: true, validate: approveNoteError, initial, error },
    });
    if (!note) return;
    // Máy chủ vẫn đòi ghi chú (luật lệch hoặc mốc vừa đổi): mở lại hộp với lỗi ngay trong hộp, giữ nội dung đã gõ.
    mut.mutateAsync(async () => (await approveExternalClaim(c.id, note), 'Đã duyệt, điểm đang chờ cộng.')).catch((e: unknown) => {
      if (!isNoteRequiredError(e)) return;
      setErr(null);
      void approveWithNote(note, adminClaimErrorText(e));
    });
  };
  const approve = async () => {
    if (approveNeedsNote(row)) return approveWithNote();
    const ok = await confirm({
      title: 'Duyệt yêu cầu tích điểm',
      message: `Duyệt mã ${c.maskedCode}? Điểm được tính lại theo tiền hàng mới nhất của đơn và sẽ cộng cho khách sau khi đơn giao đủ thời gian đối soát.`,
      confirmLabel: 'Duyệt',
    });
    if (!ok) return;
    // Dữ liệu danh sách có thể cũ (mốc xác minh vừa hết hạn): API đòi ghi chú thì mở ngay hộp ghi chú cho đúng claim này.
    mut.mutateAsync(async () => (await approveExternalClaim(c.id), 'Đã duyệt, điểm đang chờ cộng.')).catch((e: unknown) => {
      if (!isNoteRequiredError(e)) return;
      setErr(null);
      void approveWithNote();
    });
  };
  const voidIt = async (reopen: boolean) => {
    const reason = await ask({
      title: reopen ? 'Huỷ và mở lại mã' : 'Huỷ yêu cầu tích điểm',
      message: reopen
        ? `Huỷ yêu cầu ${c.maskedCode} và mở lại mã: khách (hoặc người khác) có thể nhập lại mã này. Khách nhận thông báo điểm không được cộng.`
        : `Huỷ yêu cầu ${c.maskedCode}: điểm chờ không được cộng và mã này bị chặn nhập lại. Khách nhận thông báo điểm không được cộng.`,
      confirmLabel: reopen ? 'Huỷ và mở lại mã' : 'Huỷ yêu cầu',
      cancelLabel: 'Đóng',
      tone: 'danger',
      input: { label: 'Lý do (khách sẽ thấy trong thông báo)', maxLength: 300, required: true },
    });
    if (reason) mut.mutate(async () => (await voidExternalClaim(c.id, reason, reopen), reopen ? 'Đã huỷ và mở lại mã.' : 'Đã huỷ yêu cầu.'));
  };
  const reverse = async () => {
    const reason = await ask({
      title: 'Đảo điểm đã cộng',
      message: `Thu hồi Điểm Xanh đã cộng cho mã ${c.maskedCode}. Số điểm thực thu hồi là nhỏ nhất của điểm đã cộng, phần còn thu hồi được của lô điểm và số dư hiện tại của khách. Không hoàn tác được.`,
      confirmLabel: 'Đảo điểm',
      tone: 'danger',
      input: { label: 'Lý do', maxLength: 300, required: true },
    });
    if (reason) mut.mutate(async () => `Đã thu hồi ${groupThousands((await reverseExternalClaim(c.id, reason)).reversedPoints)} điểm.`);
  };

  const keep = async () => {
    const note = await ask({
      title: 'Giữ điểm, gỡ cờ',
      message: `Đơn của mã ${c.maskedCode} bị hoàn một phần. Giữ nguyên Điểm Xanh đã cộng và gỡ cờ "Cần xử lý" (không thu hồi một phần). Ghi lại để đối soát.`,
      confirmLabel: 'Giữ điểm',
      input: { label: 'Ghi chú (vì sao giữ điểm)', maxLength: 300, required: true },
    });
    if (note) mut.mutate(async () => (await keepExternalClaimPoints(c.id, note), 'Đã giữ điểm và gỡ cờ.'));
  };

  const anyAction = acts.approve || acts.void || acts.voidAndReopen || acts.reverse || acts.keepPoints;
  return (
    <li data-external-claim={c.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 break-all font-mono text-xs font-medium text-stone-900">{c.maskedCode}</span>
        <span className="flex shrink-0 flex-wrap gap-1">
          <ToneBadge tone="info">{c.channel ? `${CLAIM_SOURCE_LABEL[c.source]} · ${c.channel}` : CLAIM_SOURCE_LABEL[c.source]}</ToneBadge>
          <ToneBadge tone={CLAIM_STATE_TONE[c.state]}>{CLAIM_STATE_LABEL[c.state]}</ToneBadge>
          {creditedOnClosedOrder(c) && <ToneBadge tone="danger">Đã cộng, đơn đã đóng: cần đảo điểm</ToneBadge>}
        </span>
      </div>
      <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-stone-600 sm:grid-cols-2">
        <DlRow label="Khách">{c.userName ?? '—'} · {c.userPhoneMasked ?? 'không có SĐT'}</DlRow>
        <DlRow label="SĐT trên đơn">{c.orderPhoneMasked ?? 'không có hoặc bị che'}</DlRow>
        <DlRow label="Tiền hàng">{c.goodsValue === null ? 'chưa tính được' : formatVnd(c.goodsValue)}</DlRow>
        <DlRow label="Điểm">{c.points > 0 ? `${groupThousands(c.points)} điểm` : 'chưa tính được'}</DlRow>
        <DlRow label="Trạng thái đơn">{ORDER_STATUS_LABEL[c.orderStatus] ?? c.orderStatus}</DlRow>
        <DlRow label="Gửi lúc">{formatDateTime(c.createdAt)}</DlRow>
        {c.kind === 'PHONE' && c.userId && (
          <div className="sm:col-span-2" data-member-info>
            <dt className="inline">Người nhận: </dt>
            <dd className="inline">
              SĐT xác minh {row.memberPhoneVerifiedAt ? `lúc ${formatDateTime(row.memberPhoneVerifiedAt)}` : 'chưa từng'} · tài khoản tạo{' '}
              {row.memberCreatedAt ? formatDate(row.memberCreatedAt) : '—'} · {row.memberDeliveredAppOrders ?? 0} đơn app đã giao
              {row.memberPhoneStale && (
                <span className="ml-1.5 align-middle">
                  <ToneBadge tone="warning">{PHONE_STALE_LABEL}</ToneBadge>
                </span>
              )}
            </dd>
          </div>
        )}
        {c.reviewReason && (
          <DlRow label={c.state === 'CREDITED' ? 'Cờ cần xử lý' : 'Lý do cần duyệt'} className="sm:col-span-2">
            <span className="font-medium text-warning-fg">{c.reviewReason}</span>
          </DlRow>
        )}
        {c.voidReason && (
          <DlRow label="Lý do huỷ" className="sm:col-span-2">
            <span className="font-medium text-danger-fg">{c.voidReason}</span>
          </DlRow>
        )}
      </dl>
      {open && (
        <div data-claim-detail className="mt-2 rounded-control bg-stone-100 p-2 text-xs text-stone-700">
          {detail.isLoading && <p>Đang tải…</p>}
          {detail.isError && <LoadError onRetry={() => void detail.refetch()} retrying={detail.isFetching}>Không tải được chi tiết.</LoadError>}
          <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
            <DlRow label="Mã yêu cầu"><span className="font-mono">{row.id}</span></DlRow>
            <DlRow label="Đơn Pancake"><span className="font-mono">#{row.pancakeOrderId}</span></DlRow>
            <DlRow label="Giao lúc">{row.deliveredAt ? formatDateTime(row.deliveredAt) : '—'}</DlRow>
            <DlRow label="Cộng lúc">{row.creditedAt ? formatDateTime(row.creditedAt) : '—'}</DlRow>
            <DlRow label="Người xử lý">{row.decidedById ?? '—'}</DlRow>
          </dl>
          {detail.data && (
            <div className="mt-1.5" data-claim-events>
              <div className="font-medium">Lịch sử thao tác</div>
              {detail.data.events.length === 0 && <div className="text-stone-500">Chưa có thao tác nào.</div>}
              <ol className="mt-0.5 space-y-0.5">
                {detail.data.events.map((e) => (
                  <li key={e.id}>
                    {formatDateTime(e.createdAt)} · {EVENT_ACTION_LABEL[e.action] ?? e.action}
                    {e.fromState && e.toState && e.fromState !== e.toState ? ` (${CLAIM_STATE_LABEL[e.fromState as ExternalClaimState] ?? e.fromState} sang ${CLAIM_STATE_LABEL[e.toState as ExternalClaimState] ?? e.toState})` : ''}
                    {' · '}{e.actorId ? `người xử lý ${e.actorId}` : 'hệ thống'}
                    {e.orderStatus ? ` · đơn: ${ORDER_STATUS_LABEL[e.orderStatus] ?? e.orderStatus}` : ''}
                    {e.note ? ` · ${e.note}` : ''}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
      {done && <p role="status" className="mt-2 text-xs text-success-fg">{done}</p>}
      {err && <p role="alert" className="mt-2 text-xs text-danger-fg">{err}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className={BTN_XS_SECONDARY}>
          {open ? 'Ẩn chi tiết' : 'Chi tiết'}
        </button>
        {anyAction && (
          <>
            {acts.approve && (
              <button
                type="button"
                disabled={mut.isPending || blockedApprove}
                title={blockedApprove ? 'Bạn đã gắn đơn hoặc đưa yêu cầu này vào chờ duyệt nên không tự duyệt được.' : undefined}
                onClick={() => void approve()}
                className={BTN_XS_PRIMARY}
              >
                Duyệt
              </button>
            )}
            {acts.void && <button type="button" disabled={mut.isPending} onClick={() => void voidIt(false)} className={BTN_XS_DANGER}>Huỷ</button>}
            {acts.voidAndReopen && <button type="button" disabled={mut.isPending} onClick={() => void voidIt(true)} className={BTN_XS_DANGER}>Huỷ và mở lại mã</button>}
            {acts.keepPoints && <button type="button" disabled={mut.isPending} onClick={() => void keep()} className={BTN_XS_SECONDARY}>Giữ điểm, gỡ cờ</button>}
            {acts.reverse && <button type="button" disabled={mut.isPending} onClick={() => void reverse()} className={BTN_XS_DANGER}>Đảo điểm</button>}
          </>
        )}
      </div>
      {dialog}
    </li>
  );
}

function AttemptsSection({ who }: { who: Who }) {
  const attempts = useInfiniteQuery({
    queryKey: ['admin-external-claim-attempts'],
    queryFn: ({ pageParam }) => listExternalClaimAttempts(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageParam(last.meta),
  });
  const rows = attempts.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <section aria-label="Lần gửi mã chưa ghép được" className="space-y-2">
      <h3 className="text-sm font-semibold text-stone-900">Lần gửi mã chưa ghép được</h3>
      <p className="text-xs text-stone-500">
        Khách gửi mã mà hệ thống chưa tìm thấy đơn sau 3 ngày, hoặc đơn đã thấy nhưng chưa biết nguồn. Gắn đúng đơn Pancake (xem ở mục Đơn ngoài app) hoặc từ chối.
      </p>
      {attempts.isError && <LoadError onRetry={() => void attempts.refetch()} retrying={attempts.isFetching}>Không tải được các lần gửi mã.</LoadError>}
      {attempts.isSuccess && rows.length === 0 && <p className="text-sm text-stone-500">Không có lần gửi mã nào cần xử lý.</p>}
      <ul className="space-y-2">
        {rows.map((a) => (
          <AttemptRow key={a.id} attempt={a} who={who} />
        ))}
      </ul>
      {attempts.hasNextPage && (
        <div className="text-center">
          <button type="button" onClick={() => void attempts.fetchNextPage()} disabled={attempts.isFetchingNextPage} className={BTN_SECONDARY}>
            {attempts.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
          </button>
        </div>
      )}
    </section>
  );
}

function AttemptRow({ attempt: a, who }: { attempt: AdminExternalAttemptRow; who: Who }) {
  const qc = useQueryClient();
  const { ask, dialog } = useConfirm();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const own = !!who.meId && a.userId === who.meId;
  const canAct = (who.isAdmin || who.canAct) && !own;
  // Đã thấy đơn mà vẫn nằm đây nghĩa là nguồn đơn chưa xác định: chỉ ADMIN gắn được.
  const canAttach = canAct && (who.isAdmin || a.externalOrderId === null);
  const mut = useMutation({
    mutationFn: (run: () => Promise<string | null>) => run(),
    onSuccess: (msg) => {
      setErr(null);
      setDone(msg);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['admin-external-claim-attempts'] });
      void qc.invalidateQueries({ queryKey: ['admin-external-claims'] });
      void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
    },
    onError: (e) => setErr(adminClaimErrorText(e)),
  });
  const attach = async () => {
    const id = await ask({
      title: 'Gắn lần gửi mã vào đơn',
      message: attachDialogMessage(a.maskedCode, who.isAdmin),
      confirmLabel: 'Tiếp tục',
      input: { label: 'Mã đơn Pancake', maxLength: 100, required: true },
    });
    if (!id) return;
    const note = await ask({
      title: 'Ghi chú khi gắn đơn',
      message: `Gắn mã ${a.maskedCode} vào đơn Pancake #${id}. Ghi chú bắt buộc nếu mã không khớp đơn hoặc nguồn đơn chưa xác định; nếu mã khớp thì có thể để trống.`,
      confirmLabel: 'Gắn đơn',
      input: { label: 'Ghi chú (lý do gắn)', maxLength: 300 },
    });
    if (note === null) return;
    mut.mutate(async () => {
      const r = await attachExternalClaimAttempt(a.id, id, note || undefined);
      return r.state === 'REVIEW' ? 'Đã gắn đơn, yêu cầu đang chờ người khác duyệt.' : 'Đã gắn đơn, điểm đang chờ cộng.';
    });
  };
  const reject = async () => {
    const note = await ask({
      title: 'Từ chối lần gửi mã',
      message: `Đóng lần gửi mã ${a.maskedCode}: khách không được tích điểm cho mã này.`,
      confirmLabel: 'Từ chối',
      tone: 'danger',
      input: { label: 'Ghi chú (tuỳ chọn)', maxLength: 300 },
    });
    if (note !== null) mut.mutate(async () => (await rejectExternalClaimAttempt(a.id, note || undefined), 'Đã từ chối lần gửi mã.'));
  };
  return (
    <li data-external-attempt={a.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-medium text-stone-900">{a.maskedCode}</span>
        <ToneBadge tone="warning">{a.externalOrderId ? 'Thấy đơn, chưa rõ nguồn' : 'Chưa thấy đơn'}</ToneBadge>
      </div>
      <div className="mt-1 text-xs text-stone-600">
        Khách: {a.userName ?? '—'} · {a.userPhoneMasked ?? 'không có SĐT'} · gửi lúc {formatDateTime(a.createdAt)}
      </div>
      {a.note && <div className="mt-0.5 text-xs text-stone-600">Ghi chú: {a.note}</div>}
      {!!a.otherSubmittersCount && a.otherSubmitters && (
        <div data-other-submitters className="mt-1 text-xs text-warning-fg">
          <div className="font-medium">{a.otherSubmittersCount} người khác cùng gửi mã này</div>
          <ul className="mt-0.5 space-y-0.5 text-stone-600">
            {a.otherSubmitters.map((o) => (
              <li key={o.userId}>
                {o.userName ?? '—'} · {o.userPhoneMasked ?? 'không có SĐT'} · gửi lúc {formatDateTime(o.createdAt)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {done && <p role="status" className="mt-1 text-xs text-success-fg">{done}</p>}
      {err && <p role="alert" className="mt-1 text-xs text-danger-fg">{err}</p>}
      {own && <p className="mt-1 text-xs text-stone-500">Đây là lần gửi mã của chính bạn, bạn không tự xử lý được.</p>}
      {canAct && (
        <div className="mt-2 flex flex-wrap gap-2">
          {canAttach ? (
            <button type="button" disabled={mut.isPending} onClick={() => void attach()} className={BTN_XS_PRIMARY}>Gắn đơn</button>
          ) : (
            <span className="self-center text-xs text-stone-500">Nguồn đơn chưa xác định: chỉ ADMIN gắn được.</span>
          )}
          <button type="button" disabled={mut.isPending} onClick={() => void reject()} className={BTN_XS_DANGER}>Từ chối</button>
        </div>
      )}
      {dialog}
    </li>
  );
}
