import { api } from './api';

export type FeedPostKind = 'MANUAL' | 'HARVEST' | 'MILESTONE' | 'SPECIES' | 'QUESTION' | 'SHOWCASE' | 'TIP';
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
  meta: unknown;
  createdAt: string;
  author: string;
  avatar: string | null;
  badge: 'EXPERT' | null;
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
  avatar: string | null;
  badge: 'EXPERT' | null;
  isAccepted: boolean;
  createdAt: string;
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
}

export const getCategories = () =>
  api.get<FeedCategory[]>('/feed/categories').then((r) => r.data);

export const getFeed = (
  params: {
    category?: string;
    kind?: string;
    sort?: FeedSort;
    cursor?: string;
    q?: string;
    unanswered?: boolean;
    tag?: string;
  } = {},
) => api.get<FeedPage>('/feed', { params }).then((r) => r.data);

export const getPost = (id: string) => api.get<FeedItem>(`/feed/${id}`).then((r) => r.data);

export const createPost = (input: CreatePostInput) =>
  api.post<{ id: string; status?: string }>('/feed', input).then((r) => r.data);

export const editPost = (id: string, patch: { title?: string; body?: string; images?: string[] }) =>
  api.patch<{ ok: boolean }>(`/feed/${id}`, patch).then((r) => r.data);

export const deletePost = (id: string) => api.delete<{ ok: boolean }>(`/feed/${id}`).then((r) => r.data);

export const reactPost = (id: string) =>
  api.post<{ liked: boolean }>(`/feed/${id}/react`).then((r) => r.data);

export const getComments = (id: string) =>
  api.get<FeedComment[]>(`/feed/${id}/comments`).then((r) => r.data);

export const addComment = (id: string, body: string) =>
  api.post<{ id: string }>(`/feed/${id}/comments`, { body }).then((r) => r.data);

export const setBestAnswer = (id: string, commentId: string) =>
  api.post<{ ok: boolean }>(`/feed/${id}/best-answer/${commentId}`).then((r) => r.data);

export const reportContent = (
  postId: string,
  body: { targetType: 'POST' | 'COMMENT'; targetId?: string; reason: string },
) => api.post<{ ok: boolean }>(`/feed/${postId}/report`, body).then((r) => r.data);

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
}

export const adminPendingPosts = () =>
  api.get<AdminPendingPost[]>('/feed/admin/pending').then((r) => r.data);

export const adminApprovePost = (id: string) =>
  api.post<{ ok: boolean }>(`/feed/admin/${id}/approve`).then((r) => r.data);

export const adminRejectPost = (id: string) =>
  api.post<{ ok: boolean }>(`/feed/admin/${id}/reject`).then((r) => r.data);

export const adminReports = () => api.get<AdminReport[]>('/feed/admin/reports').then((r) => r.data);

export const adminResolveReport = (id: string) =>
  api.post<{ ok: boolean }>(`/feed/admin/reports/${id}/resolve`).then((r) => r.data);

// Dùng DELETE (owner/ADMIN) để ẩn bài bị report — không có endpoint ẩn riêng cho admin.
export const adminHidePost = (id: string) => api.delete<{ ok: boolean }>(`/feed/${id}`).then((r) => r.data);
