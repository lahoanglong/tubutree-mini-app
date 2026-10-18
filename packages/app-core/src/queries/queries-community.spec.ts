import { describe, expect, it } from 'vitest';
import type { HttpClient } from '../http';
import { fakeHttp } from '../api/fake-http';
import * as academy from './academy';
import * as affiliate from './affiliate';
import * as feed from './feed';
import * as game from './game';
import * as storefront from './storefront';

type Q = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> };
type Case = [name: string, make: (h: HttpClient) => Q, key: readonly unknown[], path: string];

/** queryKey phải GIỐNG HỆT key Mini App đang dùng (cache dùng chung, invalidate theo tiền tố). */
const cases: Case[] = [
  [
    'feedCategories',
    (h) => feed.feedCategoriesQuery(h),
    ['community', 'categories'],
    '/feed/categories',
  ],
  [
    'publicPreview',
    (h) => feed.feedPublicPreviewQuery(h),
    ['community', 'public-preview'],
    '/feed/public-preview',
  ],
  ['post', (h) => feed.postQuery(h, 'p1'), ['community', 'p1'], '/feed/p1'],
  ['events', (h) => feed.communityEventsQuery(h), ['community', 'events'], '/feed/events'],
  [
    'leaderboard',
    (h) => feed.communityLeaderboardQuery(h),
    ['community', 'leaderboard'],
    '/feed/leaderboard',
  ],
  [
    'adminPending',
    (h) => feed.adminPendingPostsQuery(h),
    ['admin-community-pending'],
    '/feed/admin/pending',
  ],
  [
    'adminReports',
    (h) => feed.adminReportsQuery(h),
    ['admin-community-reports'],
    '/feed/admin/reports',
  ],
  [
    'adminEvents',
    (h) => feed.adminEventsQuery(h, 'OPEN'),
    ['admin-community-events', 'OPEN'],
    '/feed/admin/events',
  ],
  [
    'adminParticipants',
    (h) => feed.adminEventParticipantsQuery(h, 'e1'),
    ['admin-community-event-participants', 'e1'],
    '/feed/admin/events/e1/participants',
  ],
  [
    'academyCourses',
    (h) => academy.academyCoursesQuery(h),
    ['academy-courses'],
    '/academy/courses',
  ],
  [
    'academyCourse',
    (h) => academy.academyCourseQuery(h, 'c1'),
    ['academy-course', 'c1'],
    '/academy/courses/c1',
  ],
  ['affiliateMe', (h) => affiliate.affiliateMeQuery(h), ['affiliate-me'], '/affiliate/me'],
  [
    'affiliateDashboard',
    (h) => affiliate.affiliateDashboardQuery(h),
    ['affiliate-dashboard'],
    '/affiliate/dashboard',
  ],
  [
    'affiliateLinks',
    (h) => affiliate.affiliateLinksQuery(h),
    ['affiliate-links'],
    '/affiliate/links',
  ],
  [
    'affiliateCommissions',
    (h) => affiliate.affiliateCommissionsQuery(h),
    ['affiliate-commissions'],
    '/affiliate/commissions',
  ],
  [
    'affiliatePayouts',
    (h) => affiliate.affiliatePayoutsQuery(h),
    ['affiliate-payouts'],
    '/affiliate/payouts',
  ],
  [
    'affiliateTax',
    (h) => affiliate.affiliateTaxStatementQuery(h),
    ['affiliate-tax-statement'],
    '/affiliate/tax-statement',
  ],
  [
    'affiliateSfAnalytics',
    (h) => affiliate.affiliateStorefrontAnalyticsQuery(h),
    ['affiliate-sf-analytics'],
    '/affiliate/analytics/storefronts',
  ],
  [
    'affiliateProductBreakdown',
    (h) => affiliate.affiliateProductBreakdownQuery(h),
    ['affiliate-product-breakdown'],
    '/affiliate/analytics/products',
  ],
  [
    'affiliateCtvTiers',
    (h) => affiliate.affiliateCtvTiersQuery(h),
    ['affiliate-ctv-tiers'],
    '/affiliate/tiers',
  ],
  [
    'affiliateMilestones',
    (h) => affiliate.affiliateMilestonesQuery(h),
    ['affiliate-milestones'],
    '/affiliate/milestones',
  ],
  [
    'contentKit',
    (h) => affiliate.contentKitQuery(h, 'sp'),
    ['content-kit', 'sp'],
    '/affiliate/content-kit/sp',
  ],
  [
    'ctvOrderQuote',
    (h) => affiliate.ctvOrderQuoteQuery(h, '[{"variationId":"v1","quantity":1}]'),
    ['ctv-order-quote', '[{"variationId":"v1","quantity":1}]'],
    '/affiliate/orders/quote',
  ],
  ['myStorefront', (h) => storefront.myStorefrontQuery(h), ['my-storefront'], '/storefront/me'],
  [
    'publicStorefront',
    (h) => storefront.publicStorefrontQuery(h, 'an'),
    ['public-storefront', 'an'],
    '/storefront/public/an',
  ],
  [
    'storefrontCategories',
    (h) => storefront.storefrontCategoriesQuery(h),
    ['storefront-categories'],
    '/categories',
  ],
  [
    'storefrontStats',
    (h) => storefront.storefrontStatsQuery(h),
    ['storefront-stats'],
    '/storefront/me/stats',
  ],
  [
    'storefrontQuests',
    (h) => storefront.storefrontQuestsQuery(h),
    ['storefront-quests'],
    '/storefront/me/quests',
  ],
  ['picker', (h) => storefront.pickerQuery(h, ''), ['picker', ''], '/storefront/me/products'],
  ['gameProfile', (h) => game.gameProfileQuery(h), ['game', 'profile'], '/game/profile'],
  ['gameQuiz', (h) => game.gameQuizQuery(h), ['game', 'quiz'], '/game/quiz/today'],
  ['gameBoard', (h) => game.gameBoardQuery(h), ['game', 'board'], '/game/leaderboard'],
  ['gameMissions', (h) => game.gameMissionsQuery(h), ['game', 'missions'], '/game/missions'],
  ['gameForest', (h) => game.gameForestQuery(h), ['game', 'forest'], '/game/forest'],
  ['gameCommunity', (h) => game.gameCommunityQuery(h), ['game', 'community'], '/game/community'],
  [
    'gameCollection',
    (h) => game.gameCollectionQuery(h),
    ['game', 'collection'],
    '/game/collection',
  ],
  ['gameSeason', (h) => game.gameSeasonQuery(h), ['game', 'season'], '/game/season'],
  [
    'gameSeasonBoard',
    (h) => game.gameSeasonBoardQuery(h),
    ['game', 'seasonBoard'],
    '/game/season/leaderboard',
  ],
  ['gameFriends', (h) => game.gameFriendsQuery(h), ['game', 'friends'], '/game/friends'],
  ['gameGarden', (h) => game.gameGardenQuery(h), ['game', 'garden'], '/game/garden'],
  [
    'gameSeasonPass',
    (h) => game.gameSeasonPassQuery(h),
    ['game', 'seasonPass'],
    '/game/season-pass',
  ],
];

describe('queries cộng đồng, CTV, gian hàng, game — queryKey giống Mini App', () => {
  it.each(cases)('%s', async (_n, make, key, path) => {
    const { http, calls } = fakeHttp();
    const q = make(http);
    expect(q.queryKey).toEqual(key);
    expect(calls).toHaveLength(0);
    await q.queryFn();
    expect(calls[0]!.path).toBe(path);
  });
});

describe('queries cộng đồng — trang theo cursor', () => {
  it('danh sách bài: khoá theo bộ lọc, pageParam thành cursor, bỏ q rỗng và unanswered=false', async () => {
    const { http, calls } = fakeHttp();
    const q = feed.feedListQuery(http, {
      category: 'c',
      sort: 'new',
      dq: '',
      unanswered: false,
      tag: undefined,
    });
    expect(q.queryKey).toEqual(['community', 'c', 'new', '', false, undefined]);
    await q.queryFn({ pageParam: 'cur' });
    expect(calls).toEqual([
      {
        method: 'get',
        path: '/feed',
        opts: {
          query: {
            category: 'c',
            sort: 'new',
            cursor: 'cur',
            q: undefined,
            unanswered: undefined,
            tag: undefined,
          },
        },
      },
    ]);
  });

  it('bình luận và bài dự thi: khoá con của community, pageParam là cursor', async () => {
    const { http, calls } = fakeHttp();
    const c = feed.postCommentsQuery(http, 'p1');
    expect(c.queryKey).toEqual(['community', 'p1', 'comments']);
    await c.queryFn({ pageParam: 'x' });
    const e = feed.eventPostsQuery(http, 'e1');
    expect(e.queryKey).toEqual(['community', 'event-posts', 'e1']);
    await e.queryFn({ pageParam: undefined });
    expect(calls.map((x) => [x.path, x.opts])).toEqual([
      ['/feed/p1/comments', { query: { cursor: 'x' } }],
      ['/feed/events/e1/posts', { query: undefined }],
    ]);
  });
});
