// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncServerClock } from '@tubutree/app-core/server-clock';
import { ApiError, NetworkError } from '@/lib/client-api';
import { loadErrorText } from '@/lib/error-text';
import { formatVnd } from '@/lib/format-vnd';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';

// Mua chung web ↔ Mini (Wave 102A ↔ 89B): máy chủ từ chối "Tham gia" bằng 400/404/409 thì tải lại nhóm và giữ khoá tới lúc đó (có hạn 4 giây);
// mạng/401/5xx không tải lại; nhóm OPEN quá hạn theo GIỜ MÁY CHỦ coi như đã hết hạn dù cron 15 phút chưa đóng; số trong thẻ dùng chữ số đều.

const h = vi.hoisted(() => ({
  calls: [] as string[],
  list: (() => Promise.resolve([])) as () => Promise<unknown>,
  one: (() => Promise.resolve(null)) as (path: string) => Promise<unknown>,
  post: vi.fn(),
}));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, retrySession: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { share: vi.fn() } }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: (path: string) => {
      h.calls.push(path);
      return path === '/group-buy' ? h.list() : h.one(path);
    },
    post: (path: string) => h.post(path),
  },
}));

import { GroupBuyView } from './group-buy-view';

const HOUR = 3600 * 1000;
const GROUP = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  product: { name: `Sản phẩm ${id}`, slug: `sp-${id}`, thumbnail: `https://img.test/${id}.jpg` },
  targetSize: 5,
  currentSize: 2,
  unitPrice: 80_000,
  basePrice: 100_000,
  discountPct: 20,
  status: 'OPEN',
  expiresAt: new Date(Date.now() + 2.5 * HOUR).toISOString(),
  joined: false,
  isOwner: false,
  ...over,
});
const JOIN = 'Tham gia mua chung (−20%)';

const gate = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
/** Mỗi lần gọi trả phần tử kế tiếp (hàm thì gọi để lấy Promise treo/lỗi); hết thì lặp lại phần tử cuối. */
const script = (...replies: unknown[]) => {
  let i = 0;
  return () => {
    const r = replies[Math.min(i++, replies.length - 1)];
    return typeof r === 'function' ? (r as () => Promise<unknown>)() : Promise.resolve(r);
  };
};
const never = () => new Promise<unknown>(() => undefined);

let mounted: Rendered[] = [];
const mount = async (invitedId?: string) => {
  const r = render(<GroupBuyView invitedId={invitedId} />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const btn = (c: HTMLElement, name: string | RegExp) =>
  Array.from(c.querySelectorAll('button')).find((b) => {
    const t = (b.getAttribute('aria-label') ?? b.textContent ?? '').trim();
    return typeof name === 'string' ? t === name : name.test(t);
  });
const tapTogether = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const e of els) e.click();
  });
};
const posts = () => h.post.mock.calls.length;
const gets = (path: string) => h.calls.filter((p) => p === path).length;
const alertText = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent ?? '';
const httpError = (status: number, message: string) => new ApiError(message, status);

beforeEach(() => {
  h.calls = [];
  h.list = script([GROUP('a')]);
  h.one = script(null);
  h.post.mockReset().mockResolvedValue({ joined: true, currentSize: 3, status: 'OPEN' });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  // Độ lệch = Date.parse(iso) − Date.now(): đọc hai lần đồng hồ có thể lệch 1 ms (qua mốc mili giây) và làm ca "đúng mốc hết hạn" đỏ ngẫu nhiên, nên đóng băng một lần đọc.
  const t = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(t);
  syncServerClock(new Date(t).toISOString());
  clock.mockRestore();
});

describe('/mua-chung — máy chủ từ chối tham gia 400/404/409/422: tải lại nhóm rồi mới nhả khoá', () => {
  it.each([
    [400, 'Nhóm đã đủ người hoặc đã đóng.'],
    [404, 'Không tìm thấy nhóm mua chung.'],
    [409, 'Nhóm đã đóng.'],
    [422, 'Nhóm không còn nhận thành viên.'],
  ])('máy chủ trả %i: báo đúng câu của máy chủ, tải lại danh sách, nhóm đã đóng không còn nút "Tham gia"', async (status, message) => {
    h.list = script([GROUP('a')], []);
    h.post.mockRejectedValue(httpError(status, message));
    const c = await mount();
    click(btn(c, JOIN)!);
    await flush(8);
    expect(alertText(c)).toBe(message);
    expect(gets('/group-buy')).toBe(2);
    expect(c.textContent).toContain('Chưa có nhóm mua chung nào');
    expect(btn(c, JOIN)).toBeUndefined();
    expect(posts()).toBe(1);
  });

  it('"Bạn đã tham gia nhóm này rồi" (lần bấm trước mất phản hồi): tải lại thì thẻ thành "Mời bạn bè", không còn nút tham gia', async () => {
    h.list = script([GROUP('a')], [GROUP('a', { joined: true, currentSize: 3 })]);
    h.post.mockRejectedValue(httpError(400, 'Bạn đã tham gia nhóm này rồi.'));
    const c = await mount();
    click(btn(c, JOIN)!);
    await flush(8);
    expect(btn(c, 'Mời bạn bè')).toBeDefined();
    expect(btn(c, /^Tham gia mua chung/)).toBeUndefined();
    expect(posts()).toBe(1);
  });

  it('hai cú chạm cùng khung hình: một lệnh tham gia, một lần tải lại', async () => {
    h.list = script([GROUP('a')], []);
    h.post.mockRejectedValue(httpError(409, 'Nhóm đã đóng.'));
    const c = await mount();
    const b = btn(c, JOIN)!;
    await tapTogether(b, b);
    await flush(8);
    expect(posts()).toBe(1);
    expect(gets('/group-buy')).toBe(2);
  });

  it('khoá giữ tới khi danh sách tải lại về: nút báo aria-busy/aria-disabled (không disabled), chạm thêm không gửi lần hai; về rồi thẻ hiện đúng trạng thái', async () => {
    const refreshed = gate<unknown[]>();
    h.list = script([GROUP('a')], () => refreshed.promise);
    h.post.mockRejectedValue(httpError(400, 'Nhóm đã đủ người hoặc đã đóng.'));
    const c = await mount();
    click(btn(c, JOIN)!);
    await flush(6);
    expect(gets('/group-buy')).toBe(2);
    const stale = btn(c, JOIN)!;
    expect(stale.getAttribute('aria-busy')).toBe('true');
    expect(stale.getAttribute('aria-disabled')).toBe('true');
    expect(stale.disabled).toBe(false);
    await tapTogether(stale, stale);
    expect(posts()).toBe(1);
    expect(gets('/group-buy')).toBe(2);
    refreshed.resolve([]);
    await flush(8);
    expect(c.textContent).toContain('Chưa có nhóm mua chung nào');
    expect(posts()).toBe(1);
  });

  it('nhóm mở bằng liên kết: lỗi 400 tải lại cả chi tiết nhóm lẫn danh sách chung', async () => {
    h.list = script([]);
    h.one = script(GROUP('inv'), GROUP('inv', { status: 'SUCCESS', joined: false }));
    h.post.mockRejectedValue(httpError(400, 'Nhóm đã đóng.'));
    const c = await mount('inv');
    click(btn(c, JOIN)!);
    await flush(8);
    expect(gets('/group-buy/inv')).toBe(2);
    expect(gets('/group-buy')).toBe(2);
    expect(btn(c, 'Nhóm đã đủ người')!.disabled).toBe(true);
  });

  describe('làm mới không bao giờ về: nhả khoá sau 4 giây', () => {
    beforeEach(() => {
      // shouldAdvanceTime để `flush` (setTimeout 0) và bộ đếm giờ của react-query vẫn chạy; chỉ cần giả setTimeout để tua tới hạn.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    });
    afterEach(() => vi.useRealTimers());
    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });

    it('lỗi 409: còn khoá ở 3 giây (chạm thêm không gửi lệnh), nhả sau 4 giây dù danh sách chưa về, rồi bấm lại gửi được', async () => {
      h.list = script([GROUP('a')], never);
      h.post.mockRejectedValue(httpError(409, 'Nhóm đã đóng.'));
      const c = await mount();
      click(btn(c, JOIN)!);
      await flush(6);
      expect(posts()).toBe(1);
      expect(gets('/group-buy')).toBe(2);
      await advance(3_000);
      const b = btn(c, JOIN)!;
      expect(b.getAttribute('aria-busy')).toBe('true');
      await tapTogether(b, b);
      expect(posts()).toBe(1);
      await advance(1_500);
      await flush(4);
      expect(b.hasAttribute('aria-busy')).toBe(false);
      click(b);
      await flush(6);
      expect(posts()).toBe(2);
    });
  });

  it('tải lại cũng hỏng: không có promise bị từ chối bỏ rơi, khoá nhả; "Thử lại" chạm đúp chỉ tải một lần và nút báo bận tới khi danh sách về', async () => {
    const retried = gate<unknown[]>();
    h.list = script([GROUP('a')], () => Promise.reject(new Error('mất mạng')), () => retried.promise);
    h.post.mockRejectedValue(httpError(409, 'Nhóm đã đóng.'));
    const c = await mount();
    const seen = await captureUnhandledRejections(async () => {
      click(btn(c, JOIN)!);
      await flush(8);
    });
    expect(seen).toEqual([]);
    expect(gets('/group-buy')).toBe(2);
    const retry = btn(c, 'Thử lại')!;
    expect(retry).toBeDefined();
    await tapTogether(retry, retry);
    await flush(2);
    expect(gets('/group-buy')).toBe(3);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    retried.resolve([GROUP('a')]);
    await flush(8);
    expect(gets('/group-buy')).toBe(3);
    expect(btn(c, JOIN)).toBeDefined();
    expect(btn(c, 'Thử lại')).toBeUndefined();
  });
});

describe('/mua-chung — lỗi không nói gì về nhóm: báo lỗi, không tải lại (tải lại hỏng sẽ thay cả danh sách bằng màn lỗi)', () => {
  it.each([
    ['mất mạng', new NetworkError(false)],
    ['hết thời gian', new NetworkError(true)],
    ['hết phiên (401)', new ApiError('Phiên đăng nhập đã hết hạn.', 401, 'SESSION_EXPIRED')],
    ['máy chủ bận (500)', new ApiError('Internal error', 500)],
    ['cổng lỗi lúc triển khai (502)', new ApiError('Bad gateway', 502)],
    ['lỗi không có mã HTTP', new Error('boom')],
  ])('%s: hiện lỗi, danh sách không tải lại, khoá nhả để bấm lại', async (_label, error) => {
    h.post.mockRejectedValue(error);
    const c = await mount();
    click(btn(c, JOIN)!);
    await flush(8);
    expect(alertText(c)).toBe(loadErrorText(error));
    expect(gets('/group-buy')).toBe(1);
    const b = btn(c, JOIN)!;
    expect(b.hasAttribute('aria-busy')).toBe(false);
    click(b);
    await flush(4);
    expect(posts()).toBe(2);
  });
});

describe('/mua-chung — nhóm OPEN quá hạn mà cron 15 phút chưa đóng (API vẫn trả OPEN)', () => {
  const PAST = () => new Date(Date.now() - 60_000).toISOString();

  it('nhóm được mời qua liên kết: ghi "Nhóm đã hết hạn", nút bị khoá, không gửi yêu cầu tham gia', async () => {
    h.list = script([]);
    h.one = script(GROUP('late', { expiresAt: PAST() }));
    const c = await mount('late');
    const closed = btn(c, 'Nhóm đã hết hạn')!;
    expect(closed.disabled).toBe(true);
    expect(c.textContent).toContain('2/5 người · đã hết hạn');
    expect(btn(c, /^Tham gia mua chung/)).toBeUndefined();
    click(closed);
    await flush(2);
    expect(posts()).toBe(0);
  });

  it('thành viên của nhóm quá hạn: không còn nút "Mời bạn bè" (mời vào nhóm không tham gia được nữa)', async () => {
    h.list = script([GROUP('mine', { joined: true, isOwner: true, expiresAt: PAST() })]);
    const c = await mount();
    expect(btn(c, 'Nhóm đã hết hạn')!.disabled).toBe(true);
    expect(btn(c, 'Mời bạn bè')).toBeUndefined();
    expect(c.textContent).not.toContain('Bạn đã ở trong nhóm');
  });

  it('đúng mốc hết hạn (bằng giờ máy chủ) đã tính là hết hạn, như máy chủ (expiresAt <= now)', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      h.list = script([GROUP('edge', { expiresAt: new Date(now).toISOString() })]);
      const c = await mount();
      expect(btn(c, 'Nhóm đã hết hạn')!.disabled).toBe(true);
      expect(btn(c, /^Tham gia mua chung/)).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });

  it('một mili giây trước mốc vẫn còn hạn', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      h.list = script([GROUP('edge', { expiresAt: new Date(now + 1).toISOString() })]);
      const c = await mount();
      expect(btn(c, JOIN)!.disabled).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });

  it('điện thoại chạy chậm hơn máy chủ 10 phút: hạn tính theo giờ máy chủ, nhóm hết hạn thật dù đồng hồ máy còn 5 phút (nút VÀ dòng thời hạn)', async () => {
    syncServerClock(new Date(Date.now() + 10 * 60_000).toISOString());
    h.list = script([GROUP('skew', { expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() })]);
    const c = await mount();
    expect(btn(c, 'Nhóm đã hết hạn')!.disabled).toBe(true);
    expect(c.textContent).toContain('2/5 người · đã hết hạn');
  });

  it('điện thoại chạy nhanh hơn máy chủ 10 phút: đồng hồ máy báo quá hạn nhưng máy chủ còn 5 phút, vẫn cho tham gia và ghi "còn 5 phút"', async () => {
    const serverMs = Date.now() - 10 * 60_000;
    syncServerClock(new Date(serverMs).toISOString());
    h.list = script([GROUP('skew', { expiresAt: new Date(serverMs + 5.5 * 60_000).toISOString() })]);
    const c = await mount();
    expect(btn(c, JOIN)!.disabled).toBe(false);
    expect(c.textContent).toContain('2/5 người · còn 5 phút');
  });

  it('nhóm còn hạn một phút vẫn cho tham gia', async () => {
    h.list = script([GROUP('soon', { expiresAt: new Date(Date.now() + 60_000).toISOString() })]);
    const c = await mount();
    expect(btn(c, JOIN)!.disabled).toBe(false);
  });
});

describe('/mua-chung — số trong thẻ dùng chữ số đều (tabular-nums)', () => {
  const leafWith = (c: HTMLElement, text: string) => {
    const hits = Array.from(c.querySelectorAll<HTMLElement>('article *')).filter((e) => e.textContent?.includes(text));
    return hits.find((e) => !hits.some((o) => o !== e && e.contains(o)));
  };

  it('giá nhóm, % giảm, số người, số còn thiếu, dòng thưởng, trạng thái thành viên và nút Tham gia đều nằm trong vùng tabular-nums', async () => {
    h.list = script([GROUP('a'), GROUP('b', { joined: true })]);
    const c = await mount();
    const numeric = [
      `Giá nhóm ${formatVnd(80_000)}`,
      `Mua một mình ${formatVnd(100_000)}`,
      '−20%',
      '2/5 người',
      'Còn thiếu 3 người',
      'Đủ nhóm: mỗi người nhận mã giảm giá 20%',
      'Bạn đã ở trong nhóm · cần thêm 3 người',
      JOIN,
    ];
    for (const text of numeric) {
      const el = leafWith(c, text);
      expect(el, text).toBeDefined();
      expect(el!.closest('.tabular-nums'), text).not.toBeNull();
    }
  });
});
