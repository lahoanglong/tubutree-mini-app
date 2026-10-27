import type { HttpClient } from '../http';

export type FeedPostKind =
  | 'MANUAL'
  | 'HARVEST'
  | 'MILESTONE'
  | 'SPECIES'
  | 'QUESTION'
  | 'SHOWCASE'
  | 'TIP';
export type FeedSort = 'new' | 'popular';

export interface ProductTag {
  slug: string;
  name: string;
  thumbnail: string | null;
  salePrice: number | null;
  basePrice: number;
}
export interface FeedCategory {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
}
export interface FeedTag {
  slug: string;
  name: string;
}
export interface FeedItem {
  id: string;
  kind: FeedPostKind;
  status: string;
  title: string | null;
  body: string;
  images: string[];
  /** Danh sách chỉ trả ảnh bìa; số ảnh thật của bài (chi tiết trả đủ). */
  imageCount?: number;
  meta: unknown;
  createdAt: string;
  author: string;
  badge: 'EXPERT' | null;
  authorLevel: number;
  category: FeedCategory | null;
  productTags: ProductTag[];
  tags: FeedTag[];
  isPinned: boolean;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  bestCommentId: string | null;
  isOwner: boolean;
}
export interface FeedComment {
  id: string;
  body: string;
  author: string;
  badge: 'EXPERT' | null;
  authorLevel: number;
  isAccepted: boolean;
  createdAt: string;
  isOwner: boolean;
}
export interface LeaderboardEntry {
  author: string;
  reputation: number;
  level: number;
  levelName: string;
}
export interface FeedPage {
  posts: FeedItem[];
  nextCursor: string | null;
}
export interface CreatePostInput {
  kind: Exclude<FeedPostKind, 'HARVEST' | 'MILESTONE' | 'SPECIES'>;
  categoryId?: string;
  title?: string;
  body: string;
  images?: string[];
  productSlugs?: string[];
  tagSlugs?: string[];
  eventId?: string;
}

// Sự kiện cộng đồng (Pha 4 Task 4) — thử thách có hạn + thưởng Điểm Xanh cho người thắng (1 điểm = 1đ).
export interface CommunityEvent {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  startAt: string;
  endAt: string;
  rewardPoints: number;
  status: string;
  winnerUserId: string | null;
  createdAt: string;
}
export interface CreateEventInput {
  title: string;
  description?: string;
  coverUrl?: string;
  startAt: string;
  endAt: string;
  /** Điểm Xanh, 0..1.000 (máy chủ từ chối số lớn hơn — tránh nhập nhầm theo đơn vị xu cũ). */
  rewardPoints?: number;
}

export const getCategories = (http: HttpClient) => http.get<FeedCategory[]>('/feed/categories');

export const getFeed = (
  http: HttpClient,
  params: {
    category?: string;
    kind?: string;
    sort?: FeedSort;
    cursor?: string;
    q?: string;
    unanswered?: boolean;
    tag?: string;
  } = {},
) => http.get<FeedPage>('/feed', { query: params });

/**
 * Một bài trong phần xem trước công khai (GET /feed/public-preview, khi cờ community.public_preview bật): chỉ trường công
 * khai, không avatar, không id người đăng, không cờ của người xem; `author` là tên gọi, `snippet` là đoạn đầu đã che
 * số điện thoại/email.
 */
export interface FeedPreviewItem {
  id: string;
  kind: FeedPostKind;
  title: string | null;
  snippet: string;
  image: string | null;
  createdAt: string;
  author: string;
  badge: 'EXPERT' | null;
  category: { slug: string; name: string; icon: string | null } | null;
  isPinned: boolean;
  likeCount: number;
  commentCount: number;
}
export const getFeedPublicPreview = (http: HttpClient) =>
  http.get<{ posts: FeedPreviewItem[] }>('/feed/public-preview');

export const getPost = (http: HttpClient, id: string) => http.get<FeedItem>(`/feed/${id}`);

export const getLeaderboard = (http: HttpClient) =>
  http.get<LeaderboardEntry[]>('/feed/leaderboard');

export const createPost = (http: HttpClient, input: CreatePostInput) =>
  http.post<{ id: string; status?: string }>('/feed', input);

export const editPost = (
  http: HttpClient,
  id: string,
  patch: { title?: string; body?: string; images?: string[] },
) => http.patch<{ ok: boolean }>(`/feed/${id}`, patch);

export const deletePost = (http: HttpClient, id: string) =>
  http.delete<{ ok: boolean }>(`/feed/${id}`);

export const reactPost = (http: HttpClient, id: string) =>
  http.post<{ liked: boolean }>(`/feed/${id}/react`);

export interface CommentPage {
  items: FeedComment[];
  nextCursor: string | null;
}
/** Phân trang: câu hỏi hot từng bị cắt cứng ở 50 câu trả lời và không có đường xem tiếp. */
export const getComments = (http: HttpClient, id: string, cursor?: string) =>
  http.get<CommentPage>(`/feed/${id}/comments`, { query: cursor ? { cursor } : undefined });

export const addComment = (http: HttpClient, id: string, body: string) =>
  http.post<{ id: string }>(`/feed/${id}/comments`, { body });

export const setBestAnswer = (http: HttpClient, id: string, commentId: string) =>
  http.post<{ ok: boolean }>(`/feed/${id}/best-answer/${commentId}`);

export const reportContent = (
  http: HttpClient,
  postId: string,
  body: { targetType: 'POST' | 'COMMENT'; targetId?: string; reason: string },
) => http.post<{ ok: boolean }>(`/feed/${postId}/report`, body);

// Admin — kiểm duyệt cộng đồng (duyệt bài PENDING + xử lý report).
export interface AdminPendingPost {
  id: string;
  kind: string;
  title: string | null;
  body: string;
  images: string[];
  author: string;
  category: string | null;
  createdAt: string;
}
export interface AdminReport {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt: string;
  /** Trích nội dung bị báo cáo — null nếu nội dung đã bị xoá cứng. */
  target: {
    kind: 'POST' | 'COMMENT';
    author: string;
    title: string | null;
    excerpt: string;
    alreadyHandled: boolean;
    postId: string;
  } | null;
}

export const adminPendingPosts = (http: HttpClient) =>
  http.get<AdminPendingPost[]>('/feed/admin/pending');

export const adminApprovePost = (http: HttpClient, id: string) =>
  http.post<{ ok: boolean }>(`/feed/admin/${id}/approve`);

export const adminRejectPost = (http: HttpClient, id: string) =>
  http.post<{ ok: boolean }>(`/feed/admin/${id}/reject`);

export const adminReports = (http: HttpClient) => http.get<AdminReport[]>('/feed/admin/reports');

export const adminResolveReport = (http: HttpClient, id: string) =>
  http.post<{ ok: boolean }>(`/feed/admin/reports/${id}/resolve`);

// Dùng DELETE (owner/ADMIN) để ẩn bài bị report — không có endpoint ẩn riêng cho admin.
export const adminHidePost = (http: HttpClient, id: string) =>
  http.delete<{ ok: boolean }>(`/feed/${id}`);

/** Gỡ 1 bình luận bị báo cáo (tác giả bình luận hoặc ADMIN). */
export const removeComment = (http: HttpClient, commentId: string) =>
  http.delete<{ ok: boolean }>(`/feed/comments/${commentId}`);

export const adminPin = (http: HttpClient, id: string, pinned: boolean) =>
  http.post<{ ok: boolean }>(`/feed/admin/${id}/pin`, { pinned });

// Sự kiện cộng đồng — danh sách/chi tiết công khai (authed) + quản lý (ADMIN).
export const listEvents = (http: HttpClient) => http.get<CommunityEvent[]>('/feed/events');

/** Phân trang: trước đây trần cứng 20 bài, sự kiện 200 bài dự thi thì 180 bài không ai xem tới. */
export const eventPosts = (http: HttpClient, id: string, cursor?: string) =>
  http.get<FeedPage>(`/feed/events/${id}/posts`, { query: cursor ? { cursor } : undefined });

/** Sự kiện cho quản trị kèm người thắng (đã chốt thì CLOSED); danh sách công khai chỉ có sự kiện đang mở. */
export interface AdminCommunityEvent extends CommunityEvent {
  winner: { id: string; name: string; avatar: string | null } | null;
}
export const adminEvents = (http: HttpClient, status: 'OPEN' | 'CLOSED') =>
  http.get<AdminCommunityEvent[]>('/feed/admin/events', { query: { status } });

/** Người dự thi (một dòng/người, bài mới nhất) để quản trị chọn người thắng thay vì dán userId. */
export interface EventParticipant {
  userId: string;
  name: string;
  avatar: string | null;
  postId: string;
  postTitle: string;
  postedAt: string;
  postCount: number;
}
export const adminEventParticipants = (http: HttpClient, id: string) =>
  http.get<EventParticipant[]>(`/feed/admin/events/${id}/participants`);

export const createEvent = (http: HttpClient, dto: CreateEventInput) =>
  http.post<CommunityEvent>('/feed/events', dto);

export const closeEvent = (http: HttpClient, id: string) =>
  http.post<{ ok: boolean }>(`/feed/events/${id}/close`);

export const pickEventWinner = (http: HttpClient, id: string, userId: string) =>
  http.post<{ ok: boolean }>(`/feed/events/${id}/winner`, { userId });
