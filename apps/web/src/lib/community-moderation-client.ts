'use client';

import { apiFetch } from './client-api';

export type CommunityPostKind = 'MANUAL' | 'QUESTION' | 'SHOWCASE' | 'TIP' | 'HARVEST' | 'SPECIES' | 'MILESTONE';

/** GET /feed/admin/pending — bài chờ duyệt, cũ nhất trước. */
export interface CommunityPendingPost {
  id: string;
  kind: CommunityPostKind;
  title: string | null;
  body: string;
  images: string[];
  author: string;
  category: string | null;
  createdAt: string;
}

/** GET /feed/admin/published — bài đã đăng, ghim lên đầu rồi mới nhất trước. */
export interface CommunityPublishedPost {
  id: string;
  kind: CommunityPostKind;
  title: string | null;
  excerpt: string;
  author: string;
  category: string | null;
  createdAt: string;
  isPinned: boolean;
  likeCount: number;
  commentCount: number;
}
export interface CommunityPublishedPage {
  items: CommunityPublishedPost[];
  nextCursor: string | null;
}

/** GET /feed/admin/unanswered — câu hỏi chờ quá ngưỡng giờ (cấu hình ở API) mà chưa ai trả lời. */
export interface CommunityUnansweredQuestion {
  id: string;
  title: string | null;
  excerpt: string;
  author: string | null;
  category: string | null;
  createdAt: string;
  waitingHours: number;
}

const enc = encodeURIComponent;

export const listCommunityPending = () => apiFetch<CommunityPendingPost[]>('/feed/admin/pending');
export const listCommunityPublished = (cursor?: string) =>
  apiFetch<CommunityPublishedPage>(`/feed/admin/published${cursor ? `?cursor=${enc(cursor)}` : ''}`);
export const listCommunityUnanswered = () => apiFetch<CommunityUnansweredQuestion[]>('/feed/admin/unanswered');

export const approveCommunityPost = (id: string) => apiFetch<{ ok: boolean }>(`/feed/admin/${enc(id)}/approve`, { method: 'POST' });
/** Lý do hiện cho tác giả; bỏ trống thì API dùng lý do mặc định về nội quy. */
export const rejectCommunityPost = (id: string, reason?: string) =>
  apiFetch<{ ok: boolean }>(`/feed/admin/${enc(id)}/reject`, { method: 'POST', body: reason ? { reason } : {} });
export const hideCommunityPost = (id: string, reason?: string) =>
  apiFetch<{ ok: boolean }>(`/feed/admin/${enc(id)}/hide`, { method: 'POST', body: reason ? { reason } : {} });
export const pinCommunityPost = (id: string, pinned: boolean) =>
  apiFetch<{ ok: boolean }>(`/feed/admin/${enc(id)}/pin`, { method: 'POST', body: { pinned } });
