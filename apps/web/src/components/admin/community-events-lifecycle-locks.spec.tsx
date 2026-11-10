// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';
import { EventsPanel } from './community-events-panel';

// Khoá Chốt/Đóng/Tạo sự kiện của trang Quản trị giữ tới khi danh sách làm mới về, có hạn 4 giây, và tải lại khi lệnh bị từ chối vì trạng thái đã đổi
// (Mini ↔ web, Wave 101A ↔ Wave 88B). fetch giả có cổng chặn từng đường để dựng đúng khoảnh khắc "lệnh xong nhưng danh sách chưa về".

const EVENT = {
  id: 'e1', title: 'Thi ảnh ban công xanh', description: 'Khoe ban công đẹp nhất.', coverUrl: null, startAt: '2026-10-01T00:00:00.000Z',
  endAt: '2026-11-30T16:59:00.000Z', rewardPoints: 20_000, status: 'OPEN', winnerUserId: null, createdAt: '2026-10-01T00:00:00.000Z', winner: null,
};
const PARTICIPANTS = [
  { userId: 'u1', name: 'Lan', avatar: null, postId: 'p1', postTitle: 'Ban công tầng 5', postedAt: '2026-10-20T03:00:00.000Z', postCount: 2 },
  { userId: 'u2', name: 'Minh', avatar: null, postId: 'p2', postTitle: 'Giàn mướp', postedAt: '2026-10-21T03:00:00.000Z', postCount: 1 },
];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

type Route = () => Promise<Response> | Response;
const routes: Record<'list' | 'participants' | 'close' | 'winner' | 'create', Route> = {
  list: () => json(200, [EVENT]),
  participants: () => json(200, PARTICIPANTS),
  close: () => json(200, { ok: true }),
  winner: () => json(200, { ok: true, rewarded: true }),
  create: () => json(200, { id: 'e9' }),
};
const calls: { method: string; url: string }[] = [];
const count = (method: string, part: string) => calls.filter((c) => c.method === method && c.url.includes(part)).length;
const listGets = () => count('GET', '/feed/admin/events?');
const participantGets = () => count('GET', '/feed/admin/events/e1/participants');
const closes = () => count('POST', '/feed/events/e1/close');
const winners = () => count('POST', '/feed/events/e1/winner');
const creates = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/feed/events')).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  routes.list = () => json(200, [EVENT]);
  routes.participants = () => json(200, PARTICIPANTS);
  routes.close = () => json(200, { ok: true });
  routes.winner = () => json(200, { ok: true, rewarded: true });
  routes.create = () => json(200, { id: 'e9' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (url.includes('/config/public')) return json(200, {});
      if (url.includes('/feed/admin/events/e1/participants')) return routes.participants();
      if (url.includes('/feed/admin/events?')) return routes.list();
      if (url.endsWith('/feed/events/e1/close')) return routes.close();
      if (url.endsWith('/feed/events/e1/winner')) return routes.winner();
      if (url.endsWith('/feed/events') && method === 'POST') return routes.create();
      throw new Error(`fetch chưa giả: ${method} ${url}`);
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mount = async (qc?: QueryClient) => {
  mounted = render(<EventsPanel />, qc);
  await flush();
  return mounted.container;
};
const row = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-event="e1"]')!;
const closeBtn = (c: HTMLElement) => byText(row(c), 'button', 'Đóng sự kiện') as HTMLButtonElement;
const chooseBtn = (c: HTMLElement) => byText(row(c), 'button', 'Chọn người thắng') as HTMLButtonElement;
const pickBtn = (c: HTMLElement) => byText(row(c), 'button', 'Chốt Lan là người thắng') as HTMLButtonElement;
const retryBtn = (c: HTMLElement) => byText(c, 'button', 'Thử lại') as HTMLButtonElement;
const alertText = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="alert"]')).map((a) => a.textContent).join(' | ');

/** Chạm hai lần trong cùng một lần act, tức trước khi React vẽ lại (chạm đúp thật). */
const tapTogether = (...els: HTMLElement[]) =>
  act(async () => {
    for (const e of els) e.click();
  });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });

/** Chặn lượt tải lại danh sách (từ giờ trở đi) tới khi `resolve`; trả về list cũ (hàng vẫn còn) để thấy nút có nhả hay không. */
const holdList = () => {
  const g = gate();
  routes.list = () => g.promise.then(() => json(200, [EVENT]));
  return g;
};
const holdParticipants = () => {
  const g = gate();
  routes.participants = () => g.promise.then(() => json(200, PARTICIPANTS));
  return g;
};
const confirmClose = async (c: HTMLElement) => {
  click(closeBtn(c));
  await flush();
  answerConfirm(true);
  await flush();
};
const openParticipants = async (c: HTMLElement) => {
  click(chooseBtn(c));
  await flush();
  click(row(c).querySelector('[role="radio"]'));
};
const confirmPick = async (c: HTMLElement) => {
  click(pickBtn(c));
  await flush();
  answerConfirm(true);
  await flush();
};
const isBusy = (b: HTMLElement) => b.getAttribute('aria-busy') === 'true';

describe('Đóng sự kiện: khoá giữ tới khi danh sách làm mới về', () => {
  it('lệnh xong mà danh sách chưa về: nút báo bận bằng aria-busy/aria-disabled (không disabled), chạm tiếp không mở hộp xác nhận hay gửi lệnh; về rồi mới nhả', async () => {
    const c = await mount();
    const g = holdList();
    await confirmClose(c);
    expect(closes()).toBe(1);
    expect(c.textContent).toContain('Đã đóng sự kiện.');
    const b = closeBtn(c);
    expect(isBusy(b)).toBe(true);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);

    click(b);
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(closes()).toBe(1);

    g.resolve();
    await flush();
    expect(isBusy(closeBtn(c))).toBe(false);
    expect(closeBtn(c).hasAttribute('aria-disabled')).toBe(false);
    await confirmClose(c);
    expect(closes()).toBe(2);
  });

  it('hộp xác nhận Đóng bật hai lần sát nhau trong cùng một nhịp: lệnh đầu đang chạy thì hộp thứ hai không gửi thêm lệnh', async () => {
    const c = await mount();
    holdList();
    click(closeBtn(c));
    await flush();
    await act(async () => {
      answerConfirm(true);
      click(closeBtn(c));
    });
    await flush();
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(true);
    await flush();
    expect(closes()).toBe(1);
  });

  it('đang đóng thì "Chọn người thắng" cũng bị chặn: aria-disabled, chạm không mở danh sách người dự thi', async () => {
    const c = await mount();
    holdList();
    await confirmClose(c);
    const choose = chooseBtn(c);
    expect(choose.getAttribute('aria-disabled')).toBe('true');
    expect(choose.disabled).toBe(false);
    click(choose);
    await flush();
    expect(participantGets()).toBe(0);
    expect(row(c).querySelector('[role="radiogroup"]')).toBeNull();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây và đóng lại được', async () => {
    const c = await mount();
    useHangTimers();
    routes.list = () => new Promise<Response>(() => undefined);
    await confirmClose(c);
    expect(closes()).toBe(1);
    await advance(3_500);
    expect(isBusy(closeBtn(c))).toBe(true);
    click(closeBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    await advance(1_000);
    await flush();
    expect(isBusy(closeBtn(c))).toBe(false);
    await confirmClose(c);
    expect(closes()).toBe(2);
  });

  it('đóng lỗi mạng: hiện lỗi, không tải lại danh sách, nhả khoá ngay để thử lại', async () => {
    const c = await mount();
    routes.close = () => {
      throw new TypeError('Failed to fetch');
    };
    await confirmClose(c);
    expect(alertText(c)).not.toBe('');
    expect(listGets()).toBe(1);
    expect(isBusy(closeBtn(c))).toBe(false);
    routes.close = () => json(200, { ok: true });
    await confirmClose(c);
    expect(closes()).toBe(2);
  });
});

describe('Chốt người thắng: khoá giữ tới khi danh sách làm mới về', () => {
  it('lệnh xong mà danh sách chưa về: nút Chốt aria-busy (không disabled), chạm tiếp không gửi lệnh; về rồi mới nhả', async () => {
    const c = await mount();
    await openParticipants(c);
    const g = holdList();
    await confirmPick(c);
    expect(winners()).toBe(1);
    expect(c.textContent).toContain('Đã chốt Lan là người thắng và cộng 20.000 Điểm Xanh.');
    const b = pickBtn(c);
    expect(isBusy(b)).toBe(true);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);

    click(b);
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(winners()).toBe(1);

    g.resolve();
    await flush();
    expect(isBusy(pickBtn(c))).toBe(false);
    await confirmPick(c);
    expect(winners()).toBe(2);
  });

  it('hộp xác nhận Chốt bật hai lần sát nhau trong cùng một nhịp: chỉ gửi một lệnh', async () => {
    const c = await mount();
    await openParticipants(c);
    holdList();
    click(pickBtn(c));
    await flush();
    await act(async () => {
      answerConfirm(true);
      click(pickBtn(c));
    });
    await flush();
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(true);
    await flush();
    expect(winners()).toBe(1);
  });

  it('chưa chọn ai thì nút Chốt vẫn disabled thật (khác với bận)', async () => {
    const c = await mount();
    click(chooseBtn(c));
    await flush();
    const b = byText(row(c), 'button', 'Chọn một người ở trên') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(isBusy(b)).toBe(false);
  });

  it('danh sách không bao giờ về: nhả sau hạn 4 giây và chốt lại được', async () => {
    const c = await mount();
    await openParticipants(c);
    useHangTimers();
    routes.list = () => new Promise<Response>(() => undefined);
    await confirmPick(c);
    expect(winners()).toBe(1);
    await advance(3_500);
    expect(isBusy(pickBtn(c))).toBe(true);
    await advance(1_000);
    await flush();
    expect(isBusy(pickBtn(c))).toBe(false);
    await confirmPick(c);
    expect(winners()).toBe(2);
  });

  it.each([[500], [401], [403]])('chốt bị máy chủ từ chối %i: hiện lỗi, KHÔNG tải lại danh sách hay người dự thi, nhả khoá ngay', async (status) => {
    const c = await mount();
    await openParticipants(c);
    routes.winner = () => json(status, { message: 'Lỗi máy chủ' });
    await confirmPick(c);
    expect(alertText(c)).not.toBe('');
    expect(listGets()).toBe(1);
    expect(participantGets()).toBe(1);
    expect(isBusy(pickBtn(c))).toBe(false);
  });

  it('chốt lỗi mạng: không tải lại, nhả khoá ngay', async () => {
    const c = await mount();
    await openParticipants(c);
    routes.winner = () => {
      throw new TypeError('Failed to fetch');
    };
    await confirmPick(c);
    expect(listGets()).toBe(1);
    expect(participantGets()).toBe(1);
    expect(isBusy(pickBtn(c))).toBe(false);
  });
});

describe('lệnh bị từ chối vì trạng thái đã đổi (400/404/409): tải lại danh sách VÀ người dự thi rồi mới nhả khoá', () => {
  it.each([[400], [404], [409]])('chốt người thắng bị %i: hiện lỗi trước, tải lại cả hai, chỉ nhả khi cả hai về', async (status) => {
    const c = await mount();
    await openParticipants(c);
    expect(listGets()).toBe(1);
    expect(participantGets()).toBe(1);
    routes.winner = () => json(status, { message: 'Sự kiện đã đóng hoặc đã chọn người thắng.' });
    const list = holdList();
    const people = holdParticipants();
    await confirmPick(c);
    expect(alertText(c)).toContain('đã đóng hoặc đã chọn người thắng');
    expect(listGets()).toBe(2);
    expect(participantGets()).toBe(2);
    expect(isBusy(pickBtn(c))).toBe(true);

    click(pickBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(winners()).toBe(1);

    list.resolve();
    await flush();
    expect(isBusy(pickBtn(c))).toBe(true);
    people.resolve();
    await flush();
    expect(isBusy(pickBtn(c))).toBe(false);
    expect(listGets()).toBe(2);
    expect(participantGets()).toBe(2);
  });

  it.each([[400], [404], [409]])('đóng sự kiện bị %i: hiện lỗi trước, tải lại cả hai, chỉ nhả khi cả hai về', async (status) => {
    const c = await mount();
    await openParticipants(c);
    routes.close = () => json(status, { message: 'Sự kiện đã đóng.' });
    const list = holdList();
    const people = holdParticipants();
    await confirmClose(c);
    expect(alertText(c)).toContain('Sự kiện đã đóng.');
    expect(listGets()).toBe(2);
    expect(participantGets()).toBe(2);
    expect(isBusy(closeBtn(c))).toBe(true);

    people.resolve();
    await flush();
    expect(isBusy(closeBtn(c))).toBe(true);
    list.resolve();
    await flush();
    expect(isBusy(closeBtn(c))).toBe(false);
  });

  it('đóng bị từ chối khi chưa mở danh sách người dự thi: chỉ tải lại danh sách sự kiện, không gọi người dự thi', async () => {
    const c = await mount();
    routes.close = () => json(409, { message: 'Sự kiện đã đóng.' });
    await confirmClose(c);
    expect(listGets()).toBe(2);
    expect(participantGets()).toBe(0);
  });

  it('bị từ chối mà tải lại treo: vẫn nhả khoá sau hạn 4 giây', async () => {
    const c = await mount();
    await openParticipants(c);
    useHangTimers();
    routes.close = () => json(409, { message: 'Sự kiện đã đóng.' });
    routes.list = () => new Promise<Response>(() => undefined);
    await confirmClose(c);
    await advance(3_500);
    expect(isBusy(closeBtn(c))).toBe(true);
    await advance(1_000);
    await flush();
    expect(isBusy(closeBtn(c))).toBe(false);
  });

  it('đóng xong mà tải lại danh sách hỏng 500: không có unhandled rejection, khoá nhả, danh sách báo lỗi tải', async () => {
    const c = await mount();
    const seen = await captureUnhandledRejections(async () => {
      routes.list = () => json(500, { message: 'x' });
      await confirmClose(c);
      await flush();
    });
    expect(seen).toEqual([]);
    expect(c.textContent).toContain('Không tải được danh sách sự kiện.');
    expect(c.textContent).toContain('Đã đóng sự kiện.');
  });
});

describe('"Thử lại" của danh sách và người dự thi trả Promise, không chồng lệnh', () => {
  const qcWith = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  it('danh sách sự kiện: chạm đúp cùng khung hình chỉ tải lại một lần', async () => {
    const qc = qcWith();
    const c = await mount(qc);
    // Truy vấn còn dữ liệu cũ mà lần làm mới lỗi: refetch thứ hai mặc định sẽ huỷ rồi gửi lại, nên chỉ ca này mới chứng minh được.
    routes.list = () => json(500, { message: 'x' });
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['admin-community-events'] });
    });
    await flush();
    const retry = retryBtn(c);
    expect(retry).toBeTruthy();
    const next = gate();
    routes.list = () => next.promise.then(() => json(200, [EVENT]));
    const before = listGets();
    await tapTogether(retry, retry);
    await flush();
    expect(listGets() - before).toBe(1);
    next.resolve();
    await flush();
    expect(c.textContent).not.toContain('Không tải được danh sách sự kiện.');
    expect(listGets() - before).toBe(1);
  });

  it('người dự thi: chạm đúp cùng khung hình chỉ tải lại một lần', async () => {
    const qc = qcWith();
    const c = await mount(qc);
    click(chooseBtn(c));
    await flush();
    routes.participants = () => json(500, { message: 'x' });
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['admin-community-event-participants', 'e1'] });
    });
    await flush();
    expect(row(c).textContent).toContain('Không tải được người dự thi.');
    const retry = byText(row(c), 'button', 'Thử lại') as HTMLButtonElement;
    const next = gate();
    routes.participants = () => next.promise.then(() => json(200, PARTICIPANTS));
    const before = participantGets();
    await tapTogether(retry, retry);
    await flush();
    expect(participantGets() - before).toBe(1);
    next.resolve();
    await flush();
    expect(row(c).textContent).not.toContain('Không tải được người dự thi.');
    expect(participantGets() - before).toBe(1);
  });
});

describe('Tạo sự kiện: khoá giữ tới khi danh sách làm mới về, ô nhập không đóng băng', () => {
  const form = (c: HTMLElement) => c.querySelector('form')!;
  const createBtn = (c: HTMLElement) => form(c).querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const fill = (c: HTMLElement, title = 'Thi ảnh') => {
    typeInto(c.querySelector('[name="eventTitle"]'), title);
    typeInto(c.querySelector('[name="eventStart"]'), '2026-12-01T10:00');
    typeInto(c.querySelector('[name="eventEnd"]'), '2026-12-01T12:00');
  };
  const submit = async (c: HTMLElement) => {
    act(() => {
      form(c).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
  };

  it('Enter hai lần sát nhau trong cùng một nhịp: chỉ tạo một sự kiện', async () => {
    const c = await mount();
    fill(c);
    await act(async () => {
      form(c).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form(c).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(creates()).toBe(1);
  });

  it('tạo xong mà danh sách chưa về: nút aria-busy (không disabled dù form đã xoá), ô nhập vẫn gõ được nhưng gửi tiếp bị chặn; về rồi mới tạo lại được', async () => {
    const c = await mount();
    fill(c);
    const g = holdList();
    await submit(c);
    expect(creates()).toBe(1);
    expect(c.textContent).toContain('Đã tạo sự kiện.');
    const b = createBtn(c);
    expect(b.textContent).toBe('Đang tạo…');
    expect(isBusy(b)).toBe(true);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);

    fill(c, 'Sự kiện tiếp');
    const title = c.querySelector<HTMLInputElement>('[name="eventTitle"]')!;
    expect(title.value).toBe('Sự kiện tiếp');
    expect(title.disabled).toBe(false);
    await submit(c);
    expect(creates()).toBe(1);

    g.resolve();
    await flush();
    expect(createBtn(c).textContent).toBe('Tạo sự kiện');
    expect(isBusy(createBtn(c))).toBe(false);
    await submit(c);
    expect(creates()).toBe(2);
  });

  it('tạo xong mà danh sách chưa về: ô ảnh bìa không bị khoá (chỉ khoá lúc lệnh tạo còn bay)', async () => {
    const c = await mount();
    fill(c);
    holdList();
    await submit(c);
    expect(c.querySelector('button[aria-label="Tải ảnh bìa sự kiện lên"]')!.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây và tạo lại được', async () => {
    const c = await mount();
    useHangTimers();
    fill(c);
    routes.list = () => new Promise<Response>(() => undefined);
    await submit(c);
    expect(creates()).toBe(1);
    await advance(3_500);
    fill(c, 'Sự kiện tiếp');
    await submit(c);
    expect(creates()).toBe(1);
    await advance(1_000);
    await flush();
    await submit(c);
    expect(creates()).toBe(2);
  });

  it('tạo lỗi: hiện lỗi, giữ nguyên nội dung đã nhập, nhả khoá ngay và không tải lại danh sách', async () => {
    const c = await mount();
    fill(c);
    routes.create = () => json(400, { message: 'Giờ kết thúc phải sau giờ bắt đầu.' });
    await submit(c);
    expect(alertText(c)).toContain('Giờ kết thúc phải sau giờ bắt đầu.');
    expect(listGets()).toBe(1);
    expect(isBusy(createBtn(c))).toBe(false);
    expect(c.querySelector<HTMLInputElement>('[name="eventTitle"]')!.value).toBe('Thi ảnh');
    routes.create = () => json(200, { id: 'e9' });
    await submit(c);
    expect(creates()).toBe(2);
  });
});

describe('số dùng tabular-nums', () => {
  it('dòng Thưởng/giờ của sự kiện, số bài của người dự thi và ô nhập điểm thưởng', async () => {
    const c = await mount();
    const head = Array.from(row(c).querySelectorAll('p')).find((p) => p.textContent?.includes('Thưởng 20.000 Điểm Xanh'))!;
    expect(head.className).toContain('tabular-nums');
    click(chooseBtn(c));
    await flush();
    const posts = Array.from(row(c).querySelectorAll('[role="radio"] span')).find((s) => s.textContent?.includes('2 bài dự thi'))!;
    expect(posts.className).toContain('tabular-nums');
    expect(c.querySelector('[name="eventReward"]')!.className).toContain('tabular-nums');
  });
});
