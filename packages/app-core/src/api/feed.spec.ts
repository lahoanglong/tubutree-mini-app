import { describe, expect, it } from 'vitest';
import { fakeHttp, type RecordedCall } from './fake-http';
import * as f from './feed';
import type { HttpClient } from '../http';

describe('feed — đúng route, query, body', () => {
  it.each<[string, (h: HttpClient) => unknown, Partial<RecordedCall>]>([
    ['getCategories', (h) => f.getCategories(h), { method: 'get', path: '/feed/categories' }],
    ['getFeed()', (h) => f.getFeed(h), { method: 'get', path: '/feed', opts: { query: {} } }],
    [
      'getFeed(lọc)',
      (h) =>
        f.getFeed(h, {
          category: 'c1',
          sort: 'popular',
          cursor: 'cur',
          q: 'cây',
          unanswered: true,
          tag: 't',
        }),
      {
        method: 'get',
        path: '/feed',
        opts: {
          query: {
            category: 'c1',
            sort: 'popular',
            cursor: 'cur',
            q: 'cây',
            unanswered: true,
            tag: 't',
          },
        },
      },
    ],
    [
      'getFeedPublicPreview',
      (h) => f.getFeedPublicPreview(h),
      { method: 'get', path: '/feed/public-preview' },
    ],
    ['getPost', (h) => f.getPost(h, 'p1'), { method: 'get', path: '/feed/p1' }],
    ['getLeaderboard', (h) => f.getLeaderboard(h), { method: 'get', path: '/feed/leaderboard' }],
    [
      'createPost',
      (h) => f.createPost(h, { kind: 'QUESTION', body: 'hỏi' }),
      { method: 'post', path: '/feed', body: { kind: 'QUESTION', body: 'hỏi' } },
    ],
    [
      'editPost',
      (h) => f.editPost(h, 'p1', { body: 'sửa' }),
      { method: 'patch', path: '/feed/p1', body: { body: 'sửa' } },
    ],
    ['deletePost', (h) => f.deletePost(h, 'p1'), { method: 'delete', path: '/feed/p1' }],
    ['reactPost', (h) => f.reactPost(h, 'p1'), { method: 'post', path: '/feed/p1/react' }],
    [
      'getComments',
      (h) => f.getComments(h, 'p1'),
      { method: 'get', path: '/feed/p1/comments', opts: { query: undefined } },
    ],
    [
      'getComments(cursor)',
      (h) => f.getComments(h, 'p1', 'c'),
      { method: 'get', path: '/feed/p1/comments', opts: { query: { cursor: 'c' } } },
    ],
    [
      'addComment',
      (h) => f.addComment(h, 'p1', 'hay'),
      { method: 'post', path: '/feed/p1/comments', body: { body: 'hay' } },
    ],
    [
      'setBestAnswer',
      (h) => f.setBestAnswer(h, 'p1', 'c1'),
      { method: 'post', path: '/feed/p1/best-answer/c1' },
    ],
    [
      'reportContent',
      (h) => f.reportContent(h, 'p1', { targetType: 'COMMENT', targetId: 'c1', reason: 'spam' }),
      {
        method: 'post',
        path: '/feed/p1/report',
        body: { targetType: 'COMMENT', targetId: 'c1', reason: 'spam' },
      },
    ],
    [
      'adminPendingPosts',
      (h) => f.adminPendingPosts(h),
      { method: 'get', path: '/feed/admin/pending' },
    ],
    [
      'adminApprovePost',
      (h) => f.adminApprovePost(h, 'p1'),
      { method: 'post', path: '/feed/admin/p1/approve' },
    ],
    [
      'adminRejectPost',
      (h) => f.adminRejectPost(h, 'p1'),
      { method: 'post', path: '/feed/admin/p1/reject' },
    ],
    ['adminReports', (h) => f.adminReports(h), { method: 'get', path: '/feed/admin/reports' }],
    [
      'adminResolveReport',
      (h) => f.adminResolveReport(h, 'r1'),
      { method: 'post', path: '/feed/admin/reports/r1/resolve' },
    ],
    ['adminHidePost', (h) => f.adminHidePost(h, 'p1'), { method: 'delete', path: '/feed/p1' }],
    [
      'removeComment',
      (h) => f.removeComment(h, 'c1'),
      { method: 'delete', path: '/feed/comments/c1' },
    ],
    [
      'adminPin',
      (h) => f.adminPin(h, 'p1', true),
      { method: 'post', path: '/feed/admin/p1/pin', body: { pinned: true } },
    ],
    ['listEvents', (h) => f.listEvents(h), { method: 'get', path: '/feed/events' }],
    [
      'eventPosts',
      (h) => f.eventPosts(h, 'e1'),
      { method: 'get', path: '/feed/events/e1/posts', opts: { query: undefined } },
    ],
    [
      'eventPosts(cursor)',
      (h) => f.eventPosts(h, 'e1', 'c'),
      { method: 'get', path: '/feed/events/e1/posts', opts: { query: { cursor: 'c' } } },
    ],
    [
      'adminEvents',
      (h) => f.adminEvents(h, 'CLOSED'),
      { method: 'get', path: '/feed/admin/events', opts: { query: { status: 'CLOSED' } } },
    ],
    [
      'adminEventParticipants',
      (h) => f.adminEventParticipants(h, 'e1'),
      { method: 'get', path: '/feed/admin/events/e1/participants' },
    ],
    [
      'createEvent',
      (h) => f.createEvent(h, { title: 't', startAt: 'a', endAt: 'b', rewardPoints: 50 }),
      {
        method: 'post',
        path: '/feed/events',
        body: { title: 't', startAt: 'a', endAt: 'b', rewardPoints: 50 },
      },
    ],
    ['closeEvent', (h) => f.closeEvent(h, 'e1'), { method: 'post', path: '/feed/events/e1/close' }],
    [
      'pickEventWinner',
      (h) => f.pickEventWinner(h, 'e1', 'u1'),
      { method: 'post', path: '/feed/events/e1/winner', body: { userId: 'u1' } },
    ],
  ])('%s', async (_n, run, expected) => {
    const { http, calls } = fakeHttp();
    await run(http);
    expect(calls).toEqual([expected]);
  });
});
