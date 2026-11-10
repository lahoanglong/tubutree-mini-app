// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { CommunityModerationTab } from './community-moderation-tab';

// Wave 96B: khoá Duyệt/Từ chối/Ẩn/Ghim/Bỏ qua báo cáo/Gửi trả lời của kiểm duyệt cộng đồng (web ↔ Mini W74A): một việc mỗi dòng, giữ tới khi danh sách
// làm mới về (tối đa 4 giây), bị từ chối vì trạng thái đã đổi (400/404/409) thì tải lại, lời lỗi đứng ở đầu tab (không mất cùng dòng bị gỡ).

const PENDING = [
  { id: 'p1', kind: 'SHOWCASE', title: 'Ban công mới trồng', body: 'Khoe vườn ban công.', images: [], author: 'Lan', category: null, createdAt: '2026-10-17T03:00:00.000Z' },
  { id: 'p2', kind: 'QUESTION', title: null, body: 'Lá vàng phải làm sao?', images: [], author: 'Minh', category: null, createdAt: '2026-10-17T04:00:00.000Z' },
];
const PUBLISHED = {
  items: [
    { id: 'a1', kind: 'TIP', title: 'Mẹo tưới', excerpt: 'Tưới buổi sáng.', author: 'Hà', category: null, createdAt: '2026-10-16T03:00:00.000Z', isPinned: false, likeCount: 4, commentCount: 2 },
    { id: 'a2', kind: 'MANUAL', title: null, excerpt: 'Chia sẻ nhỏ.', author: 'Quân', category: null, createdAt: '2026-10-16T04:00:00.000Z', isPinned: false, likeCount: 0, commentCount: 0 },
  ],
  nextCursor: null as string | null,
};
const UNANSWERED = [{ id: 'q1', title: 'Cây khô lá', excerpt: 'Cây bị khô.', createdAt: '2026-10-15T03:00:00.000Z', author: 'Bình', category: null, waitingHours: 52 }];
const REPORTS = [
  { id: 'r1', reporterId: 'u9', targetType: 'POST', targetId: 'a2', reason: 'Quảng cáo', status: 'OPEN', createdAt: '2026-10-27T03:00:00.000Z', target: { kind: 'POST', author: 'Quân', title: null, excerpt: 'Mua giá rẻ.', alreadyHandled: false, postId: 'a2' } },
];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

type Route = (init?: RequestInit) => Promise<Response> | Response;
let calls: { method: string; url: string }[] = [];
let routes: Record<string, Route> = {};
let mounted: Rendered | null = null;

const defaults = (): Record<string, Route> => ({
  '/feed/admin/pending': () => json(200, PENDING),
  '/feed/admin/published': () => json(200, PUBLISHED),
  '/feed/admin/unanswered': () => json(200, UNANSWERED),
  '/feed/admin/reports': () => json(200, REPORTS),
  '/ops/inbox': () => json(200, { items: [] }),
});

beforeEach(() => {
  calls = [];
  routes = defaults();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      const key = Object.keys(routes)
        .filter((k) => url.includes(k))
        .sort((a, b) => b.length - a.length)[0];
      if (!key) return json(500, { message: `no mock for ${method} ${url}` });
      return routes[key]!(init);
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const count = (method: string, part: string) => calls.filter((c) => c.method === method && c.url.includes(part)).length;
const pendingGets = () => count('GET', '/feed/admin/pending');
const reportGets = () => count('GET', '/feed/admin/reports');
const publishedGets = () => count('GET', '/feed/admin/published');
const unansweredGets = () => count('GET', '/feed/admin/unanswered');

async function mount(props: { initialView?: 'pending' | 'reports' | 'published' | 'unanswered'; isAdmin?: boolean } = {}) {
  mounted = render(<CommunityModerationTab {...props} />);
  await flush();
  return mounted.container;
}
const row = (c: HTMLElement, sel: string) => c.querySelector<HTMLElement>(sel)!;
const btn = (root: HTMLElement, text: string | RegExp) => byText(root, 'button', text) as HTMLButtonElement;
const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const busyOf = (b: HTMLElement) => ({ busy: b.getAttribute('aria-busy'), disabled: b.getAttribute('aria-disabled'), dom: (b as HTMLButtonElement).disabled });

describe('bài chờ duyệt: Duyệt / Từ chối', () => {
  it('chạm đúp "Duyệt" cùng một khung hình chỉ gửi một lệnh; nút aria-busy + aria-disabled, không disabled; Từ chối cũng aria-disabled', async () => {
    const g = gate();
    routes['/feed/admin/p1/approve'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    const c = await mount();
    const li = row(c, '[data-post="p1"]');
    await tap(btn(li, 'Duyệt'), btn(li, 'Duyệt'));
    await flush(1);
    expect(count('POST', '/feed/admin/p1/approve')).toBe(1);
    expect(busyOf(btn(li, 'Duyệt'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(busyOf(btn(li, 'Từ chối')).disabled).toBe('true');
    expect(busyOf(btn(li, 'Từ chối')).dom).toBe(false);
    g.resolve();
    await flush();
  });

  it('Duyệt rồi Từ chối cùng một khung hình: Từ chối không mở hộp thoại và không gửi lệnh', async () => {
    const g = gate();
    routes['/feed/admin/p1/approve'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    const c = await mount();
    const li = row(c, '[data-post="p1"]');
    await tap(btn(li, 'Duyệt'), btn(li, 'Từ chối'));
    await flush(1);
    expect(confirmDialog()).toBeNull();
    expect(count('POST', '/feed/admin/p1/reject')).toBe(0);
    g.resolve();
    await flush();
  });

  it('duyệt xong mà danh sách chưa làm mới: nút vẫn bận, chạm tiếp không gửi lệnh thứ hai; danh sách về thì nhả', async () => {
    const list = gate();
    let loads = 0;
    routes['/feed/admin/pending'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, PENDING);
    };
    routes['/feed/admin/p1/approve'] = () => json(200, { ok: true });
    const c = await mount();
    const li = row(c, '[data-post="p1"]');
    click(btn(li, 'Duyệt'));
    await flush();
    expect(count('POST', '/feed/admin/p1/approve')).toBe(1);
    expect(busyOf(btn(li, 'Duyệt')).busy).toBe('true');
    click(btn(li, 'Duyệt'));
    await flush(2);
    expect(count('POST', '/feed/admin/p1/approve')).toBe(1);
    list.resolve();
    await flush();
    expect(busyOf(btn(li, 'Duyệt')).busy).toBeNull();
    click(btn(li, 'Duyệt'));
    await flush();
    expect(count('POST', '/feed/admin/p1/approve')).toBe(2);
  });

  it('danh sách không bao giờ về: còn bận ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    let loads = 0;
    routes['/feed/admin/pending'] = () => (++loads > 1 ? new Promise<Response>(() => {}) : json(200, PENDING));
    routes['/feed/admin/p1/approve'] = () => json(200, { ok: true });
    const c = await mount();
    const li = row(c, '[data-post="p1"]');
    click(btn(li, 'Duyệt'));
    await advance(3_500);
    expect(busyOf(btn(li, 'Duyệt')).busy).toBe('true');
    await advance(700);
    expect(busyOf(btn(li, 'Duyệt')).busy).toBeNull();
    click(btn(li, 'Duyệt'));
    await advance(50);
    expect(count('POST', '/feed/admin/p1/approve')).toBe(2);
  });

  it.each([400, 404, 409])('từ chối bị máy chủ báo %i: lời lỗi hiện NGAY ở đầu tab, tải lại danh sách, giữ khoá tới khi danh sách về', async (status) => {
    const list = gate();
    let loads = 0;
    routes['/feed/admin/pending'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, loads > 1 ? [PENDING[1]] : PENDING);
    };
    routes['/feed/admin/p1/reject'] = () => json(status, { message: 'Bài này đã được đăng nên không thể từ chối.' });
    const c = await mount();
    const li = row(c, '[data-post="p1"]');
    click(btn(li, 'Từ chối'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(count('POST', '/feed/admin/p1/reject')).toBe(1);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Bài này đã được đăng nên không thể từ chối.');
    expect(pendingGets()).toBe(2);
    expect(busyOf(btn(li, 'Duyệt')).disabled).toBe('true');
    click(btn(li, 'Duyệt'));
    await flush(2);
    expect(count('POST', '/feed/admin/p1/approve')).toBe(0);
    list.resolve();
    await flush();
    expect(c.querySelector('[data-post="p1"]')).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Bài này đã được đăng nên không thể từ chối.');
  });

  it('từ chối bị từ chối mà danh sách tải lại treo: vẫn nhả sau hạn 4 giây', async () => {
    useHangTimers();
    let loads = 0;
    routes['/feed/admin/pending'] = () => (++loads > 1 ? new Promise<Response>(() => {}) : json(200, PENDING));
    routes['/feed/admin/p1/approve'] = () => json(409, { message: 'Bài đã bị người khác từ chối.' });
    const c = await mount();
    const li = row(c, '[data-post="p1"]');
    click(btn(li, 'Duyệt'));
    await advance(3_500);
    expect(busyOf(btn(li, 'Duyệt')).busy).toBe('true');
    await advance(700);
    expect(busyOf(btn(li, 'Duyệt')).busy).toBeNull();
  });

  it('lỗi 500 hoặc mất mạng: lời lỗi trên đúng dòng, KHÔNG tải lại danh sách, nhả khoá ngay để thử lại', async () => {
    routes['/feed/admin/p1/approve'] = () => json(500, { message: 'Máy chủ đang bận' });
    const c = await mount();
    const li = row(c, '[data-post="p1"]');
    click(btn(li, 'Duyệt'));
    await flush();
    expect(li.textContent).toContain('Máy chủ đang bận');
    expect(pendingGets()).toBe(1);
    expect(busyOf(btn(li, 'Duyệt')).busy).toBeNull();
    click(btn(li, 'Duyệt'));
    await flush();
    expect(count('POST', '/feed/admin/p1/approve')).toBe(2);
  });

  it('hai bài khác nhau duyệt song song: mỗi bài một khoá, không chặn nhau', async () => {
    const g = gate();
    routes['/feed/admin/p1/approve'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    routes['/feed/admin/p2/approve'] = () => json(200, { ok: true });
    const c = await mount();
    await tap(btn(row(c, '[data-post="p1"]'), 'Duyệt'), btn(row(c, '[data-post="p2"]'), 'Duyệt'));
    await flush(1);
    expect(count('POST', '/feed/admin/p1/approve')).toBe(1);
    expect(count('POST', '/feed/admin/p2/approve')).toBe(1);
    g.resolve();
    await flush();
  });
});

describe('báo cáo vi phạm: Ẩn bài / Bỏ qua', () => {
  it('chạm đúp "Ẩn bài" sau hộp xác nhận: một lệnh ẩn + một lệnh đóng báo cáo; Bỏ qua cùng lúc bị chặn', async () => {
    const g = gate();
    routes['/feed/admin/a2/hide'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    routes['/feed/admin/reports/r1/resolve'] = () => json(200, { ok: true });
    const c = await mount({ initialView: 'reports', isAdmin: true });
    const li = row(c, '[data-report="r1"]');
    click(btn(li, 'Ẩn bài'));
    await flush();
    answerConfirm(true);
    await flush(1);
    await tap(btn(li, 'Bỏ qua, đóng báo cáo'), btn(li, 'Bỏ qua, đóng báo cáo'));
    await flush(1);
    expect(count('POST', '/feed/admin/a2/hide')).toBe(1);
    expect(count('POST', '/feed/admin/reports/r1/resolve')).toBe(0);
    expect(busyOf(btn(li, 'Ẩn bài')).busy).toBe('true');
    expect(busyOf(btn(li, 'Bỏ qua, đóng báo cáo')).disabled).toBe('true');
    expect(busyOf(btn(li, 'Bỏ qua, đóng báo cáo')).dom).toBe(false);
    g.resolve();
    await flush();
    expect(count('POST', '/feed/admin/reports/r1/resolve')).toBe(1);
  });

  it('chạm đúp "Bỏ qua, đóng báo cáo" cùng một khung hình chỉ gửi một lệnh', async () => {
    const g = gate();
    routes['/feed/admin/reports/r1/resolve'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    const c = await mount({ initialView: 'reports', isAdmin: true });
    const li = row(c, '[data-report="r1"]');
    await tap(btn(li, 'Bỏ qua, đóng báo cáo'), btn(li, 'Bỏ qua, đóng báo cáo'));
    await flush(1);
    expect(count('POST', '/feed/admin/reports/r1/resolve')).toBe(1);
    g.resolve();
    await flush();
  });

  it('đóng báo cáo bị 404 (báo cáo đã được người khác đóng): tải lại cả báo cáo lẫn bài đã đăng, lời lỗi ở đầu tab, khoá giữ tới khi về', async () => {
    const list = gate();
    let loads = 0;
    routes['/feed/admin/reports'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, loads > 1 ? [] : REPORTS);
    };
    routes['/feed/admin/reports/r1/resolve'] = () => json(404, { message: 'Báo cáo không còn.' });
    const c = await mount({ initialView: 'reports', isAdmin: true });
    const li = row(c, '[data-report="r1"]');
    click(btn(li, 'Bỏ qua, đóng báo cáo'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Báo cáo không còn.');
    expect(reportGets()).toBeGreaterThanOrEqual(2);
    expect(busyOf(btn(li, 'Bỏ qua, đóng báo cáo')).busy).toBe('true');
    click(btn(li, 'Bỏ qua, đóng báo cáo'));
    await flush(2);
    expect(count('POST', '/feed/admin/reports/r1/resolve')).toBe(1);
    list.resolve();
    await flush();
    expect(c.querySelector('[data-report="r1"]')).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Báo cáo không còn.');
  });
});

describe('bài đã đăng: Ghim / Ẩn', () => {
  it('chạm đúp "Ghim" chỉ gửi một lệnh; Ẩn cùng lúc bị chặn; bận bằng aria, không disabled', async () => {
    const g = gate();
    routes['/feed/admin/a1/pin'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    const c = await mount({ initialView: 'published', isAdmin: true });
    const li = row(c, '[data-post="a1"]');
    await tap(btn(li, 'Ghim'), btn(li, 'Ghim'), btn(li, 'Ẩn'));
    await flush(1);
    expect(count('POST', '/feed/admin/a1/pin')).toBe(1);
    expect(confirmDialog()).toBeNull();
    expect(busyOf(btn(li, 'Ghim'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(busyOf(btn(li, 'Ẩn')).dom).toBe(false);
    g.resolve();
    await flush();
  });

  it('ghim xong mà danh sách chưa về: Ghim còn bận, chạm tiếp không gửi lệnh (ghim đảo chiều theo dữ liệu cũ)', async () => {
    const list = gate();
    let loads = 0;
    routes['/feed/admin/published'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, PUBLISHED);
    };
    routes['/feed/admin/a1/pin'] = () => json(200, { ok: true });
    const c = await mount({ initialView: 'published', isAdmin: true });
    const li = row(c, '[data-post="a1"]');
    click(btn(li, 'Ghim'));
    await flush();
    expect(publishedGets()).toBe(2);
    click(btn(li, 'Ghim'));
    await flush(2);
    expect(count('POST', '/feed/admin/a1/pin')).toBe(1);
    list.resolve();
    await flush();
    expect(busyOf(btn(li, 'Ghim')).busy).toBeNull();
  });

  it('"Tải thêm" giữ focus khi đang tải: aria-busy thay disabled, chạm đúp cùng khung hình chỉ tải một trang', async () => {
    const g = gate();
    routes['/feed/admin/published'] = async (init) => {
      void init;
      return json(200, { ...PUBLISHED, nextCursor: 'cur1' });
    };
    routes['/feed/admin/published?cursor=cur1'] = async () => {
      await g.promise;
      return json(200, { items: [], nextCursor: null });
    };
    const c = await mount({ initialView: 'published', isAdmin: true });
    const more = btn(c, 'Tải thêm');
    more.focus();
    await tap(more, more);
    await flush(1);
    expect(calls.filter((x) => x.url.includes('cursor=cur1')).length).toBe(1);
    const b = byText(c, 'button', /Đang tải/) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    g.resolve();
    await flush();
  });
});

describe('câu hỏi chưa trả lời: Gửi trả lời', () => {
  it('Enter hai lần cùng một khung hình chỉ gửi một bình luận công khai; nút aria-busy, không disabled', async () => {
    const g = gate();
    routes['/feed/q1/comments'] = async () => {
      await g.promise;
      return json(200, { id: 'c1' });
    };
    const c = await mount({ initialView: 'unanswered' });
    typeInto(c.querySelector('textarea[name="reply"]'), 'Tưới ít lại nhé');
    const form = c.querySelector('form')!;
    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await flush(1);
    expect(count('POST', '/feed/q1/comments')).toBe(1);
    const b = byText(c, 'button', /Đang gửi/) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    g.resolve();
    await flush();
  });

  it('gửi xong mà danh sách chưa về: gửi tiếp bị chặn (không bình luận trùng); về rồi mới nhả', async () => {
    const list = gate();
    let loads = 0;
    routes['/feed/admin/unanswered'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, UNANSWERED);
    };
    routes['/feed/q1/comments'] = () => json(200, { id: 'c1' });
    const c = await mount({ initialView: 'unanswered' });
    typeInto(c.querySelector('textarea[name="reply"]'), 'Tưới ít lại nhé');
    const form = c.querySelector('form')!;
    await act(async () => form.requestSubmit());
    await flush();
    expect(unansweredGets()).toBe(2);
    await act(async () => form.requestSubmit());
    await flush(2);
    expect(count('POST', '/feed/q1/comments')).toBe(1);
    list.resolve();
    await flush();
  });
});

describe('"Thử lại" của danh sách', () => {
  it('chạm đúp cùng một khung hình chỉ tải lại một lần', async () => {
    let loads = 0;
    routes['/feed/admin/pending'] = () => (++loads === 1 ? json(500, { message: 'lỗi' }) : new Promise<Response>(() => {}));
    const c = await mount();
    const retry = btn(c, 'Thử lại');
    await tap(retry, retry);
    await flush(1);
    expect(pendingGets()).toBe(2);
  });
});
