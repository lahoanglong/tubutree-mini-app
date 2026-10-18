import type { HttpClient } from '../http';
import {
  adminEvents,
  adminEventParticipants,
  adminPendingPosts,
  adminReports,
  eventPosts,
  getCategories,
  getComments,
  getFeed,
  getFeedPublicPreview,
  getLeaderboard,
  getPost,
  listEvents,
} from '../api/feed';

export interface FeedFilters {
  category?: string;
  sort?: 'new' | 'popular';
  dq: string;
  unanswered: boolean;
  tag?: string;
}

export const feedCategoriesQuery = (http: HttpClient) => ({
  queryKey: ['community', 'categories'] as const,
  queryFn: () => getCategories(http),
});
/** Dùng với useInfiniteQuery (initialPageParam undefined, getNextPageParam: nextCursor). */
export const feedListQuery = (http: HttpClient, f: FeedFilters) => ({
  queryKey: ['community', f.category, f.sort, f.dq, f.unanswered, f.tag] as const,
  queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
    getFeed(http, {
      category: f.category,
      sort: f.sort,
      cursor: pageParam,
      q: f.dq || undefined,
      unanswered: f.unanswered || undefined,
      tag: f.tag,
    }),
});
export const feedPublicPreviewQuery = (http: HttpClient) => ({
  queryKey: ['community', 'public-preview'] as const,
  queryFn: () => getFeedPublicPreview(http),
});
export const postQuery = (http: HttpClient, id: string) => ({
  queryKey: ['community', id] as const,
  queryFn: () => getPost(http, id),
});
export const postCommentsQuery = (http: HttpClient, id: string) => ({
  queryKey: ['community', id, 'comments'] as const,
  queryFn: ({ pageParam }: { pageParam: string | undefined }) => getComments(http, id, pageParam),
});
export const communityEventsQuery = (http: HttpClient) => ({
  queryKey: ['community', 'events'] as const,
  queryFn: () => listEvents(http),
});
export const eventPostsQuery = (http: HttpClient, eventId: string | undefined) => ({
  queryKey: ['community', 'event-posts', eventId] as const,
  queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
    eventPosts(http, eventId!, pageParam),
});
export const communityLeaderboardQuery = (http: HttpClient) => ({
  queryKey: ['community', 'leaderboard'] as const,
  queryFn: () => getLeaderboard(http),
});
export const adminPendingPostsQuery = (http: HttpClient) => ({
  queryKey: ['admin-community-pending'] as const,
  queryFn: () => adminPendingPosts(http),
});
export const adminReportsQuery = (http: HttpClient) => ({
  queryKey: ['admin-community-reports'] as const,
  queryFn: () => adminReports(http),
});
export const adminEventsQuery = (http: HttpClient, view: 'OPEN' | 'CLOSED') => ({
  queryKey: ['admin-community-events', view] as const,
  queryFn: () => adminEvents(http, view),
});
export const adminEventParticipantsQuery = (http: HttpClient, eventId: string) => ({
  queryKey: ['admin-community-event-participants', eventId] as const,
  queryFn: () => adminEventParticipants(http, eventId),
});
