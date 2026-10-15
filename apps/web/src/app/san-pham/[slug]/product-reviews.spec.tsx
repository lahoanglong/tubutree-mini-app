// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusManager } from '@tanstack/react-query';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// R8: mỗi lần mua (đơn) một đánh giá. Web theo đúng luật của Mini App: nút đầu mục viết cho đơn còn viết được, đánh
// giá đã có sửa ở đúng dòng của nó, chỉ đánh giá đầu tiên của sản phẩm được hứa Điểm Xanh.

const mocks = vi.hoisted(() => ({
  auth: { status: 'authenticated', initialized: true, sessionUnavailable: false } as Record<string, unknown>,
  search: '',
  list: null as unknown,
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
  fetchProductReviews: async () => mocks.list,
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

import { ProductReviews } from './product-reviews';

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
const buttonNamed = (c: HTMLElement, name: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const form = (c: HTMLElement) => c.querySelector('form');
const star = (c: HTMLElement, n: number) => c.querySelector<HTMLButtonElement>(`[role="radiogroup"] button[aria-label="${n} sao"]`);

beforeEach(() => {
  mocks.auth = { status: 'authenticated', initialized: true, sessionUnavailable: false };
  mocks.search = '';
  mocks.list = structuredClone(LIST);
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
});

describe('ProductReviews (web) — danh sách công khai', () => {
  it('tiêu đề kèm số đánh giá, điểm trung bình, phân bổ sao và mọi đánh giá đang hiện; ảnh API ghép gốc API', async () => {
    const c = await mount();
    expect(c.querySelector('h2')?.textContent).toBe('Đánh giá (3)');
    expect(c.textContent).toContain('4.3');
    expect(c.querySelectorAll('li.border-t')).toHaveLength(3);
    expect(c.querySelector('[aria-label="Phân bổ số sao"]')?.textContent).toContain('5');
    expect(c.querySelector<HTMLImageElement>('img[alt="Ảnh đánh giá"]')!.src).toMatch(/\/reviews\/c\/images\/0\?v=1$/);
  });

  it('hơn 5 đánh giá: hiện 5 rồi "Xem thêm"', async () => {
    mocks.list = { ...LIST, count: 7, items: Array.from({ length: 7 }, (_, i) => review(`r${i}`, 5)) };
    const c = await mount();
    expect(c.querySelectorAll('li.border-t')).toHaveLength(5);
    click(button(c, 'Xem thêm (2)'));
    expect(c.querySelectorAll('li.border-t')).toHaveLength(7);
  });

  it('chưa có đánh giá → lời mời viết đánh giá đầu tiên', async () => {
    mocks.list = { count: 0, average: 0, distribution: {}, items: [] };
    const c = await mount();
    expect(c.textContent).toContain('Chưa có đánh giá. Hãy là người đầu tiên chia sẻ trải nghiệm.');
  });

  it('khách chưa đăng nhập: không hỏi can-review, mời đăng nhập và quay lại đúng đơn đang mở', async () => {
    mocks.auth = { status: 'idle', initialized: true, sessionUnavailable: false };
    mocks.search = 'danh-gia=o2';
    const c = await mount();
    expect(mocks.eligCalls).toBe(0);
    const login = byText(c, 'a', 'Đăng nhập để đánh giá')!;
    expect(login.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent('/san-pham/nuoc-rua-chen?danh-gia=o2')}`);
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
    mocks.elig = structuredClone(ELIG_NEW);
    mocks.saveResult = { id: 'a', updated: false, pointsEarned: 10 };
    const c = await mount();
    click(button(c, 'Viết đánh giá'));
    await flush();
    expect(form(c)!.textContent).toContain('Lần đầu đánh giá sản phẩm này: thêm ảnh +10 Điểm Xanh (chỉ chữ +5).');
    click(button(c, 'Ảnh đánh giá (0)'));
    expect(form(c)!.textContent).toContain('Lần đầu đánh giá sản phẩm này, bạn nhận +10 Điểm Xanh cho đánh giá có ảnh!');
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
