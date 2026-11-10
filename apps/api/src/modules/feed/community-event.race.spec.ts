import { BadRequestException, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import type { RaceDb } from '../../../test/fakes/race-db.fake';
import { tick } from '../../../test/fakes/race-db.fake';
import { createCommunityRaceDb, eventEntry } from '../../../test/fakes/w101a-helpers';
import { RewardPointsService } from '../wallet/reward-points.service';
import { CommunityFeedService } from './community-feed.service';
import { CommunityRewardService } from './community-reward.service';

/**
 * Sự kiện cộng đồng chạy đồng thời (Postgres READ COMMITTED, test/fakes/race-db.fake.ts).
 *
 * Mã KHÔNG có đăng ký hay check-in sự kiện: "tham gia" là đăng bài FeedPost có `meta.eventId` (createPost), quản trị `createEvent`,
 * `closeEvent`, `pickWinner` (đóng sự kiện + thưởng Điểm Xanh cùng một giao dịch). Spec này chạy đúng các đường đó.
 *
 * Dùng CommunityFeedService, CommunityRewardService, RewardPointsService THẬT trên RaceDb; chỉ cấu hình (SystemConfigService), thông báo
 * (NotificationsService) và analytics là giả. Chưa phủ: `adminEventParticipants` (chỉ đọc, dùng `select` quan hệ mà client giả chưa hỗ trợ);
 * khoá dòng chỉ-để-tránh-deadlock và KEY SHARE của khoá ngoại không mô phỏng được ở đây. Test Postgres thật của cùng luồng:
 * test/integration-race/community-pick-winner.race-spec.ts, feed-create-dedupe.race-spec.ts.
 *
 * Quét thời điểm: mỗi vòng lệch hai bên `skew` nhịp (-60..60) để chúng thật sự chen nhau; mỗi test kiểm bên thắng/thua theo từng vòng và kiểm
 * cả hai kết cục đều xảy ra trong lần quét.
 */
const DAY = 86_400_000;
const SWEEP = Array.from({ length: 121 }, (_, i) => i - 60);
const CLOSED_MSG = 'Sự kiện đã đóng hoặc đã chọn người thắng.';
const NOT_ENTRANT_MSG = 'Người này chưa có bài dự thi nào được đăng trong sự kiện, không thể chọn làm người thắng.';
const POST_REFUSED_MSG = 'Sự kiện không hợp lệ hoặc đã đóng.';
const POST_WINDOW_MSG = 'Sự kiện chưa mở hoặc đã hết hạn nộp bài.';
const POINTS = 30_000;

const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const reasonOf = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason as Error) : null);

const eventRow = (id = 'e1', over: Record<string, unknown> = {}) => ({
  id,
  title: 'Thi khoe vườn',
  description: null,
  coverUrl: null,
  startAt: new Date(Date.now() - DAY),
  endAt: new Date(Date.now() + DAY),
  rewardXu: 0,
  rewardPoints: POINTS,
  status: 'OPEN',
  winnerUserId: null,
  createdAt: new Date(),
  ...over,
});

function setup(opts: { advisoryLocks?: boolean; event?: Record<string, unknown> | null; config?: Record<string, unknown>; onFeedPostInsert?: (db: RaceDb) => void } = {}) {
  const { db, prisma } = createCommunityRaceDb({ advisoryLocks: opts.advisoryLocks, onFeedPostInsert: opts.onFeedPostInsert });
  db.seed(
    'user',
    ['u1', 'u2', 'u3', 'a1'].map((id) => ({ id, role: 'CUSTOMER', pointsBalance: 0, pointsConvertedBalance: 0 })),
  );
  // Khách đã có đơn DELIVERED được đăng bài PUBLISHED ngay (isTrusted).
  db.seed('order', ['u1', 'u2', 'u3'].map((id) => ({ id: `o-${id}`, userId: id, status: 'DELIVERED' })));
  if (opts.event !== null) db.seed('communityEvent', [eventRow('e1', opts.event)]);

  const overrides: Record<string, unknown> = { 'community.rep_post': 0, ...opts.config };
  const config = { get: async (key: string, fallback: unknown) => (key in overrides ? overrides[key] : fallback) };
  const rewards = new RewardPointsService(prisma, config as never);
  const reward = new CommunityRewardService(prisma, rewards, config as never);
  const notify = jest.fn().mockResolvedValue(undefined);
  const feed = new CommunityFeedService(prisma, reward, config as never, {} as never, { notify } as never);

  const post = (userId: string, over: Record<string, unknown> = {}) =>
    feed.createPost(userId, 'CUSTOMER', { kind: 'SHOWCASE', body: 'Vườn sen đá của tôi', eventId: 'e1', ...over } as never);
  const enter = (userId: string, eventId = 'e1', over: Record<string, unknown> = {}) => db.seed('feedPost', [eventEntry(`p-${userId}-${eventId}`, userId, eventId, over)]);
  const pick = (userId: string, eventId = 'e1') => feed.pickWinner(eventId, userId);
  const close = (eventId = 'e1') => feed.closeEvent(eventId);

  const ev = (id = 'e1') => db.row('communityEvent', id)!;
  const wins = (id = 'e1') => db.rows('pointsTransaction').filter((t) => String(t.reason).startsWith(`COMMUNITY_EVENT_WIN:${id}:`));
  const postRows = (eventId: string | null = 'e1') => db.rows('feedPost').filter((p) => p.metaEventId === eventId);
  const balance = (id: string) => db.row('user', id)!.pointsBalance as number;
  const ledgerSum = (id: string) => db.rows('pointsTransaction').filter((t) => t.userId === id).reduce((s, t) => s + (t.delta as number), 0);
  const events = (title?: string) => db.rows('communityEvent').filter((e) => !title || e.title === title);
  return { db, feed, reward, notify, post, enter, pick, close, ev, wins, postRows, balance, ledgerSum, events };
}

/** Chạy hai việc lệch nhau `skew` nhịp: skew > 0 thì việc thứ hai bắt đầu trước. */
const race = <A, B>(skew: number, a: () => Promise<A>, b: () => Promise<B>) =>
  Promise.allSettled([(async () => (await delay(Math.max(skew, 0)), a()))(), (async () => (await delay(Math.max(-skew, 0)), b()))()]);

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('Sự kiện cộng đồng: đăng bài dự thi (createPost với eventId)', () => {
  it('một người gửi cùng bài dự thi hai lần song song (quét thời điểm): một bài, cùng id, một khoản thưởng đăng bài', async () => {
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      const [a, b] = await race(skew, () => h.post('u1'), () => h.post('u1'));
      const label = `skew ${skew}`;
      is(label, [a.status, b.status], ['fulfilled', 'fulfilled']);
      is(label, (a as PromiseFulfilledResult<{ id: string }>).value.id, (b as PromiseFulfilledResult<{ id: string }>).value.id);
      is(label, h.postRows().length, 1);
      is(label, h.postRows()[0]!.status, 'PUBLISHED');
      is(label, h.db.rows('pointsTransaction').filter((t) => String(t.reason).startsWith('COMMUNITY_POST:')).length, 1);
      is(label, h.ledgerSum('u1'), h.balance('u1'));
      waits += h.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });

  it('bốn lần gửi song song: vẫn một bài, một thưởng', async () => {
    const h = setup();
    const res = await Promise.allSettled([h.post('u1'), h.post('u1'), h.post('u1'), h.post('u1')]);
    expect(res.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect(new Set(res.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id)).size).toBe(1);
    expect(h.postRows()).toHaveLength(1);
    expect(h.db.rows('pointsTransaction').filter((t) => String(t.reason).startsWith('COMMUNITY_POST:'))).toHaveLength(1);
    expect(h.db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('cùng nội dung nhưng khác sự kiện, khác người, hoặc không dự sự kiện nào: mỗi bài vẫn được tạo, không bị nuốt', async () => {
    const h = setup();
    h.db.seed('communityEvent', [eventRow('e2')]);
    const res = await Promise.all([h.post('u1'), h.post('u1', { eventId: 'e2' }), h.post('u1', { eventId: undefined }), h.post('u2')]);
    expect(new Set(res.map((r) => r.id)).size).toBe(4);
    expect(h.postRows('e1').map((p) => p.userId).sort()).toEqual(['u1', 'u2']);
    expect(h.postRows('e2')).toHaveLength(1);
    expect(h.postRows(null)).toHaveLength(1);
  });

  it('bài gửi trước đó đã bị gỡ (REMOVED) hoặc đã quá 5 phút: gửi lại cùng nội dung tạo bài mới', async () => {
    const removed = setup();
    removed.enter('u1', 'e1', { body: 'Vườn sen đá của tôi', status: 'REMOVED' });
    const afterRemoved = await removed.post('u1');
    expect(afterRemoved.id).not.toBe('p-u1-e1');
    expect(removed.postRows()).toHaveLength(2);

    const stale = setup();
    stale.enter('u1', 'e1', { body: 'Vườn sen đá của tôi', createdAt: new Date(Date.now() - 6 * 60_000) });
    const afterStale = await stale.post('u1');
    expect(afterStale.id).not.toBe('p-u1-e1');
    expect(stale.postRows()).toHaveLength(2);

    const fresh = setup();
    fresh.enter('u1', 'e1', { body: 'Vườn sen đá của tôi' });
    expect((await fresh.post('u1')).id).toBe('p-u1-e1');
    expect(fresh.postRows()).toHaveLength(1);
  });

  it('gửi lại bài đang chờ duyệt đúng lúc người đăng vừa thành người tin cậy: nhận lại bài chờ duyệt, không thưởng cho bài chưa đăng', async () => {
    const h = setup();
    h.enter('u1', 'e1', { body: 'Vườn sen đá của tôi', status: 'PENDING' });
    await expect(h.post('u1')).resolves.toEqual({ id: 'p-u1-e1', status: 'PENDING' });
    expect(h.postRows()).toHaveLength(1);
    expect(h.db.rows('pointsTransaction')).toHaveLength(0);
    expect(h.balance('u1')).toBe(0);
  });

  it('sự kiện đã đóng, chưa mở, đã hết hạn nộp hoặc không tồn tại: từ chối bằng câu tiếng Việt, không tạo bài, không thưởng', async () => {
    const cases: [string, Record<string, unknown> | null, string, string][] = [
      ['đã đóng', { status: 'CLOSED' }, 'e1', POST_REFUSED_MSG],
      ['chưa mở', { startAt: new Date(Date.now() + DAY), endAt: new Date(Date.now() + 2 * DAY) }, 'e1', POST_WINDOW_MSG],
      ['đã hết hạn nộp', { startAt: new Date(Date.now() - 2 * DAY), endAt: new Date(Date.now() - DAY) }, 'e1', POST_WINDOW_MSG],
      ['không tồn tại', null, 'nope', POST_REFUSED_MSG],
    ];
    for (const [label, over, eventId, message] of cases) {
      const h = setup({ event: over === null ? null : over });
      const err = await h.post('u1', { eventId }).catch((e: unknown) => e);
      is(label, err instanceof BadRequestException, true);
      is(label, (err as Error).message, message);
      is(label, h.db.rows('feedPost').length, 0);
      is(label, h.db.rows('pointsTransaction').length, 0);
    }
  });

  // Kiểm sự kiện nằm ngoài giao dịch ghi bài nên một bài đã qua kiểm tra vẫn có thể được ghi sau khi đóng đã commit; bài đó không đổi
  // người thắng hay thưởng (pickWinner chỉ chốt khi sự kiện còn OPEN lúc cập nhật), nên test chỉ khoá các bất biến đó.
  it('đăng bài chen với đóng sự kiện (quét thời điểm): hoặc bài vào, hoặc bị từ chối bằng câu tiếng Việt; đóng luôn xong, không ai được thưởng người thắng', async () => {
    const seen = new Set<string>();
    for (const skew of SWEEP) {
      const h = setup();
      const [c, p] = await race(skew, () => h.close(), () => h.post('u2'));
      const label = `skew ${skew}`;
      is(label, c.status, 'fulfilled');
      is(label, [h.ev().status, h.ev().winnerUserId], ['CLOSED', null]);
      is(label, h.wins().length, 0);
      if (p.status === 'fulfilled') {
        is(label, h.postRows().length, 1);
        is(label, h.postRows()[0]!.userId, 'u2');
        is(label, h.postRows()[0]!.status, 'PUBLISHED');
        seen.add('posted');
      } else {
        is(label, reasonOf(p) instanceof BadRequestException, true);
        is(label, reasonOf(p)!.message, POST_REFUSED_MSG);
        is(label, h.db.rows('feedPost').length, 0);
        is(label, h.db.rows('pointsTransaction').length, 0);
        seen.add('refused');
      }
    }
    expect(seen).toEqual(new Set(['posted', 'refused']));
  });

  it('đăng bài chen với chọn người thắng (quét thời điểm): người thắng vẫn là người được chọn, đúng một thưởng; bài đến sau không đổi kết quả', async () => {
    const seen = new Set<string>();
    for (const skew of SWEEP) {
      const h = setup();
      h.enter('u1');
      const [w, p] = await race(skew, () => h.pick('u1'), () => h.post('u3'));
      const label = `skew ${skew}`;
      is(label, w.status === 'fulfilled' ? (w as PromiseFulfilledResult<unknown>).value : null, { ok: true, rewarded: true });
      is(label, h.ev().winnerUserId, 'u1');
      is(label, h.ev().status, 'CLOSED');
      is(label, h.wins().map((t) => [t.userId, t.delta]), [['u1', POINTS]]);
      is(label, h.balance('u1'), POINTS);
      is(label, h.notify.mock.calls.map((c) => c[0]), ['u1']);
      if (p.status === 'fulfilled') {
        is(label, h.postRows().filter((r) => r.userId === 'u3').length, 1);
        seen.add('posted');
      } else {
        is(label, reasonOf(p)!.message, POST_REFUSED_MSG);
        is(label, h.postRows().filter((r) => r.userId === 'u3').length, 0);
        seen.add('refused');
      }
    }
    expect(seen).toEqual(new Set(['posted', 'refused']));
  });
});

describe('Sự kiện cộng đồng: chọn người thắng (pickWinner)', () => {
  it('hai quản trị chọn hai người khác nhau (quét thời điểm): đúng một người thắng và một khoản thưởng, người kia nhận câu tiếng Việt, không được báo', async () => {
    const winners = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      h.enter('u1');
      h.enter('u2');
      const [a, b] = await race(skew, () => h.pick('u1'), () => h.pick('u2'));
      const label = `skew ${skew}`;
      is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
      const [won, wonId, lost, lostId] = a.status === 'fulfilled' ? [a, 'u1', b, 'u2'] : [b, 'u2', a, 'u1'];
      is(label, (won as PromiseFulfilledResult<unknown>).value, { ok: true, rewarded: true });
      is(label, reasonOf(lost as PromiseSettledResult<unknown>) instanceof BadRequestException, true);
      is(label, reasonOf(lost as PromiseSettledResult<unknown>)!.message, CLOSED_MSG);
      is(label, h.ev().winnerUserId, wonId);
      is(label, h.ev().status, 'CLOSED');
      is(label, h.wins().map((t) => [t.userId, t.delta]), [[wonId, POINTS]]);
      is(label, [h.balance(wonId as string), h.balance(lostId as string)], [POINTS, 0]);
      is(label, h.ledgerSum(wonId as string), POINTS);
      is(label, h.notify.mock.calls.map((c) => c[0]), [wonId]);
      winners.add(wonId as string);
      waits += h.db.stats.lockWaits;
    }
    expect(winners).toEqual(new Set(['u1', 'u2']));
    expect(waits).toBeGreaterThan(0);
  });

  it('hai quản trị chọn cùng một người (bấm đúp, hai máy): một lần thưởng, lần hai nhận câu tiếng Việt', async () => {
    for (const skew of SWEEP) {
      const h = setup();
      h.enter('u1');
      const [a, b] = await race(skew, () => h.pick('u1'), () => h.pick('u1'));
      const label = `skew ${skew}`;
      is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
      const lost = a.status === 'fulfilled' ? b : a;
      is(label, reasonOf(lost)!.message, CLOSED_MSG);
      is(label, h.wins().length, 1);
      is(label, h.balance('u1'), POINTS);
      is(label, h.notify.mock.calls.length, 1);
    }
  });

  it('đóng sự kiện chen với chọn người thắng (quét thời điểm): hoặc người thắng được thưởng một lần, hoặc đóng trước và không ai được thưởng; đóng không ghi đè người thắng', async () => {
    const seen = new Set<string>();
    for (const skew of SWEEP) {
      const h = setup();
      h.enter('u1');
      const [c, w] = await race(skew, () => h.close(), () => h.pick('u1'));
      const label = `skew ${skew}`;
      is(label, c.status === 'fulfilled' ? (c as PromiseFulfilledResult<unknown>).value : null, { ok: true });
      is(label, h.ev().status, 'CLOSED');
      if (w.status === 'fulfilled') {
        is(label, h.ev().winnerUserId, 'u1');
        is(label, h.wins().length, 1);
        is(label, h.balance('u1'), POINTS);
        is(label, h.notify.mock.calls.length, 1);
        seen.add('picked');
      } else {
        is(label, reasonOf(w) instanceof BadRequestException, true);
        is(label, reasonOf(w)!.message, CLOSED_MSG);
        is(label, h.ev().winnerUserId, null);
        is(label, h.wins().length, 0);
        is(label, h.balance('u1'), 0);
        is(label, h.notify.mock.calls.length, 0);
        seen.add('closed-first');
      }
      is(label, h.ledgerSum('u1'), h.balance('u1'));
    }
    expect(seen).toEqual(new Set(['picked', 'closed-first']));
  });

  it('chỉ người có bài PUBLISHED trong đúng sự kiện này mới chọn được; sự kiện đã đóng báo "đã đóng" trước, không nhầm sang lỗi người dự thi', async () => {
    const closed = setup({ event: { status: 'CLOSED', winnerUserId: 'u3' } });
    const closedErr = await closed.pick('u2').catch((e: unknown) => e);
    expect(closedErr).toBeInstanceOf(BadRequestException);
    expect((closedErr as Error).message).toBe(CLOSED_MSG);

    const h = setup();
    h.db.seed('communityEvent', [eventRow('e2')]);
    h.enter('u1', 'e2');
    h.enter('u2', 'e1', { status: 'PENDING' });
    h.enter('u2', 'e1', { id: 'p-u2-removed', status: 'REMOVED' });
    const cases: [string, () => Promise<unknown>, new (...a: never[]) => Error, string][] = [
      ['sự kiện không tồn tại', () => h.pick('u1', 'nope'), NotFoundException, 'Sự kiện không tồn tại.'],
      ['người dùng không tồn tại', () => h.pick('ghost'), NotFoundException, 'Người dùng không tồn tại.'],
      ['chưa đăng gì', () => h.pick('u3'), BadRequestException, NOT_ENTRANT_MSG],
      ['bài chờ duyệt và bài bị gỡ', () => h.pick('u2'), BadRequestException, NOT_ENTRANT_MSG],
      ['chỉ có bài của sự kiện khác', () => h.pick('u1'), BadRequestException, NOT_ENTRANT_MSG],
    ];
    for (const [label, run, type, message] of cases) {
      const err = await run().catch((e: unknown) => e);
      is(label, err instanceof type, true);
      is(label, (err as Error).message, message);
    }
    expect(h.ev()).toMatchObject({ status: 'OPEN', winnerUserId: null });
    expect(h.ev('e2')).toMatchObject({ status: 'OPEN', winnerUserId: null });
    expect(h.db.rows('pointsTransaction')).toHaveLength(0);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('cộng thưởng lỗi: sự kiện vẫn OPEN, không dòng sổ, không tin báo, câu tiếng Việt; sửa số điểm rồi chọn lại được', async () => {
    const h = setup({ event: { rewardPoints: 2_000_001 } });
    h.enter('u1');
    const err = await h.pick('u1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect((err as Error).message).toBe('Thưởng Điểm Xanh không hợp lệ, đã báo quản trị viên.');
    expect(h.ev()).toMatchObject({ status: 'OPEN', winnerUserId: null });
    expect(h.wins()).toHaveLength(0);
    expect(h.balance('u1')).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();

    h.db.seed('communityEvent', [eventRow('e1', { rewardPoints: POINTS })]);
    await expect(h.pick('u1')).resolves.toEqual({ ok: true, rewarded: true });
    expect(h.ev()).toMatchObject({ status: 'CLOSED', winnerUserId: 'u1' });
    expect(h.wins()).toHaveLength(1);
  });

  it('sự kiện không có thưởng: vẫn chốt người thắng, rewarded false, không dòng sổ; tin báo không hứa điểm', async () => {
    const h = setup({ event: { rewardPoints: 0 } });
    h.enter('u1');
    await expect(h.pick('u1')).resolves.toEqual({ ok: true, rewarded: false });
    expect(h.ev()).toMatchObject({ status: 'CLOSED', winnerUserId: 'u1' });
    expect(h.db.rows('pointsTransaction')).toHaveLength(0);
    expect(h.notify).toHaveBeenCalledWith('u1', 'COMMUNITY_EVENT_WINNER', { title: 'Thi khoe vườn', reward: '' });
  });

  it('báo người thắng kèm số điểm; báo lỗi không làm hỏng việc đã chốt', async () => {
    const ok = setup();
    ok.enter('u1');
    await ok.pick('u1');
    expect(ok.notify).toHaveBeenCalledTimes(1);
    expect(ok.notify).toHaveBeenCalledWith('u1', 'COMMUNITY_EVENT_WINNER', { title: 'Thi khoe vườn', reward: ' Bạn được thưởng 30.000 Điểm Xanh.' });

    const broken = setup();
    broken.enter('u1');
    broken.notify.mockRejectedValueOnce(new Error('zalo timeout'));
    await expect(broken.pick('u1')).resolves.toEqual({ ok: true, rewarded: true });
    expect(broken.ev()).toMatchObject({ status: 'CLOSED', winnerUserId: 'u1' });
    expect(broken.wins()).toHaveLength(1);
  });

  it('khoá idempotency của thưởng theo người: một người nhận một lần; nhưng hai người khác nhau cùng sự kiện đều nhận được, nên chỉ phép đóng có điều kiện chặn trả thưởng đôi', async () => {
    const h = setup();
    const expiresAt = await h.reward.expiresAt();
    await expect(h.reward.rewardEventWinner('u1', 'e1', POINTS, undefined, expiresAt)).resolves.toBe(true);
    await expect(h.reward.rewardEventWinner('u1', 'e1', POINTS, undefined, expiresAt)).resolves.toBe(false);
    expect(h.wins()).toHaveLength(1);
    expect(h.balance('u1')).toBe(POINTS);
    await expect(h.reward.rewardEventWinner('u2', 'e1', POINTS, undefined, expiresAt)).resolves.toBe(true);
    expect(h.wins().map((t) => t.userId).sort()).toEqual(['u1', 'u2']);
  });
});

describe('Sự kiện cộng đồng: đóng sự kiện (closeEvent)', () => {
  it('đóng sau khi đã chốt người thắng: giữ nguyên người thắng và sổ điểm; đóng hai lần cũng không đổi gì', async () => {
    const h = setup();
    h.enter('u1');
    await h.pick('u1');
    await expect(h.close()).resolves.toEqual({ ok: true });
    await expect(h.close()).resolves.toEqual({ ok: true });
    expect(h.ev()).toMatchObject({ status: 'CLOSED', winnerUserId: 'u1' });
    expect(h.wins()).toHaveLength(1);
    expect(h.balance('u1')).toBe(POINTS);
  });

  it('đóng không chọn người thắng rồi chọn: bị từ chối, không ai được thưởng (không có đường mở lại)', async () => {
    const h = setup();
    h.enter('u1');
    await h.close();
    const err = await h.pick('u1').catch((e: unknown) => e);
    expect((err as Error).message).toBe(CLOSED_MSG);
    expect(h.ev()).toMatchObject({ status: 'CLOSED', winnerUserId: null });
    expect(h.wins()).toHaveLength(0);
  });
});

describe('Sự kiện cộng đồng: tạo sự kiện (createEvent)', () => {
  const dto = (over: Record<string, unknown> = {}) => ({
    title: 'Thử thách xanh',
    startAt: new Date('2026-12-01T02:00:00Z'),
    endAt: new Date('2026-12-08T02:00:00Z'),
    rewardPoints: POINTS,
    ...over,
  });

  it('hai yêu cầu y hệt song song (quét thời điểm): một sự kiện, cùng id', async () => {
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup({ event: null });
      const [a, b] = await race(skew, () => h.feed.createEvent(dto()), () => h.feed.createEvent(dto()));
      const label = `skew ${skew}`;
      is(label, [a.status, b.status], ['fulfilled', 'fulfilled']);
      is(label, (a as PromiseFulfilledResult<{ id: string }>).value.id, (b as PromiseFulfilledResult<{ id: string }>).value.id);
      is(label, h.events().length, 1);
      waits += h.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });

  it('khác quà, khác giờ, hoặc sự kiện cũ đã đóng, đã quá 5 phút: tạo sự kiện mới', async () => {
    const h = setup({ event: null });
    const base = await h.feed.createEvent(dto());
    const [otherReward, otherEnd] = await Promise.all([h.feed.createEvent(dto({ rewardPoints: POINTS + 1000 })), h.feed.createEvent(dto({ endAt: new Date('2026-12-09T02:00:00Z') }))]);
    expect(new Set([base.id, otherReward.id, otherEnd.id]).size).toBe(3);

    await h.close(base.id);
    const again = await h.feed.createEvent(dto());
    expect(again.id).not.toBe(base.id);

    h.db.seed('communityEvent', [eventRow('old', { title: 'Cũ', startAt: new Date('2026-12-01T02:00:00Z'), endAt: new Date('2026-12-08T02:00:00Z'), rewardPoints: POINTS, createdAt: new Date(Date.now() - 6 * 60_000) })]);
    const afterStale = await h.feed.createEvent(dto({ title: 'Cũ' }));
    expect(afterStale.id).not.toBe('old');
    expect(h.events()).toHaveLength(6);
  });

  it('tiêu đề chỉ khác khoảng trắng hai đầu là cùng một sự kiện; giờ kết thúc không sau giờ bắt đầu bị từ chối bằng câu tiếng Việt', async () => {
    const h = setup({ event: null });
    const [a, b] = await Promise.all([h.feed.createEvent(dto()), h.feed.createEvent(dto({ title: '  Thử thách xanh  ' }))]);
    expect(a.id).toBe(b.id);
    const err = await h.feed.createEvent(dto({ endAt: new Date('2026-11-30T02:00:00Z') })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe('Thời gian kết thúc phải sau thời gian bắt đầu.');
  });
});
