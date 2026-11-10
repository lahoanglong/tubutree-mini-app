import { BadRequestException, Logger } from '@nestjs/common';
import { delay, setupGroupBuy, violations, type GroupBuySetup } from '../../../test/fakes/w102a-helpers';

/**
 * Mua chung: tham gia, chốt đủ người và phát mã giảm chạy đồng thời (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts).
 * GroupBuyService THẬT chạy trên cơ sở dữ liệu giả có khoá dòng + xét lại WHERE sau khoá + unique + advisory lock; chỉ DB, cấu hình và
 * thông báo được giả. Đồng hồ là đồng hồ giả (chỉ Date), mỗi câu SQL của test tiến 1ms để hạn nhóm có thể rơi vào GIỮA hai câu của `join`.
 *
 * Bất biến sau mọi xen kẽ (helpers `violations`): số thành viên == currentSize <= targetSize, nhóm SUCCESS đủ người, nhóm chưa SUCCESS không có
 * mã, mỗi thành viên không quá một mã, mã báo không quá một lần, couponsGrantedAt chỉ đặt khi mọi thành viên có mã.
 *
 * Không kiểm được trên DB giả: khoá KEY SHARE của khoá ngoại thành viên→nhóm, deadlock 40P01, pool kết nối, timeout.
 * Trần số nhóm mở của một khách đã có test Postgres thật (integration-race/groupbuy-max-open); ở đây thêm bản chạy được ở máy.
 */
const T0 = Date.parse('2026-11-10T03:00:00.000Z');
// Các lần quét thời điểm chạy hàng trăm lượt dựng DB giả; máy đang tải không được làm chúng hết giờ mặc định 5 giây.
jest.setTimeout(30_000);
const FULL_OR_CLOSED = 'Nhóm đã đủ người hoặc đã đóng.';
const CLOSED = 'Nhóm đã đóng.';
const EXPIRED = 'Nhóm đã hết hạn.';
const ALREADY = 'Bạn đã tham gia nhóm này rồi.';

const stepClock = () => jest.setSystemTime(Date.now() + 1);
const fulfilled = <T>(r: PromiseSettledResult<T>): r is PromiseFulfilledResult<T> => r.status === 'fulfilled';
const rejected = (r: PromiseSettledResult<unknown>): r is PromiseRejectedResult => r.status === 'rejected';
const messageOf = (r: PromiseRejectedResult) => {
  expect(r.reason).toBeInstanceOf(BadRequestException);
  return (r.reason as Error).message;
};
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const clean = (label: string, s: GroupBuySetup) => is(label, violations(s), []);
const later = <T>(n: number, work: () => Promise<T>) => async () => (await delay(n), work());

beforeEach(() => {
  jest.useFakeTimers({
    now: T0,
    doNotFake: ['setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
  });
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('GroupBuyService.join — tranh chỗ', () => {
  it('hai người tranh chỗ cuối (quét thời điểm): đúng một người vào, nhóm đủ target, bên thua nhận câu tiếng Việt và không còn dòng thành viên', async () => {
    const messages = new Set<string>();
    let lockWaits = 0;
    let rollbacks = 0;
    for (let skew = -60; skew <= 60; skew++) {
      const label = `skew ${skew}`;
      const s = setupGroupBuy();
      const gid = s.seedGroup({ targetSize: 3, members: ['owner', 'u1'] });
      const [a, b] = await Promise.allSettled([later(Math.max(skew, 0), () => s.svc.join('u2', gid))(), later(Math.max(-skew, 0), () => s.svc.join('u3', gid))()]);
      const won = [a, b].filter(fulfilled);
      const lost = [a, b].filter(rejected);
      is(label, [won.length, lost.length], [1, 1]);
      messages.add(messageOf(lost[0]!));
      is(label, won[0]!.value, { joined: true, currentSize: 3, status: 'SUCCESS' });
      const winner = fulfilled(a) ? 'u2' : 'u3';
      is(label, s.membersOf(gid).sort(), ['owner', 'u1', winner].sort());
      expect(s.db.row('groupBuy', gid)).toMatchObject({ currentSize: 3, status: 'SUCCESS' });
      is(label, s.couponsOf(gid).length, 3);
      is(label, s.db.row('groupBuy', gid)!.couponsGrantedAt instanceof Date, true);
      for (const u of ['owner', 'u1', winner]) is(label, s.successNotices(u).length, 1);
      clean(label, s);
      lockWaits += s.db.stats.lockWaits;
      rollbacks += s.db.stats.rollbacks;
    }
    // Cả hai đường từ chối đều gặp: kiểm trước khi vào transaction ("đã đóng") và guard trong transaction ("đã đủ người hoặc đã đóng").
    expect([...messages].sort()).toEqual([CLOSED, FULL_OR_CLOSED].sort());
    expect(lockWaits).toBeGreaterThan(0);
    expect(rollbacks).toBeGreaterThan(0); // dòng thành viên của bên thua đã chèn rồi bị huỷ theo transaction
  });

  it.each([1, 2, 3, 5])(
    'ba người cùng vào nhóm còn nhiều chỗ (cách nhau %i nhịp): currentSize tăng đúng ba, bằng số thành viên, không ghi đè theo bản đọc cũ',
    async (gap) => {
      const s = setupGroupBuy();
      const gid = s.seedGroup({ targetSize: 6, members: ['owner'] });
      const joiners = ['u1', 'u2', 'u3'];
      const settled = await Promise.allSettled(joiners.map((u, i) => later(i * gap, () => s.svc.join(u, gid))()));
      expect(settled.every(fulfilled)).toBe(true);
      const sizes = settled.filter(fulfilled).map((r) => r.value.currentSize).sort();
      expect(sizes).toEqual([2, 3, 4]);
      expect(s.db.row('groupBuy', gid)).toMatchObject({ currentSize: 4, status: 'OPEN' });
      expect(s.membersOf(gid).sort()).toEqual(['owner', 'u1', 'u2', 'u3']);
      expect(s.couponsOf(gid)).toHaveLength(0);
      expect(violations(s)).toEqual([]);
    },
  );

  it.each([0, 1, 2, 3, 5])(
    'năm người tranh ba chỗ còn lại (cách nhau %i nhịp): đúng ba người vào, nhóm đủ năm, năm mã, hai người còn lại bị từ chối',
    async (gap) => {
      const s = setupGroupBuy();
      const gid = s.seedGroup({ targetSize: 5, members: ['owner', 'u1'] });
      const joiners = ['u2', 'u3', 'u4', 'u5', 'u6'];
      const settled = await Promise.allSettled(joiners.map((u, i) => later(i * gap, () => s.svc.join(u, gid))()));
      expect(settled.filter(fulfilled)).toHaveLength(3);
      for (const r of settled.filter(rejected)) expect([CLOSED, FULL_OR_CLOSED]).toContain(messageOf(r));
      expect(settled.filter(rejected)).toHaveLength(2);
      expect(s.db.row('groupBuy', gid)).toMatchObject({ currentSize: 5, status: 'SUCCESS' });
      expect(s.membersOf(gid)).toHaveLength(5);
      expect(s.couponsOf(gid)).toHaveLength(5);
      for (const u of s.membersOf(gid)) expect(s.successNotices(u)).toHaveLength(1);
      expect(violations(s)).toEqual([]);
    },
  );
});

describe('GroupBuyService.join — nhóm đã đủ hoặc đã quá hạn từ trước', () => {
  it('nhóm quá hạn mà cron chưa đóng (vẫn OPEN): từ chối bằng câu "đã hết hạn" ngay từ bước kiểm trước, không chèn thành viên', async () => {
    const s = setupGroupBuy();
    const gid = s.seedGroup({ targetSize: 3, members: ['owner', 'u1'], expiresAt: new Date(T0 - 1000) });
    await expect(s.svc.join('u2', gid)).rejects.toThrow(EXPIRED);
    expect(s.membersOf(gid).sort()).toEqual(['owner', 'u1']);
    expect(s.db.row('groupBuy', gid)).toMatchObject({ currentSize: 2, status: 'OPEN' });
  });

  // target_size = 1: create() ghi nhóm OPEN với currentSize 1 (= target) rồi mới lật SUCCESS ở câu sau, ngoài transaction tạo. Trong khoảng đó nhóm
  // vẫn OPEN nên chỉ guard `currentSize < targetSize` ở câu tăng chỗ chặn người khác vào, kẻo nhóm một người thành hai người rồi mới SUCCESS.
  it('target_size = 1: người khác vào đúng lúc nhóm vừa tạo chưa kịp lật SUCCESS bị từ chối, nhóm vẫn một người và chỉ người mở nhóm nhận mã', async () => {
    const s = setupGroupBuy({ config: { 'groupbuy.target_size': 1 } });
    let intruder: Promise<unknown> | undefined;
    s.hooks.before = (name, args) => {
      if (name !== 'groupBuy.updateMany' || args?.data?.status !== 'SUCCESS' || intruder) return;
      intruder = s.svc.join('u2', s.db.rows('groupBuy')[0]!.id as string).catch((e: unknown) => e);
      return intruder;
    };
    const created = await s.svc.create('u1', 'p1');
    expect(created).toMatchObject({ status: 'SUCCESS', currentSize: 1 });
    expect(((await intruder) as Error).message).toBe(FULL_OR_CLOSED);
    const gid = created.id;
    expect(s.membersOf(gid)).toEqual(['u1']);
    expect(s.db.row('groupBuy', gid)).toMatchObject({ currentSize: 1, targetSize: 1, status: 'SUCCESS' });
    expect(s.couponsOf(gid)).toHaveLength(1);
    expect(s.successNotices('u1')).toHaveLength(1);
    expect(s.successNotices('u2')).toHaveLength(0);
    expect(violations(s)).toEqual([]);
  });
});

describe('GroupBuyService.join — cùng một người', () => {
  it('bấm đúp (hai lần tham gia song song, quét thời điểm): một dòng thành viên, currentSize tăng đúng một, lần thứ hai nhận "đã tham gia"', async () => {
    let rollbacks = 0;
    for (let skew = -40; skew <= 40; skew++) {
      const label = `skew ${skew}`;
      const s = setupGroupBuy();
      const gid = s.seedGroup({ targetSize: 4, members: ['owner', 'u1'] });
      const [a, b] = await Promise.allSettled([later(Math.max(skew, 0), () => s.svc.join('u2', gid))(), later(Math.max(-skew, 0), () => s.svc.join('u2', gid))()]);
      is(label, [[a, b].filter(fulfilled).length, [a, b].filter(rejected).length], [1, 1]);
      is(label, messageOf([a, b].find(rejected)!), ALREADY);
      is(label, s.membersOf(gid).filter((u) => u === 'u2').length, 1);
      expect(s.db.row('groupBuy', gid)).toMatchObject({ currentSize: 3, status: 'OPEN' });
      clean(label, s);
      rollbacks += s.db.stats.rollbacks;
    }
    expect(rollbacks).toBeGreaterThan(0); // đường P2002 trong transaction đã chạy ở ít nhất một lần quét
  });

  it('ba lần tham gia song song của một người vào nhóm còn một chỗ: một lần thắng và chốt nhóm, mã chỉ cấp một lần cho mỗi thành viên', async () => {
    for (let gap = 0; gap <= 4; gap++) {
      const label = `cách ${gap}`;
      const s = setupGroupBuy();
      const gid = s.seedGroup({ targetSize: 3, members: ['owner', 'u1'] });
      const settled = await Promise.allSettled([0, 1, 2].map((i) => later(i * gap, () => s.svc.join('u2', gid))()));
      is(label, settled.filter(fulfilled).length, 1);
      for (const r of settled.filter(rejected)) is(label, [ALREADY, CLOSED, FULL_OR_CLOSED].includes(messageOf(r)), true);
      is(label, s.membersOf(gid).sort(), ['owner', 'u1', 'u2']);
      expect(s.db.row('groupBuy', gid)).toMatchObject({ currentSize: 3, status: 'SUCCESS' });
      is(label, s.couponsOf(gid).length, 3);
      for (const u of ['owner', 'u1', 'u2']) is(label, s.successNotices(u).length, 1);
      clean(label, s);
    }
  });

  it('người mở nhóm tự vào nhóm của mình (một lần và ba lần song song): luôn "đã tham gia", vẫn một thành viên, currentSize 1', async () => {
    const s = setupGroupBuy();
    const created = await s.svc.create('owner', 'p1');
    expect(created).toMatchObject({ currentSize: 1, joined: true, isOwner: true, status: 'OPEN' });
    const gid = created.id;
    await expect(s.svc.join('owner', gid)).rejects.toThrow(ALREADY);
    const settled = await Promise.allSettled([0, 1, 2].map((i) => later(i, () => s.svc.join('owner', gid))()));
    for (const r of settled) expect(rejected(r) && messageOf(r)).toBe(ALREADY);
    expect(s.membersOf(gid)).toEqual(['owner']);
    expect(s.db.row('groupBuy', gid)).toMatchObject({ currentSize: 1, status: 'OPEN' });
    expect(s.couponsOf(gid)).toHaveLength(0);
    expect(violations(s)).toEqual([]);
  });
});

describe('GroupBuyService.join — chen với cron hết hạn', () => {
  // Mỗi câu SQL tiến đồng hồ 1ms; hạn nhóm quét từ "đã hết hạn lúc bắt đầu" tới "hết hạn sau khi join xong" nên hạn rơi vào mọi chỗ giữa các câu
  // của join (kiểm trước, tăng chỗ, lật SUCCESS) và của cron (đọc danh sách, lật FAILED).
  it('người vào chỗ cuối chen với cron quét hết hạn (quét hạn × thời điểm): nhóm chỉ đổi trạng thái một lần, không SUCCESS rồi lại FAILED, mã và thông báo khớp trạng thái cuối', async () => {
    const seen = new Set<string>();
    for (let expiryIn = 0; expiryIn <= 40; expiryIn += 2) {
      for (let skew = -12; skew <= 12; skew++) {
        const label = `hạn +${expiryIn}ms, skew ${skew}`;
        jest.setSystemTime(T0);
        const s = setupGroupBuy();
        s.hooks.before = stepClock;
        const gid = s.seedGroup({ targetSize: 3, members: ['owner', 'u1'], expiresAt: new Date(T0 + expiryIn) });
        const [joined, expired] = await Promise.allSettled([later(Math.max(skew, 0), () => s.svc.join('u2', gid))(), later(Math.max(-skew, 0), () => s.svc.expireGroups())()]);
        is(label, expired.status, 'fulfilled');
        const group = s.db.row('groupBuy', gid)!;
        const done = s.flips.filter((f) => f.groupId === gid && f.count === 1);
        is(label, done.length <= 1, true);
        if (done[0]) is(label, group.status, done[0].to);
        clean(label, s);
        const failedNotices = s.notices.filter((n) => n.type === 'GROUP_BUY_FAILED').map((n) => n.userId);
        if (fulfilled(joined)) {
          is(label, [group.status, s.membersOf(gid).includes('u2'), s.couponsOf(gid).length, failedNotices], ['SUCCESS', true, 3, []]);
          is(label, group.couponsGrantedAt instanceof Date, true);
          if (s.flips.some((f) => f.groupId === gid && f.to === 'FAILED' && f.count === 0)) seen.add('join thắng, cron định đóng FAILED nhưng bị guard chặn');
          seen.add('join thắng');
        } else {
          is(label, [EXPIRED, CLOSED, FULL_OR_CLOSED].includes(messageOf(joined as PromiseRejectedResult)), true);
          is(label, s.membersOf(gid).includes('u2'), false);
          is(label, s.couponsOf(gid).length, 0);
          if (group.status === 'FAILED') {
            is(label, failedNotices.sort(), ['owner', 'u1']);
            seen.add('join thua, cron đóng FAILED');
          } else {
            is(label, [group.status, failedNotices], ['OPEN', []]);
            seen.add('join thua, nhóm chưa bị cron đóng');
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(['join thua, cron đóng FAILED', 'join thua, nhóm chưa bị cron đóng', 'join thắng', 'join thắng, cron định đóng FAILED nhưng bị guard chặn'].sort());
  });

  it('hạn qua đúng giữa lúc kiểm trước và lúc tăng chỗ: bị từ chối, dòng thành viên đã chèn bị huỷ, nhóm vẫn 2 người', async () => {
    const s = setupGroupBuy();
    const gid = s.seedGroup({ targetSize: 3, members: ['owner', 'u1'], expiresAt: new Date(T0 + 60_000) });
    s.hooks.before = (name) => {
      if (name === 'groupBuyMember.create') jest.setSystemTime(T0 + 60_001);
    };
    await expect(s.svc.join('u2', gid)).rejects.toThrow(FULL_OR_CLOSED);
    expect(s.membersOf(gid).sort()).toEqual(['owner', 'u1']);
    expect(s.db.row('groupBuy', gid)).toMatchObject({ currentSize: 2, status: 'OPEN' });
    expect(violations(s)).toEqual([]);
  });

  it('cron đóng nhóm FAILED đúng giữa lúc kiểm trước và lúc tăng chỗ: bị từ chối, không vào nhóm đã đóng, currentSize không tăng', async () => {
    const s = setupGroupBuy();
    const gid = s.seedGroup({ targetSize: 3, members: ['owner', 'u1'] });
    let closed = false;
    s.hooks.before = async (name) => {
      if (name !== 'groupBuyMember.create' || closed) return;
      closed = true;
      await s.db.client.groupBuy.updateMany({ where: { id: gid, status: 'OPEN' }, data: { status: 'FAILED' } });
    };
    await expect(s.svc.join('u2', gid)).rejects.toThrow(FULL_OR_CLOSED);
    expect(s.membersOf(gid).sort()).toEqual(['owner', 'u1']);
    expect(s.db.row('groupBuy', gid)).toMatchObject({ currentSize: 2, status: 'FAILED' });
    expect(s.couponsOf(gid)).toHaveLength(0);
    expect(violations(s)).toEqual([]);
  });
});

describe('GroupBuyService — mã giảm chỉ phát một lần cho mỗi thành viên', () => {
  const STUCK_SUCCESS = { targetSize: 3, members: ['owner', 'u1', 'u2'], status: 'SUCCESS' as const };

  it('hai lần đối soát chạy chồng nhau trên nhóm SUCCESS chưa phát mã (quét thời điểm): ba mã, mỗi người một thông báo, đã đánh dấu phát đủ', async () => {
    let both = 0;
    for (let skew = -40; skew <= 40; skew++) {
      const label = `skew ${skew}`;
      const s = setupGroupBuy();
      const gid = s.seedGroup(STUCK_SUCCESS);
      const [a, b] = await Promise.all([later(Math.max(skew, 0), () => s.svc.reconcileSuccessfulGroups())(), later(Math.max(-skew, 0), () => s.svc.reconcileSuccessfulGroups())()]);
      is(label, s.couponsOf(gid).length, 3);
      for (const u of STUCK_SUCCESS.members) is(label, s.successNotices(u).length, 1);
      is(label, s.db.row('groupBuy', gid)!.couponsGrantedAt instanceof Date, true);
      is(label, a + b >= 1, true);
      clean(label, s);
      if (a === 1 && b === 1) both += 1;
    }
    expect(both).toBeGreaterThan(0); // có lần quét cả hai bên cùng thấy nhóm chưa phát và cùng đua tạo mã
  });

  it('người vào chỗ cuối chốt nhóm trong khi cron đối soát chạy (quét thời điểm): ba mã, mỗi người một thông báo, đã đánh dấu phát đủ', async () => {
    const seen = new Set<string>();
    for (let skew = -90; skew <= 90; skew++) {
      const label = `skew ${skew}`;
      const s = setupGroupBuy();
      const gid = s.seedGroup({ targetSize: 3, members: ['owner', 'u1'] });
      const [joined, fixed] = await Promise.all([later(Math.max(skew, 0), () => s.svc.join('u2', gid))(), later(Math.max(-skew, 0), () => s.svc.reconcileSuccessfulGroups())()]);
      is(label, joined, { joined: true, currentSize: 3, status: 'SUCCESS' });
      is(label, s.couponsOf(gid).length, 3);
      for (const u of ['owner', 'u1', 'u2']) is(label, s.successNotices(u).length, 1);
      is(label, s.db.row('groupBuy', gid)!.couponsGrantedAt instanceof Date, true);
      clean(label, s);
      seen.add(fixed === 0 ? 'đối soát không thấy nhóm cần phát' : 'đối soát phát chen với người chốt');
    }
    expect([...seen].sort()).toEqual(['đối soát không thấy nhóm cần phát', 'đối soát phát chen với người chốt']);
  });

  it('lỗi DB giữa chừng khi cấp mã (thành viên thứ hai): người chốt vẫn được trả SUCCESS, chưa đánh dấu; đối soát cấp nốt đúng một mã còn thiếu và không báo lại hai người đã có', async () => {
    const s = setupGroupBuy();
    const gid = s.seedGroup({ targetSize: 3, members: ['owner', 'u1'] });
    let creates = 0;
    s.hooks.before = (name) => {
      if (name === 'coupon.create' && ++creates === 2) throw new Error('db down');
    };
    await expect(s.svc.join('u2', gid)).resolves.toEqual({ joined: true, currentSize: 3, status: 'SUCCESS' });
    expect(s.couponsOf(gid)).toHaveLength(2);
    expect(s.db.row('groupBuy', gid)!.couponsGrantedAt).toBeNull();
    expect(s.notices.filter((n) => n.type === 'GROUP_BUY_SUCCESS')).toHaveLength(2);

    await expect(s.svc.reconcileSuccessfulGroups()).resolves.toBe(1);
    expect(s.couponsOf(gid)).toHaveLength(3);
    for (const u of ['owner', 'u1', 'u2']) expect(s.successNotices(u)).toHaveLength(1);
    expect(s.db.row('groupBuy', gid)!.couponsGrantedAt).toBeInstanceOf(Date);
    await expect(s.svc.reconcileSuccessfulGroups()).resolves.toBe(0);
    expect(s.couponsOf(gid)).toHaveLength(3);
    expect(violations(s)).toEqual([]);
  });

  it('lỗi giữa chừng rồi hai lần đối soát chạy chồng (quét thời điểm): vẫn đúng ba mã, mỗi người đúng một thông báo', async () => {
    for (let skew = -40; skew <= 40; skew++) {
      const label = `skew ${skew}`;
      const s = setupGroupBuy();
      const gid = s.seedGroup(STUCK_SUCCESS);
      let creates = 0;
      s.hooks.before = (name) => {
        if (name === 'coupon.create' && ++creates === 2) throw new Error('db down');
      };
      await Promise.all([later(Math.max(skew, 0), () => s.svc.reconcileSuccessfulGroups())(), later(Math.max(-skew, 0), () => s.svc.reconcileSuccessfulGroups())()]);
      await s.svc.reconcileSuccessfulGroups(); // lần quét 15 phút sau nếu hai lần chồng nhau chưa phát đủ
      is(label, s.couponsOf(gid).length, 3);
      for (const u of STUCK_SUCCESS.members) is(label, s.successNotices(u).length, 1);
      is(label, s.db.row('groupBuy', gid)!.couponsGrantedAt instanceof Date, true);
      clean(label, s);
    }
  });

  it('người chốt đã ghi nhóm SUCCESS nhưng lệnh cấp mã nổ sau commit (máy chủ trả lỗi, nhóm vẫn đủ người): đối soát cấp đủ mã và báo mỗi người một lần', async () => {
    const s = setupGroupBuy();
    const gid = s.seedGroup({ targetSize: 3, members: ['owner', 'u1'] });
    let lookups = 0;
    s.hooks.before = (name) => {
      // product.findUnique: lần 1-2 là kiểm trước của join; lần 3 là closeIfPartnerGoods đầu tiên của onSuccess, sau khi transaction đã commit.
      if (name === 'product.findUnique' && ++lookups === 3) throw new Error('mất kết nối');
    };
    await expect(s.svc.join('u2', gid)).rejects.toThrow('mất kết nối');
    expect(s.db.row('groupBuy', gid)).toMatchObject({ status: 'SUCCESS', currentSize: 3, couponsGrantedAt: null });
    expect(s.membersOf(gid).sort()).toEqual(['owner', 'u1', 'u2']);
    expect(s.couponsOf(gid)).toHaveLength(0);

    await expect(s.svc.reconcileSuccessfulGroups()).resolves.toBe(1);
    expect(s.couponsOf(gid)).toHaveLength(3);
    for (const u of ['owner', 'u1', 'u2']) expect(s.successNotices(u)).toHaveLength(1);
    expect(violations(s)).toEqual([]);
  });
});

describe('GroupBuyService.create — trần số nhóm mở của một khách', () => {
  const LIMIT_MSG = 'Bạn đang có 3 nhóm mua chung chưa đóng, hãy chờ nhóm cũ hoàn tất.';

  it.each([0, 1, 2, 4])('sáu lần tạo nhóm song song của một khách (cách nhau %i nhịp): đúng 3 nhóm mở, ba lần còn lại nhận câu trần, mỗi nhóm một thành viên', async (gap) => {
    const s = setupGroupBuy({ config: { 'groupbuy.max_open_per_user': 3 } });
    const settled = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => later(i * gap, () => s.svc.create('u1', 'p1'))()));
    expect(settled.filter(fulfilled)).toHaveLength(3);
    for (const r of settled.filter(rejected)) expect(messageOf(r)).toBe(LIMIT_MSG);
    const groups = s.db.rows('groupBuy');
    expect(groups.filter((g) => g.initiatorId === 'u1' && g.status === 'OPEN')).toHaveLength(3);
    for (const g of groups) expect(s.membersOf(g.id)).toEqual(['u1']);
    expect(violations(s)).toEqual([]);
  });

  it('khách khác nhau không chặn nhau: khách u1 đã đủ trần vẫn không ảnh hưởng khách u2 tạo song song', async () => {
    const s = setupGroupBuy({ config: { 'groupbuy.max_open_per_user': 3 } });
    const settled = await Promise.allSettled([...Array.from({ length: 4 }, () => s.svc.create('u1', 'p1')), s.svc.create('u2', 'p1')]);
    expect(settled.filter(fulfilled)).toHaveLength(4);
    expect(s.db.rows('groupBuy').filter((g) => g.initiatorId === 'u2')).toHaveLength(1);
  });
});
