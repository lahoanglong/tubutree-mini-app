'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  STOREFRONT_STATUS_FILTERS,
  STOREFRONT_TYPE_LABELS,
  approveStorefront,
  getAdminStorefront,
  listAdminStorefronts,
  markStorefrontContentSeen,
  reinstateStorefront,
  takeDownStorefront,
  type AdminStorefrontRow,
  type StorefrontStatusFilter,
  type StorefrontTypeFilter,
} from '@/lib/admin-storefronts-client';
import { getOpsInbox, invalidateInbox, mergeQueuePages, nextPageParam } from '@/lib/admin-client';
import { ApiError } from '@/lib/client-api';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { useConfirm } from './confirm-dialog';
import { SideDrawer } from './side-drawer';
import { USER_ROLE_LABELS } from './users-list';
import { BTN_DANGER_OUTLINE, BTN_PRIMARY, BTN_SECONDARY, BTN_XS_SECONDARY, FIELD_CLASS, Notice, TOUCH_H, ToneBadge, chipClass, LoadError } from './ui';

const REASON_MAX = 300;

const CONTENT_CHANGED_TEXT = (at: string) => `Chủ đã đổi tên, lời giới thiệu hoặc ảnh sau khi duyệt (${formatDateTime(at)}). Xem lại rồi bấm "Đã xem".`;

const CHANGED_AGAIN_TEXT = (at: string) => `Chủ vừa đổi thêm lúc ${formatDateTime(at)}. Xem lại rồi bấm "Đã xem".`;

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Không thực hiện được, thử lại sau.');

function StatusBadges({ row }: { row: AdminStorefrontRow }) {
  return (
    <>
      {row.isSample && <ToneBadge tone="warning">Mẫu</ToneBadge>}
      {row.takenDownAt ? (
        <ToneBadge tone="danger">Đã gỡ đăng</ToneBadge>
      ) : row.isPublished ? (
        row.publicVisible ? <ToneBadge tone="success">Đang hiện với khách</ToneBadge> : <ToneBadge tone="warning">Đã đăng nhưng đang ẩn</ToneBadge>
      ) : (
        <ToneBadge tone="neutral">Nháp</ToneBadge>
      )}
      {row.approved ? (
        <ToneBadge tone="info">{row.type === 'CTV' && !row.isPartner ? 'Đã duyệt' : 'Đối tác / nhãn hàng'}</ToneBadge>
      ) : (
        <ToneBadge tone="neutral">Chưa duyệt</ToneBadge>
      )}
    </>
  );
}

/** Chủ đổi nội dung sau khi duyệt và chưa ai xem lại. Dấu còn sót trên gian hàng đã bỏ duyệt thì không tính. */
const changedAfterApproval = (row: AdminStorefrontRow) => !!row.contentChangedAt && !!row.approvedAt;

/**
 * "Đã xem" chỉ xoá dấu đến mốc admin đã thấy; chủ đổi thêm sau đó thì máy chủ giữ dấu mới. Trả mốc mới đó để màn nói rõ,
 * nếu không dải cảnh báo chỉ đổi giờ và nút trông như không ăn.
 */
function changedAgainAt(result: AdminStorefrontRow, sentAt?: string | null): string | null {
  if (!sentAt || !changedAfterApproval(result)) return null;
  return new Date(result.contentChangedAt!).getTime() > new Date(sentAt).getTime() ? result.contentChangedAt : null;
}

function ownerLine(row: AdminStorefrontRow): string {
  if (!row.owner) return 'Không có chủ';
  return [row.owner.fullName ?? 'Chưa đặt tên', row.owner.phone].filter(Boolean).join(' · ');
}

/**
 * Tab "Gian hàng" (D3-02): kiểm duyệt gian hàng CTV/đối tác/nhãn hàng. Danh sách có lọc trạng thái, loại và tìm theo tên, mã hoặc
 * chủ; bấm "Xem" mở chi tiết với nút duyệt, gỡ đăng kèm lý do (chủ nhận thông báo) và đăng lại.
 */
export function StorefrontsTab({ initialStatus = '' }: { initialStatus?: StorefrontStatusFilter | '' } = {}) {
  const [status, setStatus] = useState<StorefrontStatusFilter | ''>(initialStatus);
  const pendingCount = useQuery({ queryKey: ['admin-ops-inbox'], queryFn: getOpsInbox, refetchInterval: 60_000 }).data?.items.find((i) => i.key === 'storefrontsPending')?.count;
  const [changedOnly, setChangedOnly] = useState(false);
  const [type, setType] = useState<StorefrontTypeFilter | ''>('');
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const qc = useQueryClient();
  const [quickFailure, setQuickFailure] = useState<string | null>(null);
  const quickApprove = useMutation({
    mutationFn: (id: string) => approveStorefront(id, true),
    onSuccess: () => {
      setQuickFailure(null);
      void invalidateInbox(qc);
      return qc.invalidateQueries({ queryKey: ['admin-storefronts'] });
    },
    onError: (e) => setQuickFailure(errorText(e)),
  });

  const [changedAgain, setChangedAgain] = useState<string | null>(null);
  const seen = useMutation({
    mutationFn: (r: AdminStorefrontRow) => markStorefrontContentSeen(r.id, r.contentChangedAt),
    onSuccess: (result, r) => {
      setQuickFailure(null);
      setChangedAgain(changedAgainAt(result, r.contentChangedAt));
      return qc.invalidateQueries({ queryKey: ['admin-storefronts'] });
    },
    onError: (e) => setQuickFailure(errorText(e)),
  });

  const list = useInfiniteQuery({
    queryKey: ['admin-storefronts', status, type, q, changedOnly],
    queryFn: ({ pageParam }) => listAdminStorefronts(pageParam, { status, type, q, changedAfterApproval: changedOnly }),
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageParam(last.meta),
  });
  const view = mergeQueuePages(list.data?.pages, false);
  const changedCount = list.data?.pages[0]?.changedAfterApproval;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">Gian hàng ({list.data ? view.total : 0})</h2>
        <button type="button" onClick={() => void list.refetch()} className={BTN_XS_SECONDARY}>
          Làm mới
        </button>
      </div>

      <div role="group" aria-label="Lọc theo trạng thái" className="mt-3 flex flex-wrap gap-2">
        {STOREFRONT_STATUS_FILTERS.map((f) => (
          <button
            key={f.k || 'all'}
            type="button"
            aria-pressed={!changedOnly && status === f.k}
            onClick={() => {
              setChangedOnly(false);
              setStatus(f.k);
            }}
            className={chipClass(!changedOnly && status === f.k)}
          >
            {f.label}
            {f.k === 'PENDING_APPROVAL' && pendingCount !== undefined ? ` (${pendingCount})` : ''}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={changedOnly}
          onClick={() => {
            setChangedOnly(true);
            setStatus('');
          }}
          className={chipClass(changedOnly)}
        >
          Đổi sau duyệt{changedCount !== undefined ? ` (${changedCount})` : ''}
        </button>
      </div>

      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft);
        }}
      >
        <select aria-label="Loại gian hàng" value={type} onChange={(e) => setType(e.target.value as StorefrontTypeFilter | '')} className={`${FIELD_CLASS} ${TOUCH_H}`}>
          <option value="">Mọi loại</option>
          {(Object.keys(STOREFRONT_TYPE_LABELS) as StorefrontTypeFilter[]).map((t) => (
            <option key={t} value={t}>
              {STOREFRONT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label="Tìm gian hàng"
          placeholder="Tên gian hàng, mã, tên hoặc SĐT chủ"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={`${FIELD_CLASS} ${TOUCH_H} min-w-0 flex-1 sm:max-w-sm`}
        />
        <button type="submit" className={BTN_SECONDARY}>
          Tìm
        </button>
      </form>

      <div className="mt-4 space-y-3">
        {quickFailure && <Notice tone="danger" role="alert">{quickFailure}</Notice>}
        {changedAgain && <Notice role="status">{CHANGED_AGAIN_TEXT(changedAgain)}</Notice>}
        {list.isLoading && <p className="text-sm text-stone-500">Đang tải danh sách...</p>}
        {list.isError && <LoadError onRetry={() => void list.refetch()} retrying={list.isFetching}>Không tải được danh sách gian hàng.</LoadError>}
        {list.data && view.items.length === 0 && (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">Không có gian hàng nào khớp bộ lọc.</p>
        )}
        {view.items.map((row) => (
          <article key={row.id} aria-label={row.title} className="rounded-card border border-stone-200 bg-stone-0 p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="break-words text-sm font-semibold text-stone-900">{row.title}</h3>
                <p className="mt-0.5 break-all text-xs text-stone-500">
                  {STOREFRONT_TYPE_LABELS[row.type]} · {row.itemCount} sản phẩm
                </p>
                <p className="mt-0.5 text-xs text-stone-600">Chủ: {ownerLine(row)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!row.approved && !row.takenDownAt && row.type === 'CTV' && !row.isPartner && (
                  <button type="button" onClick={() => quickApprove.mutate(row.id)} disabled={quickApprove.isPending} className={BTN_PRIMARY}>
                    Duyệt
                  </button>
                )}
                <button type="button" onClick={() => setOpenId(row.id)} className={BTN_SECONDARY}>
                  Xem
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadges row={row} />
            </div>
            {(row.takenDownReason || row.hiddenReason) && (
              <p className="mt-2 break-words text-xs text-stone-600">{row.takenDownAt ? `Lý do gỡ: ${row.takenDownReason ?? '—'}` : row.hiddenReason}</p>
            )}
            {changedAfterApproval(row) && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-card bg-warning-bg px-2 py-1.5">
                <p className="min-w-0 break-words text-xs text-warning-fg">{CONTENT_CHANGED_TEXT(row.contentChangedAt!)}</p>
                <button type="button" onClick={() => seen.mutate(row)} disabled={seen.isPending} className={BTN_XS_SECONDARY}>
                  Đã xem
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {view.hasMore && (
        <div className="mt-3 text-center">
          <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className={BTN_SECONDARY}>
            {list.isFetchingNextPage ? 'Đang tải…' : `Tải thêm (${view.label})`}
          </button>
        </div>
      )}

      {openId && <StorefrontDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">{title}</h3>
      <div className="mt-2 text-sm text-stone-800">{children}</div>
    </section>
  );
}

function StorefrontDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { confirm, ask, dialog } = useConfirm();
  const [failure, setFailure] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ['admin-storefront', id], queryFn: () => getAdminStorefront(id) });
  const sf = detail.data;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-storefronts'] });
    void invalidateInbox(qc);
    return qc.invalidateQueries({ queryKey: ['admin-storefront', id] });
  };
  const onError = (e: unknown) => setFailure(errorText(e));
  const takeDown = useMutation({ mutationFn: (reason: string) => takeDownStorefront(id, reason), onSuccess: refresh, onError });
  const reinstate = useMutation({ mutationFn: () => reinstateStorefront(id), onSuccess: refresh, onError });
  const approve = useMutation({ mutationFn: (approved: boolean) => approveStorefront(id, approved), onSuccess: refresh, onError });
  const [changedAgain, setChangedAgain] = useState<string | null>(null);
  const seen = useMutation({
    mutationFn: (sentAt: string | null | undefined) => markStorefrontContentSeen(id, sentAt),
    onSuccess: (result, sentAt) => {
      setChangedAgain(changedAgainAt(result, sentAt));
      return refresh();
    },
    onError,
  });
  const busy = takeDown.isPending || reinstate.isPending || approve.isPending || seen.isPending;

  const onTakeDown = async () => {
    if (!sf) return;
    const reason = await ask({
      title: 'Gỡ đăng gian hàng',
      message: `"${sf.title}" sẽ biến mất khỏi trang công khai và chủ không tự đăng lại được. Chủ nhận thông báo kèm lý do bạn nhập.`,
      confirmLabel: 'Gỡ đăng',
      tone: 'danger',
      input: { label: 'Lý do (chủ gian hàng đọc được)', placeholder: 'Ví dụ: dùng ảnh của nhãn khác', maxLength: REASON_MAX, required: true },
    });
    if (reason) {
      setFailure(null);
      takeDown.mutate(reason);
    }
  };
  const onUnapprove = async () => {
    if (!sf) return;
    const ok = await confirm({
      title: 'Bỏ duyệt gian hàng',
      message: `"${sf.title}" mất dấu tick xanh và nhãn "CTV tuyển chọn". Nếu hệ thống đang bắt duyệt trước khi đăng, gian hàng sẽ ẩn khỏi trang công khai.`,
      confirmLabel: 'Bỏ duyệt',
      tone: 'danger',
    });
    if (ok) {
      setFailure(null);
      approve.mutate(false);
    }
  };
  const onReinstate = async () => {
    if (!sf) return;
    const ok = await confirm({
      title: 'Đăng lại gian hàng',
      message: `"${sf.title}" được hiện lại với khách (nếu trước đó đang đăng) và chủ nhận thông báo.`,
      confirmLabel: 'Đăng lại',
    });
    if (ok) {
      setFailure(null);
      reinstate.mutate();
    }
  };

  const canToggleApproval = !!sf && sf.type === 'CTV' && !sf.isPartner;

  return (
    <SideDrawer title={sf?.title ?? 'Gian hàng'} onClose={onClose}>
      {detail.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {detail.isError && <LoadError onRetry={() => void detail.refetch()} retrying={detail.isFetching}>Không tải được chi tiết gian hàng.</LoadError>}
      {sf && (
        <div className="space-y-3">
          {failure && <Notice tone="danger" role="alert">{failure}</Notice>}
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadges row={sf} />
          </div>
          {sf.takenDownAt ? (
            <Notice tone="danger">
              Đã gỡ lúc {formatDateTime(sf.takenDownAt)}. Lý do: {sf.takenDownReason ?? '—'}
            </Notice>
          ) : (
            sf.hiddenReason && <Notice tone="warning">{sf.hiddenReason}</Notice>
          )}
          {changedAgain && <Notice role="status">{CHANGED_AGAIN_TEXT(changedAgain)}</Notice>}
          {changedAfterApproval(sf) && (
            <Notice tone="warning">
              {CONTENT_CHANGED_TEXT(sf.contentChangedAt!)}{' '}
              <button type="button" onClick={() => seen.mutate(sf.contentChangedAt)} disabled={busy} className={BTN_XS_SECONDARY}>
                Đã xem
              </button>
            </Notice>
          )}

          <div className="flex flex-wrap gap-2">
            {sf.takenDownAt ? (
              <button type="button" onClick={() => void onReinstate()} disabled={busy} className={BTN_PRIMARY}>
                Đăng lại
              </button>
            ) : (
              <button type="button" onClick={() => void onTakeDown()} disabled={busy} className={BTN_DANGER_OUTLINE}>
                Gỡ đăng
              </button>
            )}
            {canToggleApproval &&
              (sf.approved ? (
                <button type="button" onClick={() => void onUnapprove()} disabled={busy} className={BTN_SECONDARY}>
                  Bỏ duyệt
                </button>
              ) : (
                <button type="button" onClick={() => approve.mutate(true)} disabled={busy} className={BTN_PRIMARY}>
                  Duyệt gian hàng
                </button>
              ))}
            {sf.publicVisible && (
              <Link href={`/s/${sf.slug}`} target="_blank" className={`${BTN_SECONDARY} inline-flex items-center`}>
                Xem trang công khai
              </Link>
            )}
          </div>

          <Section title="Hồ sơ">
            <dl className="space-y-1 text-xs">
              <div><dt className="inline font-medium">Mã: </dt><dd className="inline break-all">/s/{sf.slug}</dd></div>
              <div><dt className="inline font-medium">Loại: </dt><dd className="inline">{STOREFRONT_TYPE_LABELS[sf.type]}{sf.isPartner ? ' (đối tác)' : ''}</dd></div>
              <div><dt className="inline font-medium">Chủ: </dt><dd className="inline">{ownerLine(sf)}{sf.owner ? ` · ${USER_ROLE_LABELS[sf.owner.role] ?? sf.owner.role}` : ''}{sf.owner?.isBlocked ? ' · đang bị khoá' : ''}</dd></div>
              <div><dt className="inline font-medium">Tạo: </dt><dd className="inline">{formatDate(sf.createdAt)}</dd></div>
              {sf.approvedAt && <div><dt className="inline font-medium">Duyệt: </dt><dd className="inline">{formatDateTime(sf.approvedAt)}</dd></div>}
            </dl>
            {sf.headerNote && <p className="mt-2 whitespace-pre-line break-words text-sm">{sf.headerNote}</p>}
            <div className="mt-2 flex items-center gap-3">
              {sf.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sf.avatarUrl} alt={`Ảnh đại diện của ${sf.title}`} className="h-16 w-16 rounded-card border border-stone-200 object-cover" />
              )}
              {sf.coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sf.coverUrl} alt={`Ảnh bìa của ${sf.title}`} className="h-16 min-w-0 flex-1 rounded-card border border-stone-200 object-cover" />
              )}
              {!sf.avatarUrl && !sf.coverUrl && <p className="text-xs text-stone-500">Chưa có ảnh đại diện hay ảnh bìa.</p>}
            </div>
          </Section>

          <Section title={`Sản phẩm (${sf.itemCount})`}>
            {sf.collections.length === 0 || sf.itemCount === 0 ? (
              <p className="text-xs text-stone-500">Gian hàng chưa có sản phẩm nào.</p>
            ) : (
              <div className="space-y-2">
                {sf.collections.map((c) => (
                  <div key={c.id}>
                    <p className="text-xs font-semibold text-stone-700">{c.title}</p>
                    <ul className="mt-1 space-y-1">
                      {c.items.map((i) => (
                        <li key={i.id} className="break-words text-xs">
                          {i.productName}
                          {i.isHidden && ' · đang ẩn'}
                          {i.note && <span className="text-stone-500"> · “{i.note}”</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
      {dialog}
    </SideDrawer>
  );
}
