// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';
import { SubscriptionsPanel } from './subscriptions-panel';

// Mini App subscriptions-panel.spec.tsx (W98A): lệnh Tạm dừng/Tiếp tục/Huỷ/Bỏ qua kỳ và lưu Sửa bị 400/404/409 thì tải lại danh sách gói,
// khoá giữ tới lúc danh sách về (hạn 4 giây); lỗi tạm (401, 5xx, mất mạng) để nguyên danh sách.

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: 'authenticated', initialized: true, sessionUnavailable: false }) }));

const SUB = {
  id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-10-15T00:00:00.000Z', lastOrderAt: '2026-10-01T00:00:00.000Z',
  addressId: 'a1', paymentMethod: 'COD', lastOrderId: null,
  productName: 'Nước xả vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nxv', unitPrice: 80000, effectiveDiscountPct: 0.14,
};
const PAUSED = { ...SUB, status: 'PAUSED' };
const ADDR = (id: string, street: string) => ({
  id, recipient: 'Lan', phone: '0900000000', province: 'HCM', district: 'Q.1', ward: 'P.1', street,
  provinceCode: '79', districtCode: '760', wardCode: '1', isDefault: id === 'a1',
});

const LIST = 'GET /me/subscriptions';
const STATUS = 'POST /me/subscriptions/s1/status';
const SKIP = 'POST /me/subscriptions/s1/skip';
const PATCH = 'PATCH /me/subscriptions/s1';
const RETENTION_TITLE = 'Giữ lại lịch định kỳ?';
const STALE = [
  [400, 'Gói định kỳ đã huỷ, không sửa được nữa.'],
  [404, 'Không tìm thấy lịch đặt định kỳ.'],
  [409, 'Lịch giao vừa thay đổi, hãy tải lại rồi thử lại.'],
] as const;
const TRANSIENT: Array<[string, Failure]> = [
  ['401', { status: 401, message: 'Phiên hết hạn' }],
  ['403', { status: 403, message: 'Không có quyền' }],
  ['500', { status: 500, message: 'Internal server error' }],
  ['502', { status: 502, message: 'Bad gateway' }],
  ['503', { status: 503, message: 'Service unavailable' }],
  ['mất mạng', 'network'],
];

type Failure = { status: number; message: string } | 'network';
interface Call { method: string; path: string; body: unknown }
let calls: Call[] = [];
let subs: Record<string, unknown>[] = [SUB];
let failures: Record<string, Failure> = {};
let gates: Record<string, Promise<void>> = {};
/** Số lần tới đây GET danh sách trả 500 (đếm lùi), để ca "tải lại cũng lỗi" không phụ thuộc thứ tự lời gọi. */
let listFailures = 0;

/** Giữ request `METHOD /path` đang bay tới khi gọi hàm trả về. */
function hold(key: string) {
  let release!: () => void;
  gates[key] = new Promise<void>((r) => {
    release = r;
  });
  return release;
}

function stubApi() {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const key = `${method} ${path}`;
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      await gates[key];
      const fail = failures[key];
      if (fail === 'network') throw new TypeError('Failed to fetch');
      if (fail) return json({ message: fail.message }, fail.status);
      if (key === LIST) {
        if (listFailures > 0) {
          listFailures -= 1;
          return json({ message: 'boom' }, 500);
        }
        return json(subs);
      }
      if (key === 'GET /me/addresses') return json([ADDR('a1', '1 Lê Lợi'), ADDR('a2', '9 Hai Bà Trưng')]);
      if (key === 'GET /me/wallet') return json({ walletBalance: 50000 });
      if (key === 'GET /config/public') return json({ subscribeDiscountPct: 0.12 });
      return json(SUB);
    }),
  );
}
const sent = (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key);

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<SubscriptionsPanel />, new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }));
  mounted.push(r);
  await flush(8);
  return r.container;
};
const sheetEl = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const cardBtns = () => Array.from(document.querySelector('li')!.querySelectorAll('button')) as HTMLButtonElement[];
const EDIT = 0;
const TOGGLE = 1;
const CANCEL = 2;
const btn = (label: string, root: ParentNode = document.body) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label || b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
const inSheet = (label: string) => btn(label, sheetEl()!);
// Nút đang chạy đổi nhãn thành "Đang xử lý…" nên tìm theo aria-busy, không theo nhãn gốc.
const sheetBusyBtn = () => sheetEl()?.querySelector<HTMLButtonElement>('button[aria-busy="true"]') ?? undefined;
const idle = (label: string) => !!inSheet(label) && !busy(inSheet(label));
const isBusy = (label: string) => inSheet(label) === undefined && sheetBusyBtn()?.textContent === 'Đang xử lý…';
const alertText = () => document.body.querySelector('[role="alert"]')?.textContent ?? '';
const busy = (el: HTMLElement | undefined) => el?.getAttribute('aria-busy') === 'true';
const together = (...els: Array<HTMLElement | undefined>) =>
  act(() => {
    for (const el of els) el!.click();
  });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
async function openRetention() {
  click(cardBtns()[CANCEL]!);
  await flush(6);
  expect(sheetEl()?.textContent).toContain(RETENTION_TITLE);
}
async function openEditAndChange() {
  click(cardBtns()[EDIT]!);
  await flush(6);
  expect(document.body.textContent).toContain('Sửa gói định kỳ');
  click(btn('Tăng số lượng')!);
  await flush(2);
}

beforeEach(() => {
  subs = [SUB];
  failures = {};
  gates = {};
  listFailures = 0;
  stubApi();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('SubscriptionsPanel (web): lệnh bị từ chối vì gói đã đổi thì tải lại danh sách (W98A)', () => {
  describe.each(STALE)('%i', (status, message) => {
    it('"Tạm dừng" trên thẻ: tải lại một lần, thẻ hiện trạng thái thật (cron đã tạm dừng gói), nút nhả, báo lời máy chủ', async () => {
      await mount();
      subs = [PAUSED];
      failures[STATUS] = { status, message };
      click(cardBtns()[TOGGLE]!);
      await flush(10);
      expect(sent(STATUS)).toHaveLength(1);
      expect(sent(LIST)).toHaveLength(2);
      expect(cardBtns()[TOGGLE]!.textContent).toBe('Tiếp tục');
      expect(cardBtns()[TOGGLE]!.hasAttribute('aria-busy')).toBe(false);
      expect(cardBtns()[CANCEL]!.hasAttribute('aria-disabled')).toBe(false);
      expect(alertText()).toContain(message);
    });

    it('"Tiếp tục" trên thẻ: tải lại một lần, thẻ hiện trạng thái thật (máy khác đã bật lại)', async () => {
      subs = [PAUSED];
      await mount();
      subs = [SUB];
      failures[STATUS] = { status, message };
      expect(cardBtns()[TOGGLE]!.textContent).toBe('Tiếp tục');
      click(cardBtns()[TOGGLE]!);
      await flush(10);
      expect(sent(STATUS)).toHaveLength(1);
      expect(sent(LIST)).toHaveLength(2);
      expect(cardBtns()[TOGGLE]!.textContent).toBe('Tạm dừng');
      expect(cardBtns()[TOGGLE]!.hasAttribute('aria-busy')).toBe(false);
    });

    it('"Tạm dừng" trong sheet giữ chân: tải lại một lần, nút nhả, sheet vẫn mở với lời máy chủ', async () => {
      await mount();
      await openRetention();
      subs = [PAUSED];
      failures[STATUS] = { status, message };
      click(inSheet('Tạm dừng')!);
      await flush(10);
      expect(sent(STATUS)).toHaveLength(1);
      expect(sent(LIST)).toHaveLength(2);
      expect(idle('Tạm dừng')).toBe(true);
      expect(inSheet('Tạm dừng')!.disabled).toBe(false);
      expect(sheetEl()?.querySelector('[role="alert"]')?.textContent).toContain(message);
      expect(cardBtns()[TOGGLE]!.textContent).toBe('Tiếp tục');
    });

    it('"Vẫn huỷ" trong sheet: tải lại một lần, nút nhả, thẻ hiện đúng danh sách thật', async () => {
      await mount();
      await openRetention();
      subs = status === 404 ? [] : [PAUSED];
      failures[STATUS] = { status, message };
      click(inSheet('Vẫn huỷ')!);
      await flush(10);
      expect(sent(STATUS)).toHaveLength(1);
      expect(sent(LIST)).toHaveLength(2);
      expect(idle('Vẫn huỷ')).toBe(true);
      expect(inSheet('Vẫn huỷ')!.disabled).toBe(false);
      if (status === 404) expect(document.body.textContent).toContain('Chưa có lịch đặt định kỳ');
      else expect(cardBtns()[TOGGLE]!.textContent).toBe('Tiếp tục');
    });

    it('"Bỏ qua kỳ này": tải lại một lần, gói đã tạm dừng thì sheet hết nút "Bỏ qua kỳ này" (không bấm lặp lại cùng lỗi)', async () => {
      await mount();
      await openRetention();
      subs = [PAUSED];
      failures[SKIP] = { status, message };
      click(inSheet('Bỏ qua kỳ này')!);
      await flush(10);
      expect(sent(SKIP)).toHaveLength(1);
      expect(sent(LIST)).toHaveLength(2);
      expect(inSheet('Bỏ qua kỳ này')).toBeUndefined();
      expect(sheetEl()?.querySelector('[role="alert"]')?.textContent).toContain(message);
    });

    it('lưu ở sheet "Sửa": tải lại danh sách một lần, sheet vẫn mở với lời máy chủ, nút Lưu nhả', async () => {
      await mount();
      await openEditAndChange();
      failures[PATCH] = { status, message };
      // Gói trùng (409) hiện thêm một thẻ: chứng minh danh sách đã làm mới dù sheet vẫn mở.
      subs = [SUB, { ...SUB, id: 's2', addressId: 'a2', productName: 'Dầu gội Tubu' }];
      click(btn('Lưu thay đổi')!);
      await flush(10);
      expect(sent(PATCH)).toHaveLength(1);
      expect(sent(LIST)).toHaveLength(2);
      expect(document.body.textContent).toContain('Dầu gội Tubu');
      expect(document.body.textContent).toContain('Sửa gói định kỳ');
      expect(sheetEl()?.querySelector('[role="alert"]')?.textContent).toContain(message);
      expect(busy(btn('Lưu thay đổi'))).toBe(false);
    });
  });

  it('lưu ở sheet "Sửa" bị từ chối vì gói đã huỷ ở máy khác: gói rời danh sách nên sheet tự đóng', async () => {
    await mount();
    await openEditAndChange();
    failures[PATCH] = { status: 400, message: 'Gói định kỳ đã huỷ, không sửa được nữa.' };
    subs = [];
    click(btn('Lưu thay đổi')!);
    await flush(10);
    expect(sent(LIST)).toHaveLength(2);
    expect(document.body.textContent).not.toContain('Sửa gói định kỳ');
    expect(document.body.textContent).toContain('Chưa có lịch đặt định kỳ');
  });

  describe.each(TRANSIENT)('lỗi tạm %s: chỉ báo lỗi, KHÔNG tải lại danh sách, khoá nhả để bấm lại được', (_name, failure) => {
    it('"Tạm dừng" trên thẻ', async () => {
      await mount();
      failures[STATUS] = failure;
      click(cardBtns()[TOGGLE]!);
      await flush(10);
      expect(sent(STATUS)).toHaveLength(1);
      expect(sent(LIST)).toHaveLength(1);
      expect(alertText()).not.toBe('');
      expect(cardBtns()[TOGGLE]!.hasAttribute('aria-busy')).toBe(false);
      click(cardBtns()[TOGGLE]!);
      await flush(8);
      expect(sent(STATUS)).toHaveLength(2);
      expect(sent(LIST)).toHaveLength(1);
    });

    it('"Vẫn huỷ" trong sheet', async () => {
      await mount();
      await openRetention();
      failures[STATUS] = failure;
      click(inSheet('Vẫn huỷ')!);
      await flush(10);
      expect(sent(STATUS)).toHaveLength(1);
      expect(sent(LIST)).toHaveLength(1);
      expect(idle('Vẫn huỷ')).toBe(true);
      expect(sheetEl()?.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('"Bỏ qua kỳ này"', async () => {
      await mount();
      await openRetention();
      failures[SKIP] = failure;
      click(inSheet('Bỏ qua kỳ này')!);
      await flush(10);
      expect(sent(SKIP)).toHaveLength(1);
      expect(sent(LIST)).toHaveLength(1);
      expect(inSheet('Bỏ qua kỳ này')).toBeDefined();
      expect(idle('Bỏ qua kỳ này')).toBe(true);
    });

    it('lưu ở sheet "Sửa"', async () => {
      await mount();
      await openEditAndChange();
      failures[PATCH] = failure;
      click(btn('Lưu thay đổi')!);
      await flush(10);
      expect(sent(PATCH)).toHaveLength(1);
      expect(sent(LIST)).toHaveLength(1);
      expect(document.body.textContent).toContain('Sửa gói định kỳ');
      expect(busy(btn('Lưu thay đổi'))).toBe(false);
    });
  });

  describe('khoá giữ tới khi danh sách tải lại về', () => {
    it('"Tạm dừng" trên thẻ: nút thẻ còn bận, chạm đúp không gửi lệnh thứ hai; danh sách về thì nhả và hiện đúng trạng thái', async () => {
      await mount();
      subs = [PAUSED];
      failures[STATUS] = { status: 409, message: STALE[2][1] };
      const releaseList = hold(LIST);
      click(cardBtns()[TOGGLE]!);
      await flush(8);
      expect(sent(LIST)).toHaveLength(2);
      expect(busy(cardBtns()[TOGGLE])).toBe(true);
      expect(cardBtns()[EDIT]!.getAttribute('aria-disabled')).toBe('true');
      expect(cardBtns()[CANCEL]!.getAttribute('aria-disabled')).toBe('true');
      together(cardBtns()[TOGGLE], cardBtns()[TOGGLE]);
      await flush(3);
      expect(sent(STATUS)).toHaveLength(1);
      releaseList();
      await flush(8);
      expect(cardBtns()[TOGGLE]!.hasAttribute('aria-busy')).toBe(false);
      expect(cardBtns()[TOGGLE]!.textContent).toBe('Tiếp tục');
      expect(cardBtns()[EDIT]!.hasAttribute('aria-disabled')).toBe(false);
    });

    it('"Vẫn huỷ" trong sheet: nút bận, các nút còn lại bị khoá, bấm thêm không gửi lệnh; danh sách về thì nhả', async () => {
      await mount();
      await openRetention();
      subs = [PAUSED];
      failures[STATUS] = { status: 400, message: STALE[0][1] };
      const releaseList = hold(LIST);
      click(inSheet('Vẫn huỷ')!);
      await flush(8);
      expect(sent(LIST)).toHaveLength(2);
      expect(isBusy('Vẫn huỷ')).toBe(true);
      expect(inSheet('Tạm dừng')!.disabled).toBe(true);
      together(sheetBusyBtn(), sheetBusyBtn());
      await flush(3);
      expect(sent(STATUS)).toHaveLength(1);
      expect(sent(SKIP)).toHaveLength(0);
      releaseList();
      await flush(8);
      expect(idle('Vẫn huỷ')).toBe(true);
      expect(inSheet('Tạm dừng')!.disabled).toBe(false);
    });

    it('"Bỏ qua kỳ này": nút bận, bấm thêm không gửi lệnh (kể cả Tạm dừng/Vẫn huỷ); danh sách về thì nhả', async () => {
      await mount();
      await openRetention();
      subs = [PAUSED];
      failures[SKIP] = { status: 400, message: STALE[0][1] };
      const releaseList = hold(LIST);
      click(inSheet('Bỏ qua kỳ này')!);
      await flush(8);
      expect(sent(LIST)).toHaveLength(2);
      expect(isBusy('Bỏ qua kỳ này')).toBe(true);
      together(sheetBusyBtn(), inSheet('Tạm dừng'), inSheet('Vẫn huỷ'));
      await flush(3);
      expect(sent(SKIP)).toHaveLength(1);
      expect(sent(STATUS)).toHaveLength(0);
      releaseList();
      await flush(8);
      expect(inSheet('Bỏ qua kỳ này')).toBeUndefined();
      expect(inSheet('Vẫn huỷ')!.disabled).toBe(false);
    });

    it('lưu ở sheet "Sửa" không giữ nút Lưu chờ danh sách (như Mini): lời lỗi hiện ngay trong sheet, tải lại chạy nền', async () => {
      await mount();
      await openEditAndChange();
      failures[PATCH] = { status: 409, message: 'Bạn đã có gói giao định kỳ tới địa chỉ này.' };
      const releaseList = hold(LIST);
      click(btn('Lưu thay đổi')!);
      await flush(8);
      expect(sent(LIST)).toHaveLength(2);
      expect(busy(btn('Lưu thay đổi'))).toBe(false);
      expect(sheetEl()?.querySelector('[role="alert"]')?.textContent).toContain('Bạn đã có gói giao định kỳ');
      releaseList();
      await flush(6);
    });
  });

  describe('danh sách tải lại không bao giờ về: khoá nhả sau 4 giây', () => {
    beforeEach(() => {
      // shouldAdvanceTime để `flush` (setTimeout 0) và bộ đếm giờ của react-query vẫn chạy; chỉ cần giả setTimeout để tua tới hạn.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    });
    afterEach(() => vi.useRealTimers());

    it('"Tạm dừng" trên thẻ bị 409: còn khoá ở 3 giây, nhả sau 4 giây, bấm lại gửi lệnh mới', async () => {
      await mount();
      failures[STATUS] = { status: 409, message: STALE[2][1] };
      hold(LIST);
      click(cardBtns()[TOGGLE]!);
      await flush(6);
      expect(sent(STATUS)).toHaveLength(1);
      expect(sent(LIST)).toHaveLength(2);
      await advance(3_000);
      expect(busy(cardBtns()[TOGGLE])).toBe(true);
      together(cardBtns()[TOGGLE], cardBtns()[TOGGLE]);
      expect(sent(STATUS)).toHaveLength(1);
      await advance(1_500);
      await flush(4);
      expect(cardBtns()[TOGGLE]!.hasAttribute('aria-busy')).toBe(false);
      click(cardBtns()[TOGGLE]!);
      await flush(6);
      expect(sent(STATUS)).toHaveLength(2);
    });

    it('"Vẫn huỷ" bị 400: nút còn bận ở 3 giây, nhả sau 4 giây', async () => {
      await mount();
      await openRetention();
      failures[STATUS] = { status: 400, message: STALE[0][1] };
      hold(LIST);
      click(inSheet('Vẫn huỷ')!);
      await flush(6);
      await advance(3_000);
      expect(isBusy('Vẫn huỷ')).toBe(true);
      together(sheetBusyBtn());
      expect(sent(STATUS)).toHaveLength(1);
      await advance(1_500);
      await flush(4);
      expect(idle('Vẫn huỷ')).toBe(true);
      expect(inSheet('Tạm dừng')!.disabled).toBe(false);
    });

    it('"Bỏ qua kỳ này" bị 404: nút còn bận ở 3 giây, nhả sau 4 giây', async () => {
      await mount();
      await openRetention();
      failures[SKIP] = { status: 404, message: STALE[1][1] };
      hold(LIST);
      click(inSheet('Bỏ qua kỳ này')!);
      await flush(6);
      await advance(3_000);
      expect(isBusy('Bỏ qua kỳ này')).toBe(true);
      together(sheetBusyBtn());
      expect(sent(SKIP)).toHaveLength(1);
      await advance(1_500);
      await flush(4);
      expect(idle('Bỏ qua kỳ này')).toBe(true);
    });
  });

  describe('tải lại cũng lỗi', () => {
    it('danh sách tải lại trả 500: không ném ra ngoài, khoá vẫn nhả, màn hiện vùng lỗi tải với "Thử lại"; tải được thì thẻ về và bấm lại được', async () => {
      await mount();
      failures[STATUS] = { status: 409, message: STALE[2][1] };
      listFailures = 1;
      const unhandled = await captureUnhandledRejections(async () => {
        click(cardBtns()[TOGGLE]!);
        await flush(10);
      });
      expect(unhandled).toEqual([]);
      expect(sent(STATUS)).toHaveLength(1);
      expect(sent(LIST)).toHaveLength(2);
      expect(btn('Thử lại')).toBeDefined();
      expect(Array.from(document.querySelectorAll('[role="alert"]')).some((a) => a.textContent?.includes(STALE[2][1]))).toBe(true);
      click(btn('Thử lại')!);
      await flush(8);
      expect(sent(LIST)).toHaveLength(3);
      click(cardBtns()[TOGGLE]!);
      await flush(8);
      expect(sent(STATUS)).toHaveLength(2);
    });

    it('lỗi tạm và lỗi cũ không để lại Promise bị từ chối', async () => {
      await mount();
      await openRetention();
      failures[STATUS] = 'network';
      failures[SKIP] = { status: 400, message: STALE[0][1] };
      const unhandled = await captureUnhandledRejections(async () => {
        click(inSheet('Vẫn huỷ')!);
        await flush(8);
        click(inSheet('Bỏ qua kỳ này')!);
        await flush(8);
      });
      expect(unhandled).toEqual([]);
    });
  });
});
