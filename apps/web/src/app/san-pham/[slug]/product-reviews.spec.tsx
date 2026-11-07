// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// R8: mỗi lần mua (đơn) một đánh giá. Web theo đúng luật của Mini App: nút đầu mục viết cho đơn còn viết được, đánh
// giá đã có sửa ở đúng dòng của nó, chỉ đánh giá đầu tiên của sản phẩm được hứa Điểm Xanh.

const mocks = vi.hoisted(() => ({
  auth: { status: 'authenticated', initialized: true, sessionUnavailable: false } as Record<string, unknown>,
  search: '',
  list: null as unknown,
  /** Kết quả riêng của một chip (Error để báo lỗi, Promise để giữ ở trạng thái chờ); thiếu thì lọc `list` như máy chủ. */
  filtered: {} as Record<string, unknown>,
  /** Trang sau trang đầu theo `<chip>@<cursor>` (Error để báo lỗi). */
  pages: {} as Record<string, unknown>,
  /** Máy chủ giả có thứ tự (thay `list`/`pages`) cho ca nhiều trang. */
  serve: null as null | ((filter: number | string, cursor?: string) => unknown),
  listCalls: [] as unknown[],
  elig: null as unknown,
  mine: {} as Record<string, unknown>,
  myCalls: [] as string[],
  eligCalls: 0,
  saved: [] as { slug: string; body: Record<string, unknown> }[],
  saveResult: { id: 'new', updated: false, pointsEarned: 0 } as unknown,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(mocks.search) }));
vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) => (
    <button type="button" className="min-h-11" onClick={() => onChange([...value, 'data:image/jpeg;base64,AAAA'])}>
      {label} ({value.length})
    </button>
  ),
}));
vi.mock('@/lib/reviews-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reviews-client')>()),
  fetchProductReviews: async (_slug: string, filter: number | string = 'all', cursor?: string) => {
    if (mocks.serve) {
      mocks.listCalls.push(cursor ? `${filter}@${cursor}` : filter);
      const out = await mocks.serve(filter, cursor);
      if (out instanceof Error) throw out;
      return out;
    }
    if (cursor) {
      mocks.listCalls.push(`${filter}@${cursor}`);
      const page = mocks.pages[`${filter}@${cursor}`];
      if (page instanceof Error) throw page;
      return page;
    }
    mocks.listCalls.push(filter);
    if (filter === 'all') return mocks.list;
    const own = mocks.filtered[String(filter)];
    if (own instanceof Error) throw own;
    if (own) return own;
    const all = mocks.list as { items: { rating: number; images: string[]; videoUrl: string | null }[] };
    const items = all.items.filter((r) => (filter === 'photo' ? r.images.length > 0 : filter === 'video' ? Boolean(r.videoUrl) : r.rating === filter));
    return { ...all, items };
  },
  fetchCanReview: async () => {
    mocks.eligCalls += 1;
    if (mocks.elig instanceof Error) throw mocks.elig;
    return mocks.elig;
  },
  fetchMyReview: async (id: string) => {
    mocks.myCalls.push(id);
    const r = mocks.mine[id];
    if (r instanceof Error) throw r;
    return r;
  },
  saveReview: async (slug: string, body: Record<string, unknown>) => {
    mocks.saved.push({ slug, body });
    if (mocks.saveResult instanceof Error) throw mocks.saveResult;
    return mocks.saveResult;
  },
}));

import { ProductReviews, Stars } from './product-reviews';

const review = (id: string, rating: number, extra: Record<string, unknown> = {}) => ({
  id,
  rating,
  author: `Khách ${id}`,
  avatar: null,
  comment: `Nhận xét ${id}`,
  images: [],
  videoUrl: null,
  verifiedPurchase: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...extra,
});
const LIST = {
  count: 3,
  average: 4.3,
  videoCount: 0,
  distribution: { '5': 2, '3': 1 },
  items: [review('a', 5), review('b', 5), review('c', 3, { images: ['/reviews/c/images/0?v=1'] })],
};
const O1 = { orderId: 'o1', code: 'TB0001', deliveredAt: '2026-08-01T00:00:00.000Z' };
const O2 = { orderId: 'o2', code: 'TB0002', deliveredAt: '2026-09-10T00:00:00.000Z' };
const REF_A = { id: 'a', orderId: 'o1', orderCode: 'TB0001', rating: 5, createdAt: '2026-08-05T00:00:00.000Z', isVisible: true };
const REF_B = { id: 'b', orderId: 'o2', orderCode: 'TB0002', rating: 5, createdAt: '2026-09-12T00:00:00.000Z', isVisible: true };
const MINE_A = { id: 'a', orderId: 'o1', rating: 4, comment: 'Dùng ổn', images: ['data:image/jpeg;base64,OLD'], videoUrl: 'https://res.cloudinary.com/x/v.mp4', isVisible: true };
const MINE_B = { id: 'b', orderId: 'o2', rating: 3, comment: 'Lần này hơi khô', images: [], videoUrl: null, isVisible: true };
const ELIG_NEW = { canReview: true, reason: null, rewardAvailable: true, purchaseCount: 1, reviewableOrders: [O1], myReviews: [] };
const ELIG_REPEAT = { canReview: true, reason: null, rewardAvailable: false, purchaseCount: 2, reviewableOrders: [O2], myReviews: [REF_A] };
const ELIG_ALL = { canReview: false, reason: 'ALL_REVIEWED', rewardAvailable: false, purchaseCount: 2, reviewableOrders: [], myReviews: [REF_B, REF_A] };
const REWARD_ALREADY_GIVEN = 'Bạn đã nhận Điểm Xanh cho đánh giá đầu tiên của sản phẩm này, đánh giá lần mua này không cộng thêm điểm.';
const EDIT_HINT = 'Chỉ lần đánh giá đầu tiên của mỗi sản phẩm được cộng Điểm Xanh, sửa đánh giá không cộng thêm.';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<ProductReviews slug="nuoc-rua-chen" />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const button = (c: HTMLElement, text: string | RegExp) => byText(c, 'button', text);
/** Bấm chip lọc rồi đợi kết quả máy chủ của chip đó. */
const pick = async (c: HTMLElement, text: string | RegExp) => {
  click(button(c, text));
  await flush(8);
};
const buttonNamed = (c: HTMLElement, name: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const form = (c: HTMLElement) => c.querySelector('form');
const configureVideo = () => {
  vi.stubEnv('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME', 'demo');
  vi.stubEnv('NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET', 'reviews');
};
const pickVideo = (c: HTMLElement) => {
  const input = c.querySelector<HTMLInputElement>('input[type="file"][accept="video/*"]')!;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'v.mp4', { type: 'video/mp4' })], configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const star = (c: HTMLElement, n: number) => c.querySelector<HTMLButtonElement>(`[role="radiogroup"] button[aria-label="${n} sao"]`);

beforeEach(() => {
  mocks.auth = { status: 'authenticated', initialized: true, sessionUnavailable: false };
  mocks.search = '';
  mocks.list = structuredClone(LIST);
  mocks.filtered = {};
  mocks.pages = {};
  mocks.serve = null;
  mocks.listCalls = [];
  mocks.elig = structuredClone(ELIG_REPEAT);
  mocks.mine = { a: structuredClone(MINE_A), b: structuredClone(MINE_B) };
  mocks.myCalls = [];
  mocks.eligCalls = 0;
  mocks.saved = [];
  mocks.saveResult = { id: 'new', updated: false, pointsEarned: 0 };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('ProductReviews (web) — danh sách công khai', () => {
  it('tiêu đề kèm số đánh giá, điểm trung bình, phân bổ sao và mọi đánh giá đang hiện; ảnh API ghép gốc API', async () => {
    const c = await mount();
    expect(c.querySelector('h2')?.textContent).toBe('Đánh giá (3)');
    expect(c.textContent).toContain('4,3');
    expect(c.querySelectorAll('li.border-t')).toHaveLength(3);
    expect(c.querySelector('[aria-label="Phân bổ số sao"]')?.textContent).toContain('5');
    expect(c.querySelector<HTMLImageElement>('button[aria-label="Xem ảnh đánh giá 1"] img')!.src).toMatch(/\/reviews\/c\/images\/0\?v=1$/);
  });

  describe('W42B: xem ảnh/video đánh giá toàn màn hình', () => {
    const lightbox = () => document.querySelector<HTMLElement>('[data-testid="review-lightbox"]');
    const closeLightbox = () => click(document.querySelector('[data-testid="review-lightbox"] button[aria-label="Đóng"]'));

    it('bấm ảnh mở lightbox ở đúng ảnh; × đóng', async () => {
      const c = await mount();
      expect(lightbox()).toBeNull();
      click(c.querySelector('button[aria-label="Xem ảnh đánh giá 1"]'));
      const box = lightbox()!;
      expect(box).not.toBeNull();
      expect(box.getAttribute('role')).toBe('dialog');
      expect(box.getAttribute('aria-modal')).toBe('true');
      expect(box.className).toContain('review-lightbox');
      expect(box.querySelector<HTMLImageElement>('img')!.src).toMatch(/\/reviews\/c\/images\/0\?v=1$/);
      expect(box.querySelector('[aria-live="polite"]')!.textContent).toBe('1 / 1');
      closeLightbox();
      expect(lightbox()).toBeNull();
    });

    it('chỉ có một tệp thì không có nút Trước/Sau; Esc đóng', async () => {
      const c = await mount();
      click(c.querySelector('button[aria-label="Xem ảnh đánh giá 1"]'));
      expect(lightbox()!.querySelector('button[aria-label="Tệp trước"]')).toBeNull();
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(lightbox()).toBeNull();
    });
  });

  it('W40A: mục Đánh giá vẽ số đều (tabular-nums) và ngôi sao chọn co khi nhấn (tubu-press)', async () => {
    const c = await mount();
    expect(c.querySelector('section#danh-gia')!.className).toContain('tabular-nums');
    click(button(c, 'Viết đánh giá'));
    await flush();
    expect(star(c, 3)!.className).toContain('tubu-press');
  });

  it('ngôi sao chưa tô dùng --stone-450 (đủ tương phản 3:1 với nền), không còn stone-200', async () => {
    const c = await mount();
    const cls = Array.from(c.querySelectorAll('svg')).map((s) => s.getAttribute('class') ?? '');
    expect(cls.some((k) => k.includes('--stone-450'))).toBe(true);
    expect(cls.some((k) => k.includes('stone-200'))).toBe(false);
  });

  it('hơn 5 đánh giá: hiện 5 rồi "Xem thêm đánh giá"; hiện hết mà không còn trang thì ẩn nút, không gọi trang kế', async () => {
    mocks.list = { ...LIST, count: 7, items: Array.from({ length: 7 }, (_, i) => review(`r${i}`, 5)) };
    const c = await mount();
    expect(c.querySelectorAll('li.border-t')).toHaveLength(5);
    click(button(c, 'Xem thêm đánh giá'));
    expect(c.querySelectorAll('li.border-t')).toHaveLength(7);
    expect(button(c, 'Xem thêm đánh giá')).toBeFalsy();
    expect(mocks.listCalls).toEqual(['all']);
  });

  // Phân trang con trỏ: mỗi trang máy chủ 100 dòng kèm nextCursor; mock dùng trang nhỏ để thấy chỗ nối.
  describe('"Xem thêm đánh giá": tải trang kế bằng nextCursor', () => {
    const FIRST = Array.from({ length: 6 }, (_, i) => review(`p${i}`, 5));
    const SECOND = [review('q0', 4), review('q1', 4), review('q2', 4)];
    const PAGED = { ...LIST, count: 9, distribution: { '5': 6, '4': 3 } };
    const shown = (c: HTMLElement) => Array.from(c.querySelectorAll('li.border-t p')).map((p) => p.textContent);
    const settle = async (c: HTMLElement, text: string) => {
      for (let n = 0; n < 40 && !c.textContent!.includes(text); n++) await flush();
    };

    it('hết dòng đã tải thì gọi trang kế đúng con trỏ, nối vào cuối, dòng cũ giữ nguyên; hết trang thì ẩn nút', async () => {
      mocks.list = { ...PAGED, items: FIRST, nextCursor: 'c1' };
      mocks.pages = { 'all@c1': { ...PAGED, items: SECOND, nextCursor: null } };
      const c = await mount();
      expect(shown(c)).toEqual(['Nhận xét p0', 'Nhận xét p1', 'Nhận xét p2', 'Nhận xét p3', 'Nhận xét p4']);
      click(button(c, 'Xem thêm đánh giá'));
      await settle(c, 'Nhận xét q2');
      expect(mocks.listCalls).toEqual(['all', 'all@c1']);
      expect(shown(c)).toEqual([...FIRST, ...SECOND].map((r) => `Nhận xét ${r.id}`));
      expect(button(c, 'Xem thêm đánh giá')).toBeFalsy();
    });

    it('chip lọc: trang kế gửi kèm chip và con trỏ của chip; đổi chip về trang đầu', async () => {
      mocks.list = { ...PAGED, items: FIRST, nextCursor: 'c1' };
      mocks.filtered = { '4': { ...PAGED, items: SECOND, nextCursor: 'k1' } };
      mocks.pages = { 'all@c1': { ...PAGED, items: SECOND, nextCursor: null }, '4@k1': { ...PAGED, items: [review('q9', 4)], nextCursor: null } };
      const c = await mount();
      click(button(c, 'Xem thêm đánh giá'));
      await settle(c, 'Nhận xét q2');
      await pick(c, '4 sao');
      expect(shown(c)).toEqual(['Nhận xét q0', 'Nhận xét q1', 'Nhận xét q2']);
      click(button(c, 'Xem thêm đánh giá'));
      await settle(c, 'Nhận xét q9');
      expect(mocks.listCalls).toContain('4@k1');
      expect(shown(c)).toEqual(['Nhận xét q0', 'Nhận xét q1', 'Nhận xét q2', 'Nhận xét q9']);
      await pick(c, 'Tất cả');
      expect(shown(c)).toEqual(['Nhận xét p0', 'Nhận xét p1', 'Nhận xét p2', 'Nhận xét p3', 'Nhận xét p4']);
      expect(button(c, 'Xem thêm đánh giá')).toBeTruthy();
    });

    /** Máy chủ giả có thứ tự: trang `size` dòng, con trỏ là id dòng cuối, như keyset của API. */
    const server = (rows: () => ReturnType<typeof review>[], size = 6) => (_f: number | string, cursor?: string) => {
      const all = rows();
      const start = cursor ? all.findIndex((r) => r.id === cursor) + 1 : 0;
      const items = all.slice(start, start + size);
      return { ...PAGED, count: all.length, items, nextCursor: start + size < all.length ? items.at(-1)!.id : null };
    };
    const ROWS = Array.from({ length: 15 }, (_, i) => review(`r${i}`, 5));
    const ids = (list: string[]) => list.map((id) => `Nhận xét ${id}`);

    it('nhiều trang: mỗi lần bấm tải thêm khi dòng đã tải không đủ; đang tải thì nút quay và không nhận bấm; trang cuối thì ẩn nút', async () => {
      let release: () => void = () => undefined;
      const base = server(() => ROWS);
      mocks.serve = (f, cursor) => (cursor === 'r5' ? new Promise((r) => (release = () => r(base(f, cursor)))) : base(f, cursor));
      const c = await mount();
      click(button(c, 'Xem thêm đánh giá'));
      await flush(4);
      const busy = button(c, 'Xem thêm đánh giá')!;
      expect(busy.getAttribute('aria-busy')).toBe('true');
      expect(busy.querySelector('svg.animate-spin')).not.toBeNull();
      click(busy);
      await flush(4);
      expect(mocks.listCalls).toEqual(['all', 'all@r5']);
      await act(async () => release());
      await settle(c, 'Nhận xét r9');
      expect(shown(c)).toEqual(ids(ROWS.slice(0, 10).map((r) => r.id)));
      expect(button(c, 'Xem thêm đánh giá')!.querySelector('svg.animate-spin')).toBeNull();
      click(button(c, 'Xem thêm đánh giá'));
      await settle(c, 'Nhận xét r14');
      expect(mocks.listCalls).toEqual(['all', 'all@r5', 'all@r11']);
      expect(shown(c)).toEqual(ids(ROWS.map((r) => r.id)));
      expect(button(c, 'Xem thêm đánh giá')).toBeFalsy();
    });

    it('trang đầu tải lại có đánh giá mới (dòng cuối đổi): các trang sau tải lại từ con trỏ mới, đủ số dòng đang hiện', async () => {
      let rows = ROWS;
      mocks.serve = server(() => rows);
      const c = await mount();
      click(button(c, 'Xem thêm đánh giá'));
      await settle(c, 'Nhận xét r9');
      click(button(c, 'Xem thêm đánh giá'));
      await settle(c, 'Nhận xét r14');
      rows = [review('moi', 5), ...ROWS];
      try {
        await act(async () => {
          focusManager.setFocused(false);
          focusManager.setFocused(true);
        });
        const want = ids(['moi', ...ROWS.slice(0, 14).map((r) => r.id)]);
        for (let n = 0; n < 60 && JSON.stringify(shown(c)) !== JSON.stringify(want); n++) await flush();
        expect(shown(c)).toEqual(want);
        expect(mocks.listCalls).toEqual(expect.arrayContaining(['all@r4', 'all@r10']));
      } finally {
        focusManager.setFocused(undefined);
      }
    });

    it('lỗi tải lại nền khi còn dòng đã tải chưa hiện: vẫn có nút "Xem thêm đánh giá", không thay bằng báo lỗi', async () => {
      let fail = false;
      const ok = server(() => ROWS);
      mocks.serve = (f, cursor) => (cursor && fail ? new Error('mất mạng') : ok(f, cursor));
      const c = await mount();
      click(button(c, 'Xem thêm đánh giá'));
      await settle(c, 'Nhận xét r9');
      fail = true;
      try {
        await act(async () => {
          focusManager.setFocused(false);
          focusManager.setFocused(true);
        });
        for (let n = 0; n < 40 && mocks.listCalls.filter((x) => x === 'all@r5').length < 2; n++) await flush();
        await flush(8);
        expect(mocks.listCalls.filter((x) => x === 'all@r5')).toHaveLength(2);
        expect(shown(c)).toHaveLength(10);
        expect(c.textContent).not.toContain('Không tải được đánh giá.');
        expect(button(c, 'Xem thêm đánh giá')).toBeTruthy();
      } finally {
        focusManager.setFocused(undefined);
      }
    });

    it('trang kế tải lỗi: dòng đang hiện giữ nguyên, "Không tải được đánh giá." kèm Thử lại; thử lại thì nối trang kế', async () => {
      mocks.list = { ...PAGED, items: FIRST, nextCursor: 'c1' };
      mocks.pages = { 'all@c1': new Error('mất mạng') };
      const c = await mount();
      click(button(c, 'Xem thêm đánh giá'));
      await settle(c, 'Không tải được đánh giá.');
      expect(shown(c)).toEqual(FIRST.map((r) => `Nhận xét ${r.id}`));
      mocks.pages = { 'all@c1': { ...PAGED, items: SECOND, nextCursor: null } };
      click(button(c, 'Thử lại'));
      await settle(c, 'Nhận xét q2');
      expect(shown(c)).toHaveLength(9);
      expect(c.textContent).not.toContain('Không tải được đánh giá.');
    });
  });

  it('lọc 2 sao và 1 sao: chỉ còn đúng đánh giá mức đó, mức không có đánh giá ra trạng thái rỗng', async () => {
    mocks.list = { ...LIST, count: 4, items: [review('s5', 5), review('s2', 2), review('s2b', 2), review('s1', 1)] };
    const c = await mount();
    await pick(c, '2 sao');
    expect(c.querySelectorAll('li.border-t')).toHaveLength(2);
    expect(button(c, '2 sao')!.getAttribute('aria-pressed')).toBe('true');
    await pick(c, '1 sao');
    expect(c.querySelectorAll('li.border-t')).toHaveLength(1);
    expect(c.textContent).toContain('Nhận xét s1');
    await pick(c, '4 sao');
    expect(c.querySelectorAll('li.border-t')).toHaveLength(0);
  });

  it('hàng chip lọc như Mini App: Tất cả (chọn sẵn), 5/4/3/2/1 sao, Có ảnh; chọn chip thì chỉ còn đánh giá khớp', async () => {
    const c = await mount();
    const chips = () => Array.from(c.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
    expect(chips().map((b) => b.textContent)).toEqual(['Tất cả(3)', '5 sao(2)', '4 sao(0)', '3 sao(1)', '2 sao(0)', '1 sao(0)', 'Có ảnh']);
    expect(chips()[0]!.getAttribute('aria-pressed')).toBe('true');
    await pick(c, '5 sao');
    expect(c.querySelectorAll('li.border-t')).toHaveLength(2);
    expect(button(c, '5 sao')!.getAttribute('aria-pressed')).toBe('true');
    await pick(c, 'Có ảnh');
    expect(c.querySelectorAll('li.border-t')).toHaveLength(1);
    await pick(c, '4 sao');
    expect(c.querySelectorAll('li.border-t')).toHaveLength(0);
    // Như Mini App: trạng thái rỗng dùng EmptyState inline (hình kính lúp), không phải một dòng chữ nhỏ.
    for (let n = 0; n < 40 && !c.textContent!.includes('Không có đánh giá khớp bộ lọc.'); n++) await flush();
    expect(c.textContent).toContain('Không có đánh giá khớp bộ lọc.');
    const empty = c.querySelector<HTMLElement>('.tubu-rise')!;
    expect(empty.querySelector('svg')).not.toBeNull();
    expect(empty.textContent).toBe('Không có đánh giá khớp bộ lọc.');
    expect(c.querySelector('p.text-center')).toBeNull();
  });

  it('chip "Có video" chỉ có khi sản phẩm có video; đổi bộ lọc đưa danh sách về 5 dòng đầu', async () => {
    mocks.list = { ...LIST, count: 8, videoCount: 1, items: Array.from({ length: 8 }, (_, i) => review(`r${i}`, 5, i === 6 ? { videoUrl: 'https://cdn/v.mp4' } : {})) };
    const c = await mount();
    expect(button(c, /^Có video/)!.textContent).toBe('Có video(1)');
    click(button(c, 'Xem thêm đánh giá'));
    expect(c.querySelectorAll('li.border-t')).toHaveLength(8);
    await pick(c, '5 sao');
    expect(c.querySelectorAll('li.border-t')).toHaveLength(5);
    await pick(c, /^Có video/);
    expect(c.querySelectorAll('li.border-t')).toHaveLength(1);
  });

  // Đánh giá video cuối cùng bị ẩn lúc khách đang xem chip "Có video", rồi danh sách tải lại nền (ở app thật: làm mới `['reviews', slug]` sau khi khách viết hoặc sửa
  // đánh giá). Test dùng đổi focus làm cách gọi tải lại nền; hành vi kiểm là chip không được biến mất (danh sách trống mà không chip nào sáng).
  it('đang chọn "Có video" mà video cuối cùng bị ẩn: chip ở lại ghi (0) và còn sáng, "Tất cả" mới bỏ chip', async () => {
    const withVideo = { ...LIST, count: 3, videoCount: 1, items: [review('a', 5), review('b', 5), review('v', 4, { videoUrl: 'https://cdn/v.mp4' })] };
    const gone = { ...LIST, count: 2, videoCount: 0, items: [review('a', 5), review('b', 5)] };
    let videoGone = false;
    mocks.serve = (filter) => {
      const src = videoGone ? gone : withVideo;
      return filter === 'video' ? { ...src, items: src.items.filter((r) => r.videoUrl) } : src;
    };
    const c = await mount();
    await pick(c, /^Có video/);
    expect(c.querySelectorAll('li.border-t')).toHaveLength(1);
    videoGone = true;
    try {
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await flush(8);
    } finally {
      focusManager.setFocused(undefined);
    }
    const chip = button(c, /^Có video/);
    expect(chip?.textContent).toBe('Có video(0)');
    expect(chip?.getAttribute('aria-pressed')).toBe('true');
    expect(c.textContent).toContain('Không có đánh giá khớp bộ lọc.');
    await pick(c, 'Tất cả');
    expect(button(c, /^Có video/)).toBeFalsy();
  });

  // Sản phẩm 123 đánh giá: trang đầu chỉ có 100 dòng 5 sao mới nhất. Số trên chip phải là số máy chủ đếm trên mọi đánh giá.
  it('chip ghi số máy chủ đếm (count, distribution, videoCount), không đếm 100 dòng đã tải; "Có ảnh" không ghi số', async () => {
    mocks.list = { ...LIST, count: 123, distribution: { '5': 120, '1': 3 }, videoCount: 2, items: Array.from({ length: 100 }, (_, i) => review(`n${i}`, 5)) };
    const c = await mount();
    const chips = Array.from(c.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')).map((b) => b.textContent);
    expect(chips).toEqual(['Tất cả(123)', '5 sao(120)', '4 sao(0)', '3 sao(0)', '2 sao(0)', '1 sao(3)', 'Có ảnh', 'Có video(2)']);
  });

  it('API cũ chưa trả videoCount: chip "Có video" đếm trên các đánh giá đã tải thay vì biến mất; bấm thì hỏi máy chủ bộ lọc video', async () => {
    const { videoCount: _omit, ...old } = LIST;
    mocks.list = { ...old, items: [review('a', 5), review('v', 4, { videoUrl: 'https://cdn/v.mp4' })] };
    const c = await mount();
    expect(button(c, /^Có video/)?.textContent).toBe('Có video(1)');
    await pick(c, /^Có video/);
    expect(mocks.listCalls).toEqual(['all', 'video']);
    expect(c.querySelectorAll('li.border-t')).toHaveLength(1);
  });

  it('gửi máy chủ đúng chip: "Tất cả" không kèm bộ lọc, chip sao kèm số sao, "Có ảnh" kèm photo', async () => {
    const c = await mount();
    expect(mocks.listCalls).toEqual(['all']);
    await pick(c, '1 sao');
    await pick(c, 'Có ảnh');
    expect(mocks.listCalls).toEqual(['all', 1, 'photo']);
  });

  // Lỗi gốc: danh sách đầy đủ chỉ có 100 đánh giá mới nhất. Sản phẩm 120 đánh giá 5 sao mới + 3 đánh giá 1 sao cũ thì lọc 1 sao
  // trên 100 dòng đó ra rỗng dù phân bố sao ghi 3.
  it('100 dòng mới nhất toàn 5 sao: chip "1 sao" chờ máy chủ (không báo rỗng tạm), rồi hiện đủ 3 đánh giá 1 sao cũ', async () => {
    mocks.list = { ...LIST, count: 123, distribution: { '5': 120, '1': 3 }, items: Array.from({ length: 100 }, (_, i) => review(`n${i}`, 5)), nextCursor: 'c-n99' };
    let answer: (v: unknown) => void = () => undefined;
    mocks.filtered = { '1': new Promise((r) => (answer = r)) };
    const c = await mount();
    expect(button(c, 'Xem thêm đánh giá')).toBeTruthy();
    await pick(c, '1 sao');
    expect(c.querySelector('[aria-busy="true"]')?.textContent).toBe('Đang tải đánh giá…');
    expect(c.textContent).not.toContain('Không có đánh giá khớp bộ lọc.');
    expect(c.querySelectorAll('li.border-t')).toHaveLength(0);
    await act(async () => answer({ ...LIST, count: 123, items: [review('cu1', 1), review('cu2', 1), review('cu3', 1)], nextCursor: null }));
    await flush(8);
    expect(c.querySelectorAll('li.border-t')).toHaveLength(3);
    expect(c.textContent).toContain('Nhận xét cu3');
    expect(c.textContent).not.toContain('Không có đánh giá khớp bộ lọc.');
    expect(button(c, 'Xem thêm đánh giá')).toBeFalsy();
    expect(c.querySelector('h2')?.textContent).toBe('Đánh giá (123)');
  });

  it('chip lọc tải lỗi: "Không tải được đánh giá." kèm Thử lại, thống kê vẫn còn; thử lại thì hiện kết quả', async () => {
    mocks.filtered = { '3': new Error('mất mạng') };
    const c = await mount();
    await pick(c, '3 sao');
    expect(c.textContent).toContain('Không tải được đánh giá.');
    expect(c.textContent).not.toContain('Không có đánh giá khớp bộ lọc.');
    expect(c.querySelector('h2')?.textContent).toBe('Đánh giá (3)');
    mocks.filtered = {};
    click(button(c, 'Thử lại'));
    await flush(8);
    expect(c.querySelectorAll('li.border-t')).toHaveLength(1);
    expect(c.textContent).toContain('Nhận xét c');
  });

  it('điện thoại: dải trắng riêng; "Viết đánh giá" và "Xem thêm đánh giá" là nút chữ thương hiệu, không viền như Mini App', async () => {
    mocks.list = { ...LIST, count: 7, items: Array.from({ length: 7 }, (_, i) => review(`r${i}`, 5)) };
    const c = await mount();
    const section = c.querySelector('section#danh-gia')!;
    expect(section.getAttribute('data-section')).toBe('pdp-reviews');
    expect(section.className).toContain('max-md:bg-[var(--color-bg-surface)]');
    for (const name of ['Viết đánh giá', 'Xem thêm đánh giá']) {
      const b = button(c, name)!;
      expect(b.className).toContain('max-md:bg-transparent');
      expect(b.className).toContain('max-md:border-transparent');
    }
  });

  it('chưa có đánh giá → lời mời viết đánh giá đầu tiên', async () => {
    mocks.list = { count: 0, average: 0, distribution: {}, items: [] };
    const c = await mount();
    // Khối rỗng nạp lười (next/dynamic): chờ tới khi hiện.
    for (let n = 0; n < 40 && !c.textContent!.includes('Chưa có đánh giá'); n++) await flush();
    expect(c.textContent).toContain('Chưa có đánh giá');
    expect(c.textContent).toContain('Hãy là người đầu tiên chia sẻ trải nghiệm.');
    expect(c.querySelector('svg[aria-hidden]')).not.toBeNull();
    expect(c.querySelector('h2')!.className).toContain('font-ui');
    expect(c.querySelector('h2')!.className).not.toContain('font-display');
  });

  it('khách chưa đăng nhập: không hỏi can-review, nút ghost "Viết đánh giá" mở cổng đăng nhập và quay lại đúng đơn đang mở', async () => {
    mocks.auth = { status: 'idle', initialized: true, sessionUnavailable: false };
    mocks.search = 'danh-gia=o2';
    const c = await mount();
    expect(mocks.eligCalls).toBe(0);
    const login = byText(c, 'a', 'Viết đánh giá')!;
    expect(login.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent('/san-pham/nuoc-rua-chen?danh-gia=o2')}`);
    // Như nút ghost của Mini (reviews-section.tsx): chữ thương hiệu, không nền, không viền, không gạch chân.
    expect(login.className).toContain('max-md:bg-transparent');
    expect(login.className).not.toContain('underline');
    expect(byText(c, 'a', 'Đăng nhập để đánh giá')).toBeNull();
    expect(form(c)).toBeNull();
  });

  it('chưa mua và nhận sản phẩm: không có nút viết hay sửa, nói rõ lý do', async () => {
    mocks.elig = { canReview: false, reason: 'NOT_PURCHASED' };
    const c = await mount();
    expect(c.textContent).toContain('Mua và nhận hàng để đánh giá');
    expect(button(c, /Viết đánh giá|Sửa đánh giá/)).toBeNull();
  });
});

describe('ProductReviews (web) — mỗi lần mua một đánh giá', () => {
  it('đã đánh giá đơn cũ, còn đơn mới: "Viết đánh giá" ở đầu mục; dòng của mình có nhãn "Của bạn", mã đơn và nút sửa riêng', async () => {
    const c = await mount();
    expect(button(c, 'Viết đánh giá')).not.toBeNull();
    expect(byText(c, 'span', /^Của bạn$/)).not.toBeNull();
    expect(c.querySelectorAll('li.border-t')[0]!.textContent).toContain('Đơn TB0001');
    expect(buttonNamed(c, 'Sửa đánh giá đơn TB0001')).not.toBeNull();
  });

  it('viết cho lần mua mới: gửi kèm đơn còn viết được, nói rõ đơn nào và không hứa điểm khi đã nhận thưởng', async () => {
    const c = await mount();
    click(button(c, 'Viết đánh giá'));
    await flush();
    const f = form(c)!;
    expect(f.textContent).toContain('Bạn đã mua sản phẩm này 2 lần, mỗi lần mua được viết một đánh giá. Đánh giá này cho đơn TB0002.');
    expect(f.textContent).toContain(REWARD_ALREADY_GIVEN);
    expect(f.textContent).not.toMatch(/\+\d+ Điểm Xanh|Lần đầu đánh giá/);
    click(button(c, 'Gửi đánh giá'));
    await flush();
    expect(mocks.saved).toEqual([
      { slug: 'nuoc-rua-chen', body: { rating: 5, comment: undefined, images: undefined, videoUrl: undefined, orderId: 'o2' } },
    ]);
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đã gửi đánh giá của bạn');
    expect(form(c)).toBeNull();
  });

  it('đánh giá đầu tiên: câu gợi ý nêu điều kiện lần đầu rồi mới nêu điểm; được cộng thì báo đúng số điểm', async () => {
    configureVideo();
    mocks.elig = structuredClone(ELIG_NEW);
    mocks.saveResult = { id: 'a', updated: false, pointsEarned: 10 };
    const c = await mount();
    click(button(c, 'Viết đánh giá'));
    await flush();
    expect(form(c)!.textContent).toContain('Lần đầu đánh giá sản phẩm này: thêm video +15.000 / ảnh +10.000 Điểm Xanh (chỉ chữ +5.000). Chỉ đánh giá được khi đã mua và nhận hàng.');
    click(button(c, 'Ảnh đánh giá (0)'));
    expect(form(c)!.textContent).toContain('Lần đầu đánh giá sản phẩm này, bạn nhận +10.000 Điểm Xanh cho đánh giá có ảnh! Thêm video để được +15.000.');
    click(star(c, 4));
    typeInto(c.querySelector('textarea'), '  Dùng êm  ');
    click(button(c, 'Gửi đánh giá'));
    await flush();
    expect(mocks.saved[0]!.body).toEqual({
      rating: 4,
      comment: 'Dùng êm',
      images: ['data:image/jpeg;base64,AAAA'],
      videoUrl: undefined,
      orderId: 'o1',
    });
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Cảm ơn đánh giá của bạn! Đã cộng 10 Điểm Xanh');
  });

  it('tải video lên: gửi kèm videoUrl và câu thưởng đổi sang mức video (+15.000)', async () => {
    configureVideo();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/v.mp4', duration: 30 }) }));
    mocks.elig = structuredClone(ELIG_NEW);
    mocks.saveResult = { id: 'a', updated: false, pointsEarned: 15 };
    const c = await mount();
    click(button(c, 'Viết đánh giá'));
    await flush(6);
    pickVideo(c);
    await flush(6);
    expect(form(c)!.textContent).toContain('Tuyệt! Lần đầu đánh giá sản phẩm này, đánh giá có video nhận +15.000 Điểm Xanh!');
    click(button(c, 'Gửi đánh giá'));
    await flush();
    expect(mocks.saved[0]!.body).toMatchObject({ videoUrl: 'https://res.cloudinary.com/demo/v.mp4', orderId: 'o1' });
  });

  it('bản build chưa cấu hình Cloudinary: không có ô chọn video và câu thưởng không mời video', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME', '');
    vi.stubEnv('NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET', '');
    mocks.elig = structuredClone(ELIG_NEW);
    const c = await mount();
    click(button(c, 'Viết đánh giá'));
    await flush(6);
    expect(c.querySelector('input[type="file"][accept="video/*"]')).toBeNull();
    expect(form(c)!.textContent).toContain('Lần đầu đánh giá sản phẩm này: thêm ảnh +10.000 Điểm Xanh (chỉ chữ +5.000).');
    expect(form(c)!.textContent).not.toContain('video +15.000');
    click(button(c, 'Ảnh đánh giá (0)'));
    expect(form(c)!.textContent).toContain('bạn nhận +10.000 Điểm Xanh cho đánh giá có ảnh!');
    expect(form(c)!.textContent).not.toContain('Thêm video');
  });

  it('đang tải video: nút Gửi khoá (bấm hay gửi form cũng không lưu); tải xong mới gửi và kèm videoUrl', async () => {
    configureVideo();
    let finishUpload!: (res: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((resolve) => (finishUpload = resolve))));
    mocks.elig = structuredClone(ELIG_NEW);
    mocks.saveResult = { id: 'a', updated: false, pointsEarned: 15 };
    const c = await mount();
    click(button(c, 'Viết đánh giá'));
    await flush(6);
    pickVideo(c);
    await flush(4);
    const submit = form(c)!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe('Đang tải video…');
    click(submit);
    act(() => {
      form(c)!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(mocks.saved).toEqual([]);

    finishUpload({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/v.mp4', duration: 30 }) });
    await flush(6);
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe('Gửi đánh giá');
    click(submit);
    await flush();
    expect(mocks.saved).toHaveLength(1);
    expect(mocks.saved[0]!.body).toMatchObject({ videoUrl: 'https://res.cloudinary.com/demo/v.mp4', orderId: 'o1' });
  });

  it('tải video lỗi: nút Gửi mở lại để gửi đánh giá không video', async () => {
    configureVideo();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    mocks.elig = structuredClone(ELIG_NEW);
    const c = await mount();
    click(button(c, 'Viết đánh giá'));
    await flush(6);
    pickVideo(c);
    await flush(6);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Tải video thất bại, thử lại.');
    const submit = form(c)!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(false);
    click(submit);
    await flush();
    expect(mocks.saved[0]!.body).toMatchObject({ videoUrl: undefined, orderId: 'o1' });
  });

  it('nút "Sửa" của dòng mình: điền theo GET /reviews/:id, giữ ảnh và video cũ, lưu gửi đúng đơn của đánh giá đó', async () => {
    mocks.saveResult = { id: 'a', updated: true, pointsEarned: 10 };
    const c = await mount();
    click(buttonNamed(c, 'Sửa đánh giá đơn TB0001'));
    await flush();
    expect(mocks.myCalls).toEqual(['a']);
    const f = form(c)!;
    expect(f.getAttribute('aria-label')).toBe('Sửa đánh giá');
    expect(star(c, 4)!.getAttribute('aria-checked')).toBe('true');
    expect(c.querySelector('textarea')!.value).toBe('Dùng ổn');
    expect(button(c, 'Ảnh đánh giá (1)')).not.toBeNull();
    expect(f.textContent).toContain('Bạn đang sửa đánh giá cho đơn TB0001.');
    expect(f.textContent).toContain('Video đã gửi kèm đánh giá này được giữ nguyên.');
    expect(f.textContent).toContain(EDIT_HINT);
    click(star(c, 2));
    click(button(c, 'Lưu đánh giá'));
    await flush();
    expect(mocks.saved[0]!.body).toEqual({
      rating: 2,
      comment: 'Dùng ổn',
      images: ['data:image/jpeg;base64,OLD'],
      videoUrl: 'https://res.cloudinary.com/x/v.mp4',
      orderId: 'o1',
    });
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đã cập nhật đánh giá của bạn');
  });

  it('mọi lần mua đã có đánh giá: đầu mục là "Sửa đánh giá của bạn" mở đánh giá mới nhất', async () => {
    mocks.elig = structuredClone(ELIG_ALL);
    const c = await mount();
    expect(button(c, 'Viết đánh giá')).toBeNull();
    click(button(c, 'Sửa đánh giá của bạn'));
    await flush();
    expect(mocks.myCalls).toEqual(['b']);
    expect(c.querySelector('textarea')!.value).toBe('Lần này hơi khô');
  });

  it('không tải được đánh giá để sửa → báo lỗi và "Thử lại", không mở form trống', async () => {
    mocks.mine.a = new Error('mất mạng');
    const c = await mount();
    click(buttonNamed(c, 'Sửa đánh giá đơn TB0001'));
    await flush();
    expect(form(c)).toBeNull();
    expect(c.textContent).toContain('Không tải được đánh giá để sửa.');
    mocks.mine.a = structuredClone(MINE_A);
    click(button(c, 'Thử lại'));
    await flush();
    expect(c.querySelector('textarea')!.value).toBe('Dùng ổn');
  });

  it('gửi lỗi → báo lỗi của máy chủ, form vẫn mở để gửi lại', async () => {
    mocks.saveResult = new Error('Đơn này chưa giao tới bạn hoặc không có sản phẩm này nên chưa đánh giá được.');
    const c = await mount();
    click(button(c, 'Viết đánh giá'));
    await flush();
    click(button(c, 'Gửi đánh giá'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Đơn này chưa giao tới bạn hoặc không có sản phẩm này nên chưa đánh giá được.');
    expect(form(c)).not.toBeNull();
  });

  it('can-review chưa về: không có nút viết hay sửa', async () => {
    mocks.elig = new Promise(() => undefined);
    const c = await mount();
    expect(mocks.eligCalls).toBe(1);
    expect(button(c, /Viết đánh giá|Sửa/)).toBeNull();
    expect(form(c)).toBeNull();
  });

  // Gửi không kèm đơn thì máy chủ (giữ đường cho bản app cũ) sửa đè đánh giá mới nhất khi mọi lần mua đã có đánh giá.
  it('form viết mới đang mở mà can-review làm mới thành ALL_REVIEWED (vừa đánh giá ở thiết bị khác) → vẫn gửi kèm đúng đơn chốt lúc mở', async () => {
    try {
      const c = await mount();
      click(button(c, 'Viết đánh giá'));
      await flush();
      mocks.elig = structuredClone(ELIG_ALL);
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await flush();
      expect(mocks.eligCalls).toBe(2);
      expect(form(c)!.textContent).toContain('Đánh giá này cho đơn TB0002.');
      click(button(c, 'Gửi đánh giá'));
      await flush();
      expect(mocks.saved).toHaveLength(1);
      expect(mocks.saved[0]!.body.orderId).toBe('o2');
    } finally {
      focusManager.setFocused(undefined);
    }
  });

  it('truy cập: nút và ô nhập có tên, vùng chạm 44px (cả khi form đang mở)', async () => {
    const c = await mount();
    click(button(c, 'Viết đánh giá'));
    await flush();
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});

// R5-BUYER-2: admin ẩn đánh giá của khách (isVisible=false). Đánh giá ẩn không nằm trong danh sách công khai nên khách phải
// được nói thẳng là nó đang chờ Tubu xem xét, và lưu lại không được báo "Đã cập nhật" như thể đã đổi được gì.
describe('ProductReviews (web) — đánh giá bị Tubu ẩn (R5-BUYER-2)', () => {
  const HIDDEN_REF = { ...REF_A, isVisible: false };
  const ELIG_HIDDEN = { canReview: false, reason: 'ALL_REVIEWED', rewardAvailable: false, purchaseCount: 1, reviewableOrders: [], myReviews: [HIDDEN_REF] };
  const HIDDEN_NOTICE = 'Đánh giá cho đơn TB0001 của bạn đang được Tubu xem xét nên chưa hiện công khai. Sửa nội dung không làm nó hiện lại.';
  const SAVED_HIDDEN = 'Đã lưu. Đánh giá của bạn đang được Tubu xem xét nên chưa hiện công khai.';

  beforeEach(() => {
    mocks.list = { ...structuredClone(LIST), count: 2, items: LIST.items.filter((i) => i.id !== 'a') };
    mocks.elig = structuredClone(ELIG_HIDDEN);
    mocks.mine = { a: { ...structuredClone(MINE_A), isVisible: false } };
    mocks.saveResult = { id: 'a', updated: true, pointsEarned: 0, isVisible: false };
  });

  it('có đánh giá đang ẩn: nói rõ đang chờ Tubu xem xét, kèm đơn; vẫn có nút sửa', async () => {
    const c = await mount();
    const notice = byText(c, 'p', HIDDEN_NOTICE);
    expect(notice).not.toBeNull();
    expect(notice!.getAttribute('role')).toBe('status');
    expect(button(c, 'Sửa đánh giá của bạn')).not.toBeNull();
  });

  it('đánh giá đang hiện: không có câu nào về việc bị ẩn', async () => {
    mocks.elig = structuredClone(ELIG_ALL);
    const c = await mount();
    expect(c.textContent).not.toContain('chưa hiện công khai');
  });

  it('form sửa đánh giá ẩn nhắc lại rằng lưu không làm nó hiện; lưu xong báo "đang chờ Tubu xem xét", không báo "Đã cập nhật"', async () => {
    const c = await mount();
    click(button(c, 'Sửa đánh giá của bạn'));
    await flush();
    expect(form(c)!.textContent).toContain('Đánh giá này đang chờ Tubu xem xét nên chưa hiện công khai. Lưu lại không làm nó hiện.');
    click(button(c, 'Lưu đánh giá'));
    await flush();
    const statuses = [...c.querySelectorAll('[role="status"]')].map((n) => n.textContent);
    expect(statuses).toContain(SAVED_HIDDEN);
    expect(c.textContent).not.toContain('Đã cập nhật đánh giá của bạn');
  });

  it('máy chủ báo isVisible=false trong phản hồi lưu (can-review chưa có cờ) cũng báo đang chờ xem xét', async () => {
    mocks.elig = { ...structuredClone(ELIG_ALL), myReviews: [REF_A] };
    const c = await mount();
    click(button(c, 'Sửa đánh giá của bạn'));
    await flush();
    click(button(c, 'Lưu đánh giá'));
    await flush();
    expect(c.textContent).toContain(SAVED_HIDDEN);
    expect(c.textContent).not.toContain('Đã cập nhật đánh giá của bạn');
  });
});

// R5-BUYER-3: can-review lỗi thì khách không biết vì sao không có nút viết/sửa — phải nói và cho thử lại.
describe('ProductReviews (web) — can-review lỗi (R5-BUYER-3)', () => {
  it('báo "Chưa kiểm tra được quyền đánh giá" kèm Thử lại; thử lại được thì có nút viết đánh giá', async () => {
    mocks.elig = new Error('500');
    const c = await mount();
    const alert = c.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Chưa kiểm tra được quyền đánh giá.');
    expect(button(c, /Viết đánh giá|Sửa/)).toBeNull();

    mocks.elig = structuredClone(ELIG_NEW);
    click(button(c, 'Thử lại'));
    await flush();
    expect(button(c, 'Viết đánh giá')).not.toBeNull();
    expect(c.textContent).not.toContain('Chưa kiểm tra được quyền đánh giá.');
    expect(mocks.eligCalls).toBe(2);
  });

  it('khách chưa đăng nhập không hỏi can-review nên không có dòng lỗi', async () => {
    mocks.auth = { status: 'idle', initialized: true, sessionUnavailable: false };
    mocks.elig = new Error('500');
    const c = await mount();
    expect(c.textContent).not.toContain('Chưa kiểm tra được quyền đánh giá.');
    expect(mocks.eligCalls).toBe(0);
  });
});

describe('ProductReviews (web) — mở từ chi tiết đơn (?danh-gia=<đơn>)', () => {
  it('đơn chưa đánh giá → mở sẵn form viết cho đúng đơn đó', async () => {
    mocks.search = 'danh-gia=o2';
    const c = await mount();
    expect(form(c)?.getAttribute('aria-label')).toBe('Viết đánh giá');
    click(button(c, 'Gửi đánh giá'));
    await flush();
    expect(mocks.saved[0]!.body.orderId).toBe('o2');
  });

  it('đơn đã đánh giá → mở sửa đúng đánh giá của đơn đó', async () => {
    mocks.search = 'danh-gia=o1';
    const c = await mount();
    expect(mocks.myCalls).toEqual(['a']);
    expect(form(c)?.getAttribute('aria-label')).toBe('Sửa đánh giá');
  });

  it('đơn không có trong can-review → không mở gì', async () => {
    mocks.search = 'danh-gia=o9';
    const c = await mount();
    expect(form(c)).toBeNull();
    expect(button(c, 'Viết đánh giá')).not.toBeNull();
  });

  // Còn giữ ?danh-gia= thì quay lại hay tải lại trang mở lại form (lúc đó đã thành form sửa của đánh giá vừa gửi).
  describe('đã dùng tham số thì gỡ khỏi URL', () => {
    const PAGE = '/san-pham/nuoc-rua-chen';
    const visit = (search: string) => {
      window.history.replaceState(null, '', `${PAGE}${search}#danh-gia`);
      mocks.search = new URLSearchParams(search).toString();
    };
    afterEach(() => window.history.replaceState(null, '', '/'));

    it('mở form từ tham số → URL bỏ ?danh-gia= (giữ tham số khác và #danh-gia) bằng replaceState; tải lại trang không mở lại form', async () => {
      visit('?utm_source=zalo&danh-gia=o2');
      const lengthBefore = window.history.length;
      const c = await mount();
      expect(form(c)?.getAttribute('aria-label')).toBe('Viết đánh giá');
      expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(`${PAGE}?utm_source=zalo#danh-gia`);
      expect(window.history.length).toBe(lengthBefore);

      click(button(c, 'Gửi đánh giá'));
      await flush();
      expect(mocks.saved[0]!.body.orderId).toBe('o2');

      mounted.forEach((m) => m.unmount());
      mounted = [];
      mocks.search = window.location.search.slice(1);
      mocks.elig = { ...structuredClone(ELIG_ALL), myReviews: [{ ...REF_B, id: 'new' }, REF_A] };
      const again = await mount();
      expect(form(again)).toBeNull();
      expect(mocks.myCalls).toEqual([]);
    });

    it('mở sửa từ tham số cũng gỡ tham số; đơn không có trong can-review cũng gỡ (đã dùng xong)', async () => {
      visit('?danh-gia=o1');
      const c = await mount();
      expect(form(c)?.getAttribute('aria-label')).toBe('Sửa đánh giá');
      expect(window.location.search).toBe('');
      mounted.forEach((m) => m.unmount());
      mounted = [];

      visit('?danh-gia=o9');
      await mount();
      expect(window.location.search).toBe('');
    });

    it('khách chưa đăng nhập: giữ tham số để đăng nhập xong quay lại đúng đơn', async () => {
      mocks.auth = { status: 'idle', initialized: true, sessionUnavailable: false };
      visit('?danh-gia=o2');
      await mount();
      expect(window.location.search).toBe('?danh-gia=o2');
    });
  });
});

describe('ProductReviews — lần dựng đầu khớp HTML máy chủ', () => {
  it('cache đã có đánh giá (dải "Đánh giá nhanh" nạp trước): lần dựng đầu chưa hiện số đánh giá, không lệch lúc hydrate', () => {
    mocks.list = LIST;
    const client = new QueryClient();
    client.setQueryData(['reviews', 'nuoc-rua-chen'], LIST);
    const html = renderToString(
      <QueryClientProvider client={client}>
        <ProductReviews slug="nuoc-rua-chen" />
      </QueryClientProvider>,
    );
    expect(html).toContain('Đánh giá');
    expect(html).not.toContain('(3)');
    expect(html).not.toContain('Nhận xét a');
    expect(html).toContain('Đang tải');
  });
});

describe('Stars: tên đọc theo vi-VN (G3 MINOR)', () => {
  it('điểm trung bình 4.4 đọc "4,4 trên 5 sao" như số đang hiện, không "4.4"', () => {
    const r = render(<Stars value={4.4} />);
    mounted.push(r);
    expect(r.container.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('4,4 trên 5 sao');
  });
  it('điểm trung bình tròn đọc "5,0 trên 5 sao" như số đang hiện, không "5"', () => {
    const r = render(<Stars value={5} />);
    mounted.push(r);
    expect(r.container.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('5,0 trên 5 sao');
  });
  it('điểm một khách chấm (spoken="score") là số nguyên: "5 trên 5 sao", không "5,0"', () => {
    const r = render(<Stars value={5} small spoken="score" />);
    mounted.push(r);
    expect(r.container.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('5 trên 5 sao');
  });
});

describe('ProductReviews (web) — form đánh giá dùng được bằng bàn phím, lỗi nói rõ và được focus (W27)', () => {
  /** Bắn keydown; trả false khi trang chặn mặc định (như fireEvent). keyCode gắn tay vì KeyboardEventInit của jsdom bỏ qua. */
  const key = (el: Element | null, init: KeyboardEventInit & { keyCode?: number }) => {
    if (!el) throw new Error('key: không thấy phần tử');
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    if (init.keyCode !== undefined) Object.defineProperty(e, 'keyCode', { value: init.keyCode });
    let ok = true;
    act(() => {
      ok = el.dispatchEvent(e);
    });
    return ok;
  };
  const tabStops = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="radiogroup"] [role="radio"]')).map((r) => r.tabIndex);
  const openNew = async () => {
    mocks.elig = structuredClone(ELIG_NEW);
    const c = await mount();
    click(button(c, 'Viết đánh giá'));
    await flush();
    return c;
  };

  it('hàng sao một điểm dừng Tab (sao đang chọn); mũi tên đổi sao và chuyển focus, đi vòng ở hai đầu; Home, End', async () => {
    const c = await openNew();
    expect(tabStops(c)).toEqual([-1, -1, -1, -1, 0]);
    star(c, 5)!.focus();
    key(star(c, 5), { key: 'ArrowLeft' });
    expect(star(c, 4)!.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(star(c, 4));
    key(star(c, 4), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(star(c, 3));
    key(star(c, 3), { key: 'End' });
    expect(star(c, 5)!.getAttribute('aria-checked')).toBe('true');
    key(star(c, 5), { key: 'ArrowRight' });
    expect(star(c, 1)!.getAttribute('aria-checked')).toBe('true');
    key(star(c, 1), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(star(c, 2));
    key(star(c, 2), { key: 'Home' });
    expect(star(c, 1)!.getAttribute('aria-checked')).toBe('true');
    expect(tabStops(c)).toEqual([0, -1, -1, -1, -1]);
    key(star(c, 1), { key: 'ArrowRight', altKey: true });
    expect(star(c, 1)!.getAttribute('aria-checked')).toBe('true');
  });

  it('Enter của bộ gõ tiếng Việt (isComposing, keyCode 229) không bấm nút sao hay nút Gửi; ô nhận xét để bộ gõ tự xử lý', async () => {
    const c = await openNew();
    expect(key(star(c, 3), { key: 'Enter', keyCode: 229 })).toBe(false);
    expect(key(button(c, 'Gửi đánh giá'), { key: 'Enter', isComposing: true })).toBe(false);
    expect(key(star(c, 3), { key: 'Enter', keyCode: 13 })).toBe(true);
    expect(key(c.querySelector('textarea'), { key: 'Enter', keyCode: 229 })).toBe(true);
    expect(mocks.saved).toEqual([]);
  });

  it('Ctrl+Enter hoặc ⌘+Enter trong ô nhận xét gửi đánh giá; lúc bộ gõ đang chốt chữ thì không', async () => {
    const c = await openNew();
    const box = c.querySelector('textarea')!;
    expect(box.getAttribute('aria-keyshortcuts')).toBe('Control+Enter Meta+Enter');
    typeInto(box, 'Dùng êm');
    key(box, { key: 'Enter', ctrlKey: true, isComposing: true });
    key(box, { key: 'Enter', metaKey: true, keyCode: 229 });
    key(box, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(mocks.saved).toEqual([]);
    expect(key(box, { key: 'Enter', metaKey: true, keyCode: 13 })).toBe(false);
    await flush();
    expect(mocks.saved.map((s) => s.body.comment)).toEqual(['Dùng êm']);
  });

  it('bấm Gửi hai lần cùng nhịp rồi Ctrl+Enter: chỉ một lần gửi', async () => {
    let finish!: (v: unknown) => void;
    mocks.saveResult = new Promise((r) => (finish = r));
    const c = await openNew();
    const submit = button(c, 'Gửi đánh giá')!;
    act(() => {
      submit.click();
      submit.click();
    });
    key(c.querySelector('textarea'), { key: 'Enter', ctrlKey: true });
    await flush();
    expect(mocks.saved).toHaveLength(1);
    finish({ id: 'a', updated: false, pointsEarned: 0 });
    await flush();
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đã gửi đánh giá của bạn');
  });

  it('lỗi máy chủ: câu lỗi role=alert được focus để trình đọc đọc ngay; sửa xong gửi lại được', async () => {
    mocks.saveResult = new Error('Đơn này chưa giao tới bạn hoặc không có sản phẩm này nên chưa đánh giá được.');
    const c = await openNew();
    click(button(c, 'Gửi đánh giá'));
    await flush();
    const alert = c.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toBe('Đơn này chưa giao tới bạn hoặc không có sản phẩm này nên chưa đánh giá được.');
    expect(document.activeElement).toBe(alert);
    mocks.saveResult = { id: 'a', updated: false, pointsEarned: 0 };
    click(button(c, 'Gửi đánh giá'));
    await flush();
    expect(mocks.saved).toHaveLength(2);
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đã gửi đánh giá của bạn');
  });

  it('nhận xét quá 2.000 ký tự (dán vào): không gửi, báo số ký tự, focus ô nhận xét; sửa chữ thì lỗi tắt', async () => {
    const c = await openNew();
    const box = c.querySelector('textarea')!;
    typeInto(box, 'a'.repeat(2001));
    click(button(c, 'Gửi đánh giá'));
    await flush();
    expect(mocks.saved).toEqual([]);
    const alert = c.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toBe('Nhận xét tối đa 2.000 ký tự, bạn đang có 2.001 ký tự.');
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toBe(alert.id);
    typeInto(box, 'a'.repeat(2000));
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(box.hasAttribute('aria-invalid')).toBe(false);
    click(button(c, 'Gửi đánh giá'));
    await flush();
    expect(mocks.saved).toHaveLength(1);
  });

  it('sửa đánh giá lưu số sao lệch (0): điểm dừng Tab ở sao đầu, báo chọn 1–5 sao và focus sao đầu; chọn sao thì lưu được', async () => {
    mocks.mine.a = { ...structuredClone(MINE_A), rating: 0 };
    mocks.saveResult = { id: 'a', updated: true, pointsEarned: 0 };
    const c = await mount();
    click(buttonNamed(c, 'Sửa đánh giá đơn TB0001'));
    await flush();
    expect(tabStops(c)).toEqual([0, -1, -1, -1, -1]);
    click(button(c, 'Lưu đánh giá'));
    await flush();
    expect(mocks.saved).toEqual([]);
    const group = c.querySelector('[role="radiogroup"]')!;
    const alert = c.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toBe('Chọn từ 1 đến 5 sao để gửi đánh giá.');
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.getAttribute('aria-describedby')).toBe(alert.id);
    expect(document.activeElement).toBe(star(c, 1));
    click(star(c, 4));
    expect(c.querySelector('[role="alert"]')).toBeNull();
    click(button(c, 'Lưu đánh giá'));
    await flush();
    expect(mocks.saved[0]!.body).toMatchObject({ rating: 4, orderId: 'o1' });
  });
});
