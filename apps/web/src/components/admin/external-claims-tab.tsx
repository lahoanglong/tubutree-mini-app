'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveExternalClaim,
  attachExternalClaimAttempt,
  getExternalClaim,
  listExternalClaimAttempts,
  listExternalClaims,
  nextPageParam,
  rejectExternalClaimAttempt,
  reverseExternalClaim,
  voidExternalClaim,
  type AdminExternalAttemptRow,
  type AdminExternalClaimRow,
  type ExternalClaimState,
} from '@/lib/admin-client';
import {
  CLAIM_SOURCE_LABEL,
  CLAIM_STATE_LABEL,
  CLAIM_STATE_ORDER,
  CLAIM_STATE_TONE,
  claimActions,
  groupThousands,
} from '@/lib/external-claims';
import { formatDateTime } from '@/lib/format-date';
import { formatVnd } from '@/lib/shop-client';
import { useConfirm } from './confirm-dialog';
import { useDebounced } from './search-picker';
import { BTN_SECONDARY, BTN_XS_DANGER, BTN_XS_PRIMARY, BTN_XS_SECONDARY, FIELD_XS, Notice, ToneBadge, chipClass } from './ui';

interface Who {
  isAdmin: boolean;
  /** Nhóm CSKH (hoặc ADMIN): duyệt, huỷ, xử lý lần gửi mã. KE_TOAN không có quyền này. */
  canAct: boolean;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Thao tác thất bại.');

/**
 * Điểm Xanh cho đơn sàn khách tự nhập mã vận đơn. CSKH duyệt claim cần kiểm, huỷ (có lý do, có thể mở lại mã) và xử lý lần gửi
 * mã chưa ghép được; chỉ ADMIN đảo điểm đã cộng. KE_TOAN chỉ xem. SĐT luôn che.
 */
export function ExternalClaimsTab({ isAdmin, canAct }: Who) {
  const [state, setState] = useState<ExternalClaimState | ''>('REVIEW');
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), 300);
  const claims = useInfiniteQuery({
    queryKey: ['admin-external-claims', state, q],
    queryFn: ({ pageParam }) => listExternalClaims({ state: state || undefined, q: q || undefined }, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageParam(last.meta),
  });
  const rows = claims.data?.pages.flatMap((p) => p.data) ?? [];
  const total = claims.data?.pages[0]?.meta.total;
  const who = { isAdmin, canAct };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">Tích điểm đơn sàn</h2>
        {total !== undefined && <span className="text-xs text-stone-500">{total} yêu cầu</span>}
      </div>
      <Notice>
        Khách nhập mã vận đơn đơn sàn trong Mini App để tích Điểm Xanh. Điểm chỉ được cộng khi đơn giao thành công và qua thời gian đối soát.
        {!canAct && ' Bạn chỉ có quyền xem.'}
      </Notice>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Lọc theo trạng thái">
          {[...CLAIM_STATE_ORDER, ''].map((s) => (
            <button key={s || 'all'} type="button" role="tab" aria-selected={state === s} onClick={() => setState(s as ExternalClaimState | '')} className={chipClass(state === s)}>
              {s ? CLAIM_STATE_LABEL[s as ExternalClaimState] : 'Tất cả'}
            </button>
          ))}
        </div>
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
      {claims.isError && <p className="text-sm text-danger-fg">Không tải được danh sách yêu cầu.</p>}
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
      <AttemptsSection canAct={canAct || isAdmin} />
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
  const acts = claimActions(c.state, who);

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
      setErr(errorText(e));
      refresh();
    },
  });

  const approve = async () => {
    const ok = await confirm({
      title: 'Duyệt yêu cầu tích điểm',
      message: `Duyệt mã ${c.maskedCode}? Điểm được tính lại theo tiền hàng mới nhất của đơn và sẽ cộng cho khách sau khi đơn giao đủ thời gian đối soát.`,
      confirmLabel: 'Duyệt',
    });
    if (ok) mut.mutate(async () => (await approveExternalClaim(c.id), 'Đã duyệt, điểm đang chờ cộng.'));
  };
  const voidIt = async (reopen: boolean) => {
    const reason = await ask({
      title: reopen ? 'Huỷ và mở lại mã' : 'Huỷ yêu cầu tích điểm',
      message: reopen
        ? `Huỷ yêu cầu ${c.maskedCode} và mở lại mã: khách (hoặc người khác) có thể nhập lại mã này. Khách nhận thông báo điểm không được cộng.`
        : `Huỷ yêu cầu ${c.maskedCode}: điểm chờ không được cộng và mã này bị chặn nhập lại. Khách nhận thông báo điểm không được cộng.`,
      confirmLabel: reopen ? 'Huỷ và mở lại mã' : 'Huỷ yêu cầu',
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

  const anyAction = acts.approve || acts.void || acts.voidAndReopen || acts.reverse;
  return (
    <li data-external-claim={c.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 break-all font-mono text-xs font-medium text-stone-900">{c.maskedCode}</span>
        <span className="flex shrink-0 flex-wrap gap-1">
          <ToneBadge tone="info">{c.channel ? `${CLAIM_SOURCE_LABEL[c.source]} · ${c.channel}` : CLAIM_SOURCE_LABEL[c.source]}</ToneBadge>
          <ToneBadge tone={CLAIM_STATE_TONE[c.state]}>{CLAIM_STATE_LABEL[c.state]}</ToneBadge>
        </span>
      </div>
      <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-stone-600 sm:grid-cols-2">
        <div>Khách: {c.userName ?? '—'} · {c.userPhoneMasked ?? 'không có SĐT'}</div>
        <div>SĐT trên đơn: {c.orderPhoneMasked ?? 'không có hoặc bị che'}</div>
        <div>Tiền hàng: {c.goodsValue === null ? 'chưa tính được' : formatVnd(c.goodsValue)}</div>
        <div>Điểm: {c.points > 0 ? `${groupThousands(c.points)} điểm` : 'chưa tính được'}</div>
        <div>Trạng thái đơn: {c.orderStatus}</div>
        <div>Gửi lúc: {formatDateTime(c.createdAt)}</div>
        {c.reviewReason && <div className="sm:col-span-2">Lý do cần duyệt: <span className="font-medium text-warning-fg">{c.reviewReason}</span></div>}
        {c.voidReason && <div className="sm:col-span-2">Lý do huỷ: <span className="font-medium text-danger-fg">{c.voidReason}</span></div>}
      </dl>
      {open && (
        <dl data-claim-detail className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 rounded-control bg-stone-100 p-2 text-xs text-stone-700 sm:grid-cols-2">
          {detail.isLoading && <div>Đang tải…</div>}
          {detail.isError && <div className="text-danger-fg">Không tải được chi tiết.</div>}
          <div>Mã yêu cầu: <span className="font-mono">{row.id}</span></div>
          <div>Đơn Pancake: <span className="font-mono">#{row.pancakeOrderId}</span></div>
          <div>Giao lúc: {row.deliveredAt ? formatDateTime(row.deliveredAt) : '—'}</div>
          <div>Cộng lúc: {row.creditedAt ? formatDateTime(row.creditedAt) : '—'}</div>
          <div>Người xử lý: {row.decidedById ?? '—'}</div>
        </dl>
      )}
      {done && <p role="status" className="mt-2 text-xs text-success-fg">{done}</p>}
      {err && <p role="alert" className="mt-2 text-xs text-danger-fg">{err}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className={BTN_XS_SECONDARY}>
          {open ? 'Ẩn chi tiết' : 'Chi tiết'}
        </button>
        {anyAction && (
          <>
            {acts.approve && <button type="button" disabled={mut.isPending} onClick={() => void approve()} className={BTN_XS_PRIMARY}>Duyệt</button>}
            {acts.void && <button type="button" disabled={mut.isPending} onClick={() => void voidIt(false)} className={BTN_XS_DANGER}>Huỷ</button>}
            {acts.voidAndReopen && <button type="button" disabled={mut.isPending} onClick={() => void voidIt(true)} className={BTN_XS_DANGER}>Huỷ và mở lại mã</button>}
            {acts.reverse && <button type="button" disabled={mut.isPending} onClick={() => void reverse()} className={BTN_XS_DANGER}>Đảo điểm</button>}
          </>
        )}
      </div>
      {dialog}
    </li>
  );
}

function AttemptsSection({ canAct }: { canAct: boolean }) {
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
      {attempts.isError && <p className="text-sm text-danger-fg">Không tải được các lần gửi mã.</p>}
      {attempts.isSuccess && rows.length === 0 && <p className="text-sm text-stone-500">Không có lần gửi mã nào cần xử lý.</p>}
      <ul className="space-y-2">
        {rows.map((a) => (
          <AttemptRow key={a.id} attempt={a} canAct={canAct} />
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

function AttemptRow({ attempt: a, canAct }: { attempt: AdminExternalAttemptRow; canAct: boolean }) {
  const qc = useQueryClient();
  const { ask, dialog } = useConfirm();
  const [err, setErr] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => setErr(null),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['admin-external-claim-attempts'] });
      void qc.invalidateQueries({ queryKey: ['admin-external-claims'] });
      void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
    },
    onError: (e) => setErr(errorText(e)),
  });
  const attach = async () => {
    const id = await ask({
      title: 'Gắn lần gửi mã vào đơn',
      message: `Gắn mã ${a.maskedCode} của khách vào một đơn Pancake. Nhân viên đã xác minh nên claim vào thẳng trạng thái chờ cộng điểm, bỏ qua trần ngày, trần tháng và tuổi đơn.`,
      confirmLabel: 'Gắn đơn',
      input: { label: 'Mã đơn Pancake', maxLength: 100, required: true },
    });
    if (id) mut.mutate(() => attachExternalClaimAttempt(a.id, id));
  };
  const reject = async () => {
    const note = await ask({
      title: 'Từ chối lần gửi mã',
      message: `Đóng lần gửi mã ${a.maskedCode}: khách không được tích điểm cho mã này.`,
      confirmLabel: 'Từ chối',
      tone: 'danger',
      input: { label: 'Ghi chú (tuỳ chọn)', maxLength: 300 },
    });
    if (note !== null) mut.mutate(() => rejectExternalClaimAttempt(a.id, note || undefined));
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
      {err && <p role="alert" className="mt-1 text-xs text-danger-fg">{err}</p>}
      {canAct && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={mut.isPending} onClick={() => void attach()} className={BTN_XS_PRIMARY}>Gắn đơn</button>
          <button type="button" disabled={mut.isPending} onClick={() => void reject()} className={BTN_XS_DANGER}>Từ chối</button>
        </div>
      )}
      {dialog}
    </li>
  );
}
