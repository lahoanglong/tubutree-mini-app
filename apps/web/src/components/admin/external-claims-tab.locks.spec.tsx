// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalClaimsTab } from './external-claims-tab';
import { answerAsk, answerConfirm, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';

// W96B: Duyệt / Huỷ / Đảo điểm / Giữ điểm yêu cầu tích điểm đơn sàn và Gắn đơn / Từ chối lần gửi mã (Điểm Xanh của khách) giữ khoá tới khi danh sách
// làm mới về (tối đa 4 giây), nút báo bận bằng aria-busy/aria-disabled (không disabled), lời báo kết quả ở cấp danh sách để không mất khi dòng rời bộ lọc
// sau khi tải lại.

const claim = (over: Record<string, unknown> = {}) => ({
  id: 'c1', externalOrderId: 'e1', pancakeOrderId: '910001', channel: 'Shopee', source: 'MARKETPLACE', maskedCode: 'SPX***789',
  userId: 'u1', userName: 'Lan', userPhoneMasked: '091****678', orderPhoneMasked: '091****678', goodsValue: 320000, points: 3200,
  state: 'REVIEW', orderStatus: 'DELIVERED', reviewReason: 'Vượt ngưỡng', voidReason: null, decidedById: null,
  deliveredAt: '2026-10-13T08:30:00.000Z', creditedAt: null, createdAt: '2026-10-13T08:31:00.000Z', ...over,
});
const attempt = (over: Record<string, unknown> = {}) => ({
  id: 'a1', userId: 'u2', userName: 'Mai', userPhoneMasked: '090****111', maskedCode: 'LZ***000', result: 'UNMATCHED',
  externalOrderId: null, note: null, createdAt: '2026-10-10T08:31:00.000Z', ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let claimRows: unknown[] = [];
let attemptRows: unknown[] = [];
let claimsAfterReload: (() => unknown[]) | undefined;
let attemptsAfterReload: (() => unknown[]) | undefined;
let claimLoads = 0;
let attemptLoads = 0;
let listGate: Promise<void> | undefined;
let writeGate: Promise<void> | undefined;
let writeStatus = 200;
let writeBody: unknown = {};
const writes: { method: string; url: string }[] = [];
const count = (suffix: string) => writes.filter((w) => w.url.endsWith(suffix)).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  claimRows = [claim()];
  attemptRows = [];
  claimsAfterReload = undefined;
  attemptsAfterReload = undefined;
  claimLoads = 0;
  attemptLoads = 0;
  listGate = undefined;
  writeGate = undefined;
  writeStatus = 200;
  writeBody = {};
  writes.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST') {
        writes.push({ method, url });
        await writeGate;
        if (writeStatus !== 200) return json(writeStatus, writeBody);
        if (url.includes('/attempts/') && url.endsWith('/attach')) return json(200, { claimId: 'c9', state: 'PENDING' });
        if (url.endsWith('/reverse')) return json(200, { claimId: 'c1', reversedPoints: 12500 });
        return json(200, { id: 'c1' });
      }
      if (url.includes('/admin/external-claims/attempts?')) {
        attemptLoads += 1;
        if (attemptLoads > 1) await listGate;
        const data = attemptLoads > 1 && attemptsAfterReload ? attemptsAfterReload() : attemptRows;
        return json(200, { data, meta: { page: 1, limit: 20, total: data.length } });
      }
      if (url.includes('/admin/external-claims?')) {
        claimLoads += 1;
        if (claimLoads > 1) await listGate;
        const data = claimLoads > 1 && claimsAfterReload ? claimsAfterReload() : claimRows;
        return json(200, { data, meta: { page: 1, limit: 20, total: data.length } });
      }
      return json(404, { statusCode: 404, message: 'không có' });
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mount = async () => {
  mounted = render(<ExternalClaimsTab isAdmin canAct meId="ad1" />);
  await flush();
  return mounted.container;
};
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const tap = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
  });
};
const btn = (c: HTMLElement, text: string) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text && b.getAttribute('role') !== 'tab') as HTMLButtonElement;
const approve = async (c: HTMLElement) => {
  click(btn(c, 'Duyệt'));
  await flush(1);
  answerConfirm(true);
  await flush(4);
};
const voidIt = async (c: HTMLElement) => {
  click(btn(c, 'Huỷ'));
  await flush(1);
  answerAsk('Khách gửi nhầm mã');
  await flush(4);
};
const attach = async (c: HTMLElement) => {
  click(btn(c, 'Gắn đơn'));
  await flush(1);
  answerAsk('910001');
  await flush(1);
  answerAsk('');
  await flush(4);
};
const rejectAttempt = async (c: HTMLElement) => {
  click(btn(c, 'Từ chối'));
  await flush(1);
  answerAsk('Mã không tồn tại');
  await flush(4);
};

describe('ExternalClaimsTab: Duyệt giữ khoá tới khi danh sách làm mới về', () => {
  it('duyệt xong mà danh sách chưa về: mọi nút của dòng aria-disabled (không disabled), nút vừa bấm aria-busy, chạm lại không mở hộp hỏi và chỉ một POST; về rồi mới nhả', async () => {
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await approve(c);
    expect(count('/c1/approve')).toBe(1);
    expect(claimLoads).toBe(2);
    expect(btn(c, 'Duyệt').getAttribute('aria-busy')).toBe('true');
    for (const t of ['Duyệt', 'Huỷ', 'Huỷ và mở lại mã']) {
      expect(btn(c, t).getAttribute('aria-disabled')).toBe('true');
      expect(btn(c, t).disabled).toBe(false);
    }
    expect(btn(c, 'Huỷ').getAttribute('aria-busy')).toBeNull();
    await tap(btn(c, 'Duyệt'));
    await tap(btn(c, 'Huỷ'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('/c1/approve')).toBe(1);
    list.resolve();
    await flush();
    expect(btn(c, 'Duyệt').getAttribute('aria-disabled')).toBeNull();
    expect(btn(c, 'Duyệt').getAttribute('aria-busy')).toBeNull();
  });

  it('lệnh còn bay: nút aria-busy/aria-disabled, không disabled', async () => {
    const c = await mount();
    const post = gate();
    writeGate = post.promise;
    await approve(c);
    expect(btn(c, 'Duyệt').getAttribute('aria-busy')).toBe('true');
    expect(btn(c, 'Duyệt').disabled).toBe(false);
    await tap(btn(c, 'Duyệt'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('/c1/approve')).toBe(1);
    post.resolve();
    await flush();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    const c = await mount();
    useHangTimers();
    listGate = new Promise<void>(() => {});
    await approve(c);
    await advance(3_500);
    expect(btn(c, 'Duyệt').getAttribute('aria-disabled')).toBe('true');
    await advance(700);
    expect(btn(c, 'Duyệt').getAttribute('aria-disabled')).toBeNull();
  });
});

describe('ExternalClaimsTab: Huỷ / Đảo điểm giữ khoá', () => {
  it('"Huỷ" có lý do: xong mà danh sách chưa về thì chạm lại không mở hộp hỏi, đúng một POST void', async () => {
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await voidIt(c);
    expect(count('/c1/void')).toBe(1);
    expect(btn(c, 'Huỷ').getAttribute('aria-busy')).toBe('true');
    expect(btn(c, 'Huỷ').disabled).toBe(false);
    await tap(btn(c, 'Huỷ'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('/c1/void')).toBe(1);
    list.resolve();
    await flush();
  });

  it('"Đảo điểm" (thu hồi Điểm Xanh): xong mà danh sách chưa về thì chạm lại không mở hộp hỏi, đúng một POST reverse', async () => {
    claimRows = [claim({ state: 'CREDITED', reviewReason: null })];
    const c = await mount();
    click(Array.from(c.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent === 'Đã cộng')!);
    await flush();
    const list = gate();
    listGate = list.promise;
    click(btn(c, 'Đảo điểm'));
    await flush(1);
    answerAsk('Khách hoàn đơn');
    await flush(4);
    expect(count('/c1/reverse')).toBe(1);
    expect(btn(c, 'Đảo điểm').getAttribute('aria-busy')).toBe('true');
    expect(btn(c, 'Đảo điểm').disabled).toBe(false);
    await tap(btn(c, 'Đảo điểm'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('/c1/reverse')).toBe(1);
    list.resolve();
    await flush();
  });
});

describe('ExternalClaimsTab: máy chủ đòi ghi chú (400 NOTE_REQUIRED)', () => {
  it('mở lại hộp ghi chú và xoá lời lỗi cũ của lần duyệt trước, danh sách vẫn được tải lại', async () => {
    claimRows = [claim({ kind: 'PHONE', source: 'CHAT', channel: null, memberPhoneStale: false, reviewReason: 'Tiền hàng vượt ngưỡng tự duyệt' })];
    writeStatus = 409;
    writeBody = { statusCode: 409, message: 'Yêu cầu này đã được xử lý.' };
    const c = await mount();
    await approve(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Yêu cầu này đã được xử lý.');
    const loadsBefore = claimLoads;
    writeStatus = 400;
    writeBody = { statusCode: 400, code: 'NOTE_REQUIRED', message: 'english' };
    await approve(c);
    expect(confirmDialog()!.querySelector('textarea')).not.toBeNull();
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(claimLoads).toBeGreaterThan(loadsBefore);
  });
});

describe('ExternalClaimsTab: Giữ điểm / Huỷ và mở lại mã giữ khoá', () => {
  it('"Giữ điểm, gỡ cờ" (đơn hoàn một phần): xong mà danh sách chưa về thì chạm lại không mở hộp hỏi, đúng một POST keep-points', async () => {
    claimRows = [claim({ state: 'CREDITED', reviewReason: 'Đơn hoàn một phần', orderStatus: 'PARTIAL_RETURN' })];
    const c = await mount();
    click(Array.from(c.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent === 'Đã cộng')!);
    await flush();
    const list = gate();
    listGate = list.promise;
    click(btn(c, 'Giữ điểm, gỡ cờ'));
    await flush(1);
    answerAsk('Hoàn món nhỏ');
    await flush(4);
    expect(count('/c1/keep-points')).toBe(1);
    expect(btn(c, 'Giữ điểm, gỡ cờ').getAttribute('aria-busy')).toBe('true');
    expect(btn(c, 'Đảo điểm').getAttribute('aria-busy')).toBeNull();
    await tap(btn(c, 'Giữ điểm, gỡ cờ'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('/c1/keep-points')).toBe(1);
    list.resolve();
    await flush();
  });

  it('"Huỷ và mở lại mã": nút vừa bấm aria-busy, nút "Huỷ" chỉ aria-disabled; chạm lại không mở hộp hỏi, đúng một POST void-and-reopen', async () => {
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    click(btn(c, 'Huỷ và mở lại mã'));
    await flush(1);
    answerAsk('Khách gửi nhầm mã');
    await flush(4);
    expect(count('/c1/void-and-reopen')).toBe(1);
    expect(btn(c, 'Huỷ và mở lại mã').getAttribute('aria-busy')).toBe('true');
    expect(btn(c, 'Huỷ').getAttribute('aria-busy')).toBeNull();
    expect(btn(c, 'Huỷ').getAttribute('aria-disabled')).toBe('true');
    await tap(btn(c, 'Huỷ và mở lại mã'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('/c1/void-and-reopen')).toBe(1);
    list.resolve();
    await flush();
  });
});

describe('ExternalClaimsTab: lời báo kết quả ở cấp danh sách', () => {
  it('duyệt xong, tải lại làm dòng rời bộ lọc "Cần duyệt": dòng mất nhưng lời "Đã duyệt" vẫn còn', async () => {
    claimsAfterReload = () => [];
    const c = await mount();
    await approve(c);
    expect(claimLoads).toBe(2);
    expect(c.querySelector('[data-external-claim]')).toBeNull();
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Đã duyệt, điểm đang chờ cộng.');
  });

  it('máy chủ từ chối vì yêu cầu đã đổi (409), tải lại làm dòng rời bộ lọc: dòng mất nhưng lời lỗi vẫn còn, khoá giữ tới khi danh sách về', async () => {
    writeStatus = 409;
    writeBody = { statusCode: 409, message: 'Yêu cầu này đã được xử lý.' };
    claimsAfterReload = () => [];
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await approve(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Yêu cầu này đã được xử lý.');
    expect(btn(c, 'Duyệt').getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(c.querySelector('[data-external-claim]')).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Yêu cầu này đã được xử lý.');
  });

  it('lỗi 500: lời lỗi hiện ngay, danh sách vẫn tải lại, khoá nhả sau khi danh sách về', async () => {
    writeStatus = 500;
    writeBody = { statusCode: 500, message: 'Máy chủ đang bận' };
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await approve(c);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(claimLoads).toBe(2);
    expect(btn(c, 'Duyệt').getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(btn(c, 'Duyệt').getAttribute('aria-disabled')).toBeNull();
  });

  it('lời lỗi cũ biến mất sau lần duyệt thành công kế tiếp', async () => {
    writeStatus = 409;
    writeBody = { statusCode: 409, message: 'Yêu cầu này đã được xử lý.' };
    const c = await mount();
    await approve(c);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    writeStatus = 200;
    await approve(c);
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Đã duyệt');
  });
});

describe('ExternalClaimsTab: lần gửi mã chưa ghép được (Gắn đơn / Từ chối)', () => {
  it('gắn đơn xong mà danh sách chưa về: hai nút aria-disabled (không disabled), chạm lại không mở hộp hỏi, đúng một POST attach', async () => {
    claimRows = [];
    attemptRows = [attempt()];
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await attach(c);
    expect(count('/attempts/a1/attach')).toBe(1);
    expect(attemptLoads).toBe(2);
    expect(btn(c, 'Gắn đơn').getAttribute('aria-busy')).toBe('true');
    expect(btn(c, 'Từ chối').getAttribute('aria-busy')).toBeNull();
    for (const t of ['Gắn đơn', 'Từ chối']) {
      expect(btn(c, t).getAttribute('aria-disabled')).toBe('true');
      expect(btn(c, t).disabled).toBe(false);
    }
    await tap(btn(c, 'Gắn đơn'));
    await tap(btn(c, 'Từ chối'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('/attempts/a1/attach')).toBe(1);
    list.resolve();
    await flush();
    expect(btn(c, 'Gắn đơn').getAttribute('aria-disabled')).toBeNull();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    claimRows = [];
    attemptRows = [attempt()];
    const c = await mount();
    useHangTimers();
    listGate = new Promise<void>(() => {});
    await rejectAttempt(c);
    await advance(3_500);
    expect(btn(c, 'Từ chối').getAttribute('aria-disabled')).toBe('true');
    await advance(700);
    expect(btn(c, 'Từ chối').getAttribute('aria-disabled')).toBeNull();
  });

  it('gắn đơn xong, tải lại làm dòng biến mất: lời "điểm đang chờ cộng" vẫn còn', async () => {
    claimRows = [];
    attemptRows = [attempt()];
    attemptsAfterReload = () => [];
    const c = await mount();
    await attach(c);
    expect(c.querySelector('[data-external-attempt]')).toBeNull();
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Đã gắn đơn, điểm đang chờ cộng.');
  });

  it('từ chối bị máy chủ từ chối (500): lời lỗi hiện, danh sách tải lại, khoá nhả sau khi danh sách về', async () => {
    claimRows = [];
    attemptRows = [attempt()];
    writeStatus = 500;
    writeBody = { statusCode: 500, message: 'Máy chủ đang bận' };
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await rejectAttempt(c);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(attemptLoads).toBe(2);
    expect(btn(c, 'Từ chối').getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(btn(c, 'Từ chối').getAttribute('aria-disabled')).toBeNull();
  });
});

describe('số dùng tabular-nums', () => {
  it('tiền hàng và điểm trên dòng yêu cầu', async () => {
    const c = await mount();
    expect(c.querySelector<HTMLElement>('[data-external-claim]')!.className).toContain('tabular-nums');
  });
});
