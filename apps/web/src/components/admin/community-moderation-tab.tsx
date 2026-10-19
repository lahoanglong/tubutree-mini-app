'use client';

import { createContext, useContext, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  approveCommunityPost,
  hideCommunityPost,
  listCommunityPending,
  listCommunityPublished,
  listCommunityUnanswered,
  pinCommunityPost,
  rejectCommunityPost,
  type CommunityPendingPost,
  type CommunityPostKind,
  type CommunityPublishedPost,
  type CommunityUnansweredQuestion,
} from '@/lib/community-moderation-client';
import { ApiError } from '@/lib/client-api';
import { formatDateTime } from '@/lib/format-date';
import { useConfirm } from './confirm-dialog';
import { safeEvidenceImage } from './evidence-images';
import { BTN_DANGER_OUTLINE, BTN_PRIMARY, BTN_SECONDARY, chipClass, Notice, ToneBadge } from './ui';

export type CommunityView = 'pending' | 'published' | 'unanswered';

const VIEWS: { k: CommunityView; label: string }[] = [
  { k: 'pending', label: 'Chờ duyệt' },
  { k: 'published', label: 'Đã đăng' },
  { k: 'unanswered', label: 'Chưa trả lời' },
];

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
  published: ['admin-community-published'],
  unanswered: ['admin-community-unanswered'],
} as const satisfies Record<CommunityView, QueryKey>;
const INBOX_KEY: QueryKey = ['admin-ops-inbox'];

/** Bài đã đổi trạng thái do người khác (409) hoặc không còn (404): dòng sẽ biến khỏi danh sách sau khi làm mới, nên lời giải thích đứng ở đầu tab thay vì trên dòng. */
const StaleNoticeContext = createContext<(message: string | null) => void>(() => {});
const isStale = (e: unknown): e is ApiError => e instanceof ApiError && (e.status === 409 || e.status === 404);

/**
 * Kiểm duyệt cộng đồng trên web admin cho ADMIN và nhân viên nhóm CSKH (trước đây chỉ ADMIN duyệt được, và chỉ trong mini app):
 * duyệt/từ chối bài chờ duyệt, ẩn/ghim bài đã đăng, và xem câu hỏi chờ quá lâu chưa ai trả lời. Tác giả được báo khi bài bị từ
 * chối hoặc ẩn, kèm lý do người kiểm duyệt nhập. Ghim bài chỉ ADMIN (API từ chối nhân viên), nên nút ghim chỉ hiện khi `isAdmin`.
 */
export function CommunityModerationTab({ initialView = 'pending', isAdmin = false }: { initialView?: CommunityView; isAdmin?: boolean }) {
  const [view, setView] = useState<CommunityView>(initialView);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  return (
    <StaleNoticeContext.Provider value={setStaleNotice}>
      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-stone-900">Cộng đồng</h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Mục kiểm duyệt cộng đồng">
          {VIEWS.map((v) => (
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
            </button>
          ))}
        </div>
        {staleNotice && (
          <Notice tone="warning" role="alert">
            {staleNotice} Danh sách đã được làm mới.
          </Notice>
        )}
        {view === 'pending' && <PendingList />}
        {view === 'published' && <PublishedList canPin={isAdmin} />}
        {view === 'unanswered' && <UnansweredList />}
      </div>
    </StaleNoticeContext.Provider>
  );
}

function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger-fg">
      <span>Không tải được {what}.</span>
      <button type="button" onClick={onRetry} className={BTN_SECONDARY}>
        Thử lại
      </button>
    </div>
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

/** Thao tác trên một bài: gọi API, làm mới danh sách và số trên "Việc cần xử lý"; lỗi hiện ngay trên đúng bài. */
function usePostAction<V>(fn: (v: V) => Promise<unknown>, refreshKeys: QueryKey[], failText: string) {
  const qc = useQueryClient();
  const setStaleNotice = useContext(StaleNoticeContext);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => {
    for (const key of [...refreshKeys, INBOX_KEY]) void qc.invalidateQueries({ queryKey: key });
  };
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => {
      setErr(null);
      setStaleNotice(null);
    },
    onSuccess: refresh,
    onError: (e) => {
      if (isStale(e)) {
        setStaleNotice(e.message);
        refresh();
        return;
      }
      setErr(e instanceof Error && e.message ? e.message : failText);
    },
  });
  return { mutate: m.mutate, pending: m.isPending, err };
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
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <LoadError what="danh sách bài chờ duyệt" onRetry={() => void q.refetch()} />}
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
  const approve = usePostAction(() => approveCommunityPost(p.id), keys, 'Không duyệt được bài.');
  const reject = usePostAction((reason: string) => rejectCommunityPost(p.id, reason || undefined), keys, 'Không từ chối được bài.');
  const askReject = async () => {
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
        <button type="button" disabled={busy} onClick={() => approve.mutate(undefined)} className={BTN_PRIMARY}>
          Duyệt
        </button>
        <button type="button" disabled={busy} onClick={() => void askReject()} className={BTN_DANGER_OUTLINE}>
          Từ chối
        </button>
      </div>
      <RowError message={approve.err ?? reject.err} />
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
  return (
    <div className="space-y-2">
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <LoadError what="danh sách bài đã đăng" onRetry={() => void q.refetch()} />}
      {q.data && items.length === 0 && <p className="text-xs text-stone-500">Chưa có bài nào được đăng.</p>}
      <ul className="space-y-2">
        {items.map((p) => (
          <PublishedRow key={p.id} post={p} canPin={canPin} />
        ))}
      </ul>
      {q.hasNextPage && (
        <button type="button" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} className={BTN_SECONDARY}>
          {q.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
        </button>
      )}
    </div>
  );
}

function PublishedRow({ post: p, canPin }: { post: CommunityPublishedPost; canPin: boolean }) {
  const { ask, dialog } = useConfirm();
  const keys = [QUERY_KEYS.published, QUERY_KEYS.unanswered];
  const pin = usePostAction((pinned: boolean) => pinCommunityPost(p.id, pinned), keys, 'Không đổi được trạng thái ghim.');
  const hide = usePostAction((reason: string) => hideCommunityPost(p.id, reason || undefined), keys, 'Không ẩn được bài.');
  const askHide = async () => {
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
          <button type="button" disabled={busy} onClick={() => pin.mutate(!p.isPinned)} className={BTN_SECONDARY}>
            {p.isPinned ? 'Bỏ ghim' : 'Ghim'}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => void askHide()} className={BTN_DANGER_OUTLINE}>
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
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <LoadError what="danh sách câu hỏi chưa trả lời" onRetry={() => void q.refetch()} />}
      {q.data && (
        <>
          <p className="text-xs text-stone-500">
            {q.data.length === 0
              ? 'Không có câu hỏi nào đang chờ trả lời.'
              : `${q.data.length} câu hỏi chờ lâu chưa ai trả lời · cũ nhất trước. Trả lời trong ứng dụng Tubu Tree, mục Cộng đồng.`}
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

function UnansweredRow({ question: p }: { question: CommunityUnansweredQuestion }) {
  return (
    <li data-post={p.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
      <PostMeta kind="QUESTION" author={p.author} category={p.category} createdAt={p.createdAt} />
      <div className="mt-1">
        <ToneBadge tone="warning">Chờ {p.waitingHours} giờ</ToneBadge>
      </div>
      {p.title && <div className="mt-1 break-words font-medium text-stone-900">{p.title}</div>}
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-800">{p.excerpt}</p>
    </li>
  );
}
