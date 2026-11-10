'use client';

import { createContext, useContext, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { addComment } from '@tubutree/app-core/api/feed';
import { communityViewsFor, reportsTabCount, type CommunityView } from '@tubutree/app-core/community-moderation-views';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  approveCommunityPost,
  hideCommunityPost,
  listCommunityPending,
  listCommunityPublished,
  listCommunityReports,
  listCommunityUnanswered,
  pinCommunityPost,
  removeCommunityComment,
  resolveCommunityReport,
  rejectCommunityPost,
  type CommunityPendingPost,
  type CommunityPostKind,
  type CommunityPublishedPost,
  type CommunityReport,
  type CommunityUnansweredQuestion,
} from '@/lib/community-moderation-client';
import { useOpsInbox } from './use-ops-inbox';
import { coreHttp } from '@/lib/core-http';
import { formatDateTime } from '@/lib/format-date';
import { EventsPanel } from './community-events-panel';
import { useConfirm } from './confirm-dialog';
import { safeEvidenceImage } from './evidence-images';
import { BTN_DANGER_OUTLINE, BTN_PRIMARY, BTN_SECONDARY, INPUT_CLASS, ListSkeleton, LoadError, chipClass, Notice, ToneBadge } from './ui';
import { actionErrorText } from '@/lib/admin-error-text';
import { isStaleWriteRejection } from '@/lib/stale-write-rejection';
import { settleWithin } from '@/lib/settle-within';
import { usePressLock } from '@/lib/use-press-lock';

export type { CommunityView };

const KIND_LABELS: Record<CommunityPostKind, string> = {
  MANUAL: 'Chia sẻ',
  QUESTION: 'Hỏi đáp',
  SHOWCASE: 'Trải nghiệm',
  TIP: 'Mẹo hay',
  HARVEST: 'Thu hoạch',
  SPECIES: 'Sưu tập loài',
  MILESTONE: 'Mốc cộng đồng',
};

const QUERY_KEYS = {
  pending: ['admin-community-pending'],
  reports: ['admin-community-reports'],
  published: ['admin-community-published'],
  unanswered: ['admin-community-unanswered'],
} as const satisfies Record<Exclude<CommunityView, 'events'>, QueryKey>;
const INBOX_KEY: QueryKey = ['admin-ops-inbox'];

/** Bài đã đổi trạng thái do người khác (409, 400) hoặc không còn (404): dòng sẽ biến khỏi danh sách sau khi làm mới, nên lời giải thích đứng ở đầu tab thay vì trên dòng. */
const StaleNoticeContext = createContext<(message: string | null) => void>(() => {});

/** Nút đang chạy báo bận bằng aria-disabled thay `disabled` DOM: Chromium thả focus về body khi nút đang giữ focus bị disabled. */
const BUSY_CLASS = 'aria-disabled:opacity-60';

/**
 * Một việc mỗi lúc trên một dòng (Duyệt/Từ chối cùng một bài, Ẩn/Bỏ qua cùng một báo cáo, Ghim/Ẩn cùng một bài loại trừ nhau).
 * Ref vì `isPending` chỉ đúng sau lần vẽ kế tiếp: hai cú chạm sát nhau trong cùng khung hình vẫn đều thấy nút rảnh.
 */
function useRowLock() {
  const held = useRef(false);
  return useMemo(
    () => ({
      isHeld: () => held.current,
      take: () => {
        if (held.current) return false;
        held.current = true;
        return true;
      },
      release: () => {
        held.current = false;
      },
    }),
    [],
  );
}
type RowLock = ReturnType<typeof useRowLock>;

/**
 * Kiểm duyệt cộng đồng trên web admin cho ADMIN và nhân viên nhóm CSKH (trước đây chỉ ADMIN duyệt được, và chỉ trong mini app):
 * duyệt/từ chối bài chờ duyệt, ẩn/ghim bài đã đăng, và trả lời ngay câu hỏi chờ quá lâu chưa ai trả lời. Tác giả được báo khi
 * bài bị từ chối hoặc ẩn, kèm lý do người kiểm duyệt nhập. Ghim bài và quản lý sự kiện chỉ ADMIN (API từ chối nhân viên), nên
 * nút ghim và mục Sự kiện chỉ hiện khi `isAdmin`.
 */
export function CommunityModerationTab({ initialView = 'pending', isAdmin = false }: { initialView?: CommunityView; isAdmin?: boolean }) {
  const [picked, setView] = useState<CommunityView>(initialView);
  const views = communityViewsFor({ platform: 'web', isAdmin });
  const view = views.some((v) => v.k === picked) ? picked : 'pending';
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const reports = useQuery({ queryKey: QUERY_KEYS.reports, queryFn: listCommunityReports }).data;
  // adminReports chỉ trả tối đa 50 báo cáo; số thật lấy từ hộp việc (cùng số với thẻ ở trang Hôm nay), chưa có thì ghi "50+" khi đủ trần.
  const inbox = useOpsInbox({ retry: false }).data;
  const inboxCount = inbox?.items.find((i) => i.key === 'communityReports')?.count;
  const reportCount = reportsTabCount(inboxCount, reports?.length);
  return (
    <StaleNoticeContext.Provider value={setStaleNotice}>
      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-stone-900">Cộng đồng</h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Mục kiểm duyệt cộng đồng">
          {views.map((v) => (
            <button
              key={v.k}
              type="button"
              className={chipClass(view === v.k)}
              aria-pressed={view === v.k}
              onClick={() => {
                setStaleNotice(null);
                setView(v.k);
              }}
            >
              {v.label}
              {v.k === 'reports' && reportCount !== undefined ? ` (${reportCount})` : ''}
            </button>
          ))}
        </div>
        {staleNotice && (
          <Notice tone="warning" role="alert">
            {staleNotice} Danh sách đã được làm mới.
          </Notice>
        )}
        {view === 'pending' && <PendingList />}
        {view === 'reports' && <ReportsList isAdmin={isAdmin} />}
        {view === 'published' && <PublishedList canPin={isAdmin} />}
        {view === 'unanswered' && <UnansweredList />}
        {view === 'events' && <EventsPanel />}
      </div>
    </StaleNoticeContext.Provider>
  );
}

function PostMeta({ kind, author, category, createdAt }: { kind: CommunityPostKind; author: string | null; category: string | null; createdAt: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-600">
      <ToneBadge tone={kind === 'QUESTION' ? 'info' : 'neutral'}>{KIND_LABELS[kind] ?? kind}</ToneBadge>
      <span className="font-medium text-stone-900">{author ?? 'Bạn Tubu'}</span>
      {category && <span>· {category}</span>}
      <span>· {formatDateTime(createdAt)}</span>
    </div>
  );
}

function Thumbnails({ images }: { images: string[] }) {
  const safe = images.map(safeEvidenceImage).filter((x): x is { src: string; href: string | null } => x !== null);
  if (safe.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {safe.map((img, idx) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={idx}
          src={img.src}
          alt={`Ảnh ${idx + 1} của bài`}
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-20 w-20 rounded-media border border-stone-200 object-cover shadow-card"
        />
      ))}
    </div>
  );
}

/**
 * Thao tác trên một bài: gọi API, làm mới danh sách và số trên "Việc cần xử lý". Khoá của dòng giữ tới khi danh sách làm mới về (tối đa `settleWithin`):
 * nhả sớm thì dòng vừa duyệt còn nút và bấm lại ra lỗi "đã đổi trạng thái". Bị từ chối vì trạng thái đã đổi (400/404/409) thì lời lỗi hiện ngay ở đầu tab
 * (dòng sắp biến khỏi danh sách) rồi tải lại; lỗi khác hiện trên đúng dòng và mã không chờ tải lại, khoá nhả ngay (lần tải lại hỏng sẽ thay danh sách bằng màn lỗi).
 * Quy tắc 400/404/409 chỉ quyết định việc CHỜ tải lại trước khi nhả khoá: trên production MutationCache vẫn làm cũ mọi khoá `admin-*` (kể cả khoá của tab này) sau mỗi lệnh settle, kể cả 5xx.
 * `hasInput`: lệnh nhận chữ do người kiểm duyệt nhập (lý do từ chối/ẩn, nội dung trả lời): 400 là lỗi nhập liệu nên hiện trên đúng dòng, không tải lại;
 * chỉ 404/409 là dữ liệu cũ. `onSent`: chạy ngay khi lệnh thành công, trước và độc lập với lần làm mới danh sách (lần làm mới có thể treo tới hạn 4 giây hoặc hỏng).
 */
function usePostAction<V>(
  fn: (v: V) => Promise<unknown>,
  refreshKeys: QueryKey[],
  failText: string,
  lock: RowLock,
  { hasInput = false, onSent }: { hasInput?: boolean; onSent?: (v: V) => void } = {},
) {
  const qc = useQueryClient();
  const setStaleNotice = useContext(StaleNoticeContext);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: INBOX_KEY });
    return settleWithin(Promise.all(refreshKeys.map((queryKey) => qc.invalidateQueries({ queryKey }))));
  };
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => {
      setErr(null);
      setStaleNotice(null);
    },
    onSuccess: (_data, v) => {
      onSent?.(v);
      return refresh();
    },
    onError: (e) => {
      if (isStaleWriteRejection(e, hasInput)) {
        setStaleNotice(e instanceof Error ? e.message : failText);
        return refresh();
      }
      setErr(e instanceof Error ? actionErrorText(e) : failText);
      return undefined;
    },
    onSettled: lock.release,
  });
  const mutate = (v: V) => {
    if (!lock.take()) return;
    m.mutate(v);
  };
  return { mutate, pending: m.isPending, err };
}

function RowError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mt-2">
      <Notice tone="danger" role="alert">
        {message}
      </Notice>
    </div>
  );
}

function PendingList() {
  const q = useQuery({ queryKey: QUERY_KEYS.pending, queryFn: listCommunityPending });
  return (
    <div className="space-y-2">
      {q.isLoading && <ListSkeleton label="Đang tải danh sách" rows={3} className="h-24" />}
      {q.isError && <LoadError onRetry={() => void q.refetch({ cancelRefetch: false })} retrying={q.isFetching}>Không tải được danh sách bài chờ duyệt.</LoadError>}
      {q.data && (
        <>
          <p className="text-xs text-stone-500">{q.data.length === 0 ? 'Không có bài nào đang chờ duyệt.' : `${q.data.length} bài chờ duyệt · cũ nhất trước`}</p>
          <ul className="space-y-2">
            {q.data.map((p) => (
              <PendingRow key={p.id} post={p} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PendingRow({ post: p }: { post: CommunityPendingPost }) {
  const { ask, dialog } = useConfirm();
  const keys = [QUERY_KEYS.pending];
  const lock = useRowLock();
  const approve = usePostAction(() => approveCommunityPost(p.id), keys, 'Không duyệt được bài.', lock);
  const reject = usePostAction((reason: string) => rejectCommunityPost(p.id, reason || undefined), keys, 'Không từ chối được bài.', lock, { hasInput: true });
  const askReject = async () => {
    if (lock.isHeld()) return;
    const reason = await ask({
      title: 'Từ chối bài này?',
      message: 'Bài bị gỡ và tác giả được báo. Lý do dưới đây hiện cho tác giả; để trống thì dùng lý do mặc định về nội quy cộng đồng.',
      confirmLabel: 'Từ chối',
      tone: 'danger',
      input: { label: 'Lý do (tác giả thấy)', placeholder: 'VD: có link bán hàng ngoài', maxLength: 200 },
    });
    if (reason !== null) reject.mutate(reason);
  };
  const busy = approve.pending || reject.pending;
  return (
    <li data-post={p.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
      {dialog}
      <PostMeta kind={p.kind} author={p.author} category={p.category} createdAt={p.createdAt} />
      {p.title && <div className="mt-1 break-words font-medium text-stone-900">{p.title}</div>}
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-800">{p.body}</p>
      <Thumbnails images={p.images} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-busy={approve.pending || undefined}
          aria-disabled={busy || undefined}
          onClick={() => approve.mutate(undefined)}
          className={`${BTN_PRIMARY} ${BUSY_CLASS}`}
        >
          Duyệt
        </button>
        <button
          type="button"
          aria-busy={reject.pending || undefined}
          aria-disabled={busy || undefined}
          onClick={() => void askReject()}
          className={`${BTN_DANGER_OUTLINE} ${BUSY_CLASS}`}
        >
          Từ chối
        </button>
      </div>
      <RowError message={approve.err ?? reject.err} />
    </li>
  );
}

function ReportsList({ isAdmin }: { isAdmin: boolean }) {
  const q = useQuery({ queryKey: QUERY_KEYS.reports, queryFn: listCommunityReports });
  return (
    <div className="space-y-2">
      {q.isLoading && <ListSkeleton label="Đang tải danh sách" rows={3} className="h-24" />}
      {q.isError && <LoadError onRetry={() => void q.refetch({ cancelRefetch: false })} retrying={q.isFetching}>Không tải được danh sách báo cáo vi phạm.</LoadError>}
      {q.data && (
        <>
          <p className="text-xs text-stone-500">{q.data.length === 0 ? 'Chưa có báo cáo vi phạm nào đang mở.' : `${q.data.length} báo cáo đang mở · cũ nhất trước`}</p>
          <ul className="space-y-2">
            {q.data.map((r) => (
              <ReportRow key={r.id} report={r} canRemoveComment={isAdmin} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ReportRow({ report: r, canRemoveComment }: { report: CommunityReport; canRemoveComment: boolean }) {
  const { ask, dialog } = useConfirm();
  const keys = [QUERY_KEYS.reports, QUERY_KEYS.published];
  const lock = useRowLock();
  const resolve = usePostAction(() => resolveCommunityReport(r.id), keys, 'Không đóng được báo cáo.', lock);
  const hide = usePostAction(
    async (reason: string) => {
      if (r.targetType === 'COMMENT') await removeCommunityComment(r.targetId);
      else await hideCommunityPost(r.targetId, reason || undefined);
      await resolveCommunityReport(r.id);
    },
    keys,
    'Không ẩn được nội dung.',
    lock,
    { hasInput: true },
  );
  const askHide = async () => {
    if (lock.isHeld()) return;
    const isComment = r.targetType === 'COMMENT';
    const reason = await ask({
      title: isComment ? 'Gỡ bình luận này?' : 'Ẩn bài này khỏi cộng đồng?',
      message: isComment
        ? 'Bình luận bị gỡ và báo cáo được đóng.'
        : 'Bài biến khỏi bảng tin, báo cáo được đóng và tác giả được báo kèm lý do dưới đây; để trống thì dùng lý do mặc định về nội quy cộng đồng.',
      confirmLabel: isComment ? 'Gỡ bình luận' : 'Ẩn bài',
      tone: 'danger',
      ...(isComment ? {} : { input: { label: 'Lý do (tác giả thấy)', placeholder: 'VD: quảng cáo', maxLength: 200 } }),
    });
    if (reason !== null) hide.mutate(reason);
  };
  const busy = resolve.pending || hide.pending;
  const canHide = r.target && !r.target.alreadyHandled && (r.targetType !== 'COMMENT' || canRemoveComment);
  return (
    <li data-report={r.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
      {dialog}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-600">
        <ToneBadge tone="warning">{r.targetType === 'COMMENT' ? 'Bình luận' : 'Bài viết'}</ToneBadge>
        {r.target && <span className="font-medium text-stone-900">{r.target.author}</span>}
        <span>· {formatDateTime(r.createdAt)}</span>
        {r.target?.alreadyHandled && <ToneBadge tone="neutral">Đã gỡ</ToneBadge>}
      </div>
      {r.target?.title && <div className="mt-1 break-words font-medium text-stone-900">{r.target.title}</div>}
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-800">{r.target ? r.target.excerpt : 'Nội dung đã bị xoá hẳn.'}</p>
      <p className="mt-1 text-xs text-stone-600">Lý do báo cáo: {r.reason}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canHide && (
          <button
            type="button"
            aria-busy={hide.pending || undefined}
            aria-disabled={busy || undefined}
            onClick={() => void askHide()}
            className={`${BTN_DANGER_OUTLINE} ${BUSY_CLASS}`}
          >
            {r.targetType === 'COMMENT' ? 'Gỡ bình luận' : 'Ẩn bài'}
          </button>
        )}
        <button
          type="button"
          aria-busy={resolve.pending || undefined}
          aria-disabled={busy || undefined}
          onClick={() => resolve.mutate(undefined)}
          className={`${BTN_SECONDARY} ${BUSY_CLASS}`}
        >
          Bỏ qua, đóng báo cáo
        </button>
      </div>
      <RowError message={resolve.err ?? hide.err} />
    </li>
  );
}

function PublishedList({ canPin }: { canPin: boolean }) {
  const q = useInfiniteQuery({
    queryKey: QUERY_KEYS.published,
    queryFn: ({ pageParam }) => listCommunityPublished(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((pg) => pg.items) ?? [];
  const more = usePressLock(() => (q.isFetchingNextPage ? undefined : q.fetchNextPage()));
  return (
    <div className="space-y-2">
      {q.isLoading && <ListSkeleton label="Đang tải danh sách" rows={3} className="h-24" />}
      {q.isError && <LoadError onRetry={() => void q.refetch({ cancelRefetch: false })} retrying={q.isFetching}>Không tải được danh sách bài đã đăng.</LoadError>}
      {q.data && items.length === 0 && <p className="text-xs text-stone-500">Chưa có bài nào được đăng.</p>}
      <ul className="space-y-2">
        {items.map((p) => (
          <PublishedRow key={p.id} post={p} canPin={canPin} />
        ))}
      </ul>
      {q.hasNextPage && (
        <button
          type="button"
          aria-busy={more.busy || q.isFetchingNextPage || undefined}
          aria-disabled={more.busy || q.isFetchingNextPage || undefined}
          onClick={more.press}
          className={`${BTN_SECONDARY} ${BUSY_CLASS}`}
        >
          {q.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
        </button>
      )}
    </div>
  );
}

function PublishedRow({ post: p, canPin }: { post: CommunityPublishedPost; canPin: boolean }) {
  const { ask, dialog } = useConfirm();
  const keys = [QUERY_KEYS.published, QUERY_KEYS.unanswered];
  const lock = useRowLock();
  const pin = usePostAction((pinned: boolean) => pinCommunityPost(p.id, pinned), keys, 'Không đổi được trạng thái ghim.', lock);
  const hide = usePostAction((reason: string) => hideCommunityPost(p.id, reason || undefined), keys, 'Không ẩn được bài.', lock, { hasInput: true });
  const askHide = async () => {
    if (lock.isHeld()) return;
    const reason = await ask({
      title: 'Ẩn bài này khỏi cộng đồng?',
      message: 'Bài biến khỏi bảng tin và tác giả được báo kèm lý do dưới đây; để trống thì dùng lý do mặc định về nội quy cộng đồng.',
      confirmLabel: 'Ẩn bài',
      tone: 'danger',
      input: { label: 'Lý do (tác giả thấy)', placeholder: 'VD: quảng cáo', maxLength: 200 },
    });
    if (reason !== null) hide.mutate(reason);
  };
  const busy = pin.pending || hide.pending;
  return (
    <li data-post={p.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
      {dialog}
      <PostMeta kind={p.kind} author={p.author} category={p.category} createdAt={p.createdAt} />
      {p.isPinned && (
        <div className="mt-1">
          <ToneBadge tone="success">Đang ghim</ToneBadge>
        </div>
      )}
      {p.title && <div className="mt-1 break-words font-medium text-stone-900">{p.title}</div>}
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-800">{p.excerpt}</p>
      <div className="mt-1 text-xs text-stone-500">
        {p.likeCount} lượt thích · {p.commentCount} bình luận
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canPin && (
          <button
            type="button"
            aria-busy={pin.pending || undefined}
            aria-disabled={busy || undefined}
            onClick={() => pin.mutate(!p.isPinned)}
            className={`${BTN_SECONDARY} ${BUSY_CLASS}`}
          >
            {p.isPinned ? 'Bỏ ghim' : 'Ghim'}
          </button>
        )}
        <button
          type="button"
          aria-busy={hide.pending || undefined}
          aria-disabled={busy || undefined}
          onClick={() => void askHide()}
          className={`${BTN_DANGER_OUTLINE} ${BUSY_CLASS}`}
        >
          Ẩn
        </button>
      </div>
      <RowError message={pin.err ?? hide.err} />
    </li>
  );
}

function UnansweredList() {
  const q = useQuery({ queryKey: QUERY_KEYS.unanswered, queryFn: listCommunityUnanswered });
  return (
    <div className="space-y-2">
      {q.isLoading && <ListSkeleton label="Đang tải danh sách" rows={3} className="h-24" />}
      {q.isError && <LoadError onRetry={() => void q.refetch({ cancelRefetch: false })} retrying={q.isFetching}>Không tải được danh sách câu hỏi chưa trả lời.</LoadError>}
      {q.data && (
        <>
          <p className="text-xs text-stone-500">
            {q.data.length === 0
              ? 'Không có câu hỏi nào đang chờ trả lời.'
              : `${q.data.length} câu hỏi chờ lâu chưa ai trả lời · cũ nhất trước. Trả lời ngay tại đây hoặc mở bài trên web.`}
          </p>
          <ul className="space-y-2">
            {q.data.map((p) => (
              <UnansweredRow key={p.id} question={p} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const REPLY_MAX = 500;

function UnansweredRow({ question: p }: { question: CommunityUnansweredQuestion }) {
  const [reply, setReply] = useState('');
  const lock = useRowLock();
  // Xoá ô ngay khi gửi xong: còn chữ thì sau khi khoá nhả (≤ 4 giây) bấm lại sẽ ra bình luận công khai thứ hai khi đã quá cửa sổ gộp trùng 10 giây của máy chủ.
  // Chỉ xoá khi ô còn đúng chữ đã gửi, người dùng gõ tiếp câu khác trong lúc chờ thì giữ.
  const send = usePostAction((body: string) => addComment(coreHttp, p.id, body), [QUERY_KEYS.unanswered], 'Không gửi được câu trả lời.', lock, {
    hasInput: true,
    onSent: (sent) => setReply((cur) => (cur.trim() === sent ? '' : cur)),
  });
  const body = reply.trim();
  return (
    <li data-post={p.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
      <PostMeta kind="QUESTION" author={p.author} category={p.category} createdAt={p.createdAt} />
      <div className="mt-1">
        <ToneBadge tone="warning">Chờ {p.waitingHours} giờ</ToneBadge>
      </div>
      {p.title && <div className="mt-1 break-words font-medium text-stone-900">{p.title}</div>}
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-800">{p.excerpt}</p>
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body) send.mutate(body);
        }}
      >
        <label className="block text-xs">
          <span className="font-medium text-stone-700">Trả lời {p.author ?? 'bạn Tubu'} (hiện công khai dưới bài)</span>
          <textarea name="reply" rows={2} maxLength={REPLY_MAX} value={reply} onChange={(e) => setReply(e.target.value)} className={`mt-1 ${INPUT_CLASS}`} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={!body} aria-busy={send.pending || undefined} aria-disabled={send.pending || undefined} className={`${BTN_PRIMARY} ${BUSY_CLASS}`}>
            {send.pending ? 'Đang gửi…' : 'Gửi trả lời'}
          </button>
          <Link href={`/cong-dong/${encodeURIComponent(p.id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center px-2 text-sm font-medium text-forest-700 underline sm:min-h-6 sm:px-1">
            Mở bài<span className="sr-only"> (mở tab mới)</span>
          </Link>
        </div>
      </form>
      <RowError message={send.err} />
    </li>
  );
}
