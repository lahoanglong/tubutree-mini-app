import { api } from './api';

export type FeedPostKind = 'MANUAL' | 'HARVEST' | 'MILESTONE' | 'SPECIES';

export interface FeedPost {
  id: string;
  kind: FeedPostKind;
  body: string;
  meta: unknown;
  createdAt: string;
  author: string;
  likeCount: number;
  commentCount: number;
  liked: boolean;
}
export interface FeedComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

export const getFeed = () => api.get<{ posts: FeedPost[] }>('/feed').then((r) => r.data.posts);
export const createPost = (body: string) =>
  api.post<{ id: string }>('/feed', { body }).then((r) => r.data);
export const reactPost = (id: string) =>
  api.post<{ liked: boolean }>(`/feed/${id}/react`).then((r) => r.data);
export const getComments = (id: string) =>
  api.get<FeedComment[]>(`/feed/${id}/comments`).then((r) => r.data);
export const addComment = (id: string, body: string) =>
  api.post<{ id: string }>(`/feed/${id}/comments`, { body }).then((r) => r.data);
