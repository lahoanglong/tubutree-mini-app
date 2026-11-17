// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MATCHER_PENDING_KEY, encodeMatcherPending, type MatcherContent, type MatcherResult } from '@tubutree/app-core/game-mini/matcher';
import { matcherCopy } from '@tubutree/app-core/game-mini/matcher-copy';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { waitFor } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  track: vi.fn(),
  guestOn: false,
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading',
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/vuon-xanh/chon-chuan-xanh' }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase, useAuthRestoring: () => false }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null }));
vi.mock('@/lib/cart-feedback', () => ({ playCartFeedback: () => {} }));
vi.mock('@/lib/analytics', () => ({ trackWebEvent: mocks.track }));
vi.mock('@/lib/guest-cart/flag', () => ({ guestCartFlagNow: () => Promise.resolve(mocks.guestOn) }));

import MatcherFlow from './matcher-flow';
import { MatcherEntryLink } from './matcher-entry-link';

const opt = (value: string, tags: string[]) => ({ value, label: `Đáp án ${value}`, tags });
const CONTENT: MatcherContent = {
  questions: [
    { code: 'need', step: 1, prompt: 'Bạn cần cho việc gì?', options: [opt('laundry', ['laundry']), opt('kitchen', ['kitchen'])], when: null },
    { code: 'kitchen_how', step: 2, prompt: 'Rửa chén thế nào?', options: [opt('hand', ['hand']), opt('machine', ['machine'])], when: ['kitchen'] },
    { code: 'laundry_who', step: 2, prompt: 'Giặt cho ai?', options: [opt('family', ['adult'])], when: ['laundry'] },
    { code: 'size_home', step: 3, prompt: 'Cỡ nào?', options: [opt('small', ['small']), opt('large', ['large'])], when: ['laundry', 'kitchen'] },
  ],
  trivia: ['a', 'b', 'c'].map((id) => ({ id, prompt: `Đố ${id}?`, options: ['Một', 'Hai', 'Ba'], answer: 1, explanation: 'Vì vậy.', sourceUrl: 'https://www.example.org/x' })),
};
const item = (n: number) => ({
  slug: `mon-${n}`,
  productId: `p${n}`,
  variationId: `v${n}`,
  name: `Món ${n}`,
  variationName: n === 1 ? '1L' : null,
  imageUrl: null,
  price: 50_000 * n,
  compareAtPrice: null,
  flash: false,
  why: `Vì món ${n} hợp.`,
});
const RESULT: MatcherResult = { outcomeId: 'gm-matcher-o-kitchen-machine', code: 'kitchen_machine', title: 'Bộ máy rửa chén', fallback: false, items: [item(1), item(2), item(3), item(4)], total: 500_000, water: 0 };

let mounted: Rendered | null = null;
const q = (id: string) => mounted!.container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const buttonByText = (text: string) => [...mounted!.container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
const option = (value: string) => mounted!.container.querySelector<HTMLElement>(`button[data-value="${value}"]`);
const triviaOption = (i: number) => mounted!.container.querySelectorAll<HTMLElement>('[data-testid="matcher-trivia"] .tubu-mg-option')[i] ?? null;

async function playTo(values: [string, string, string]) {
  await waitFor(() => expect(buttonByText(matcherCopy('intro.start'))?.getAttribute('aria-busy')).not.toBe('true'));
  click(buttonByText(matcherCopy('intro.start')));
  await flush();
  click(option(values[0]));
  await flush();
  click(triviaOption(0));
  click(buttonByText(matcherCopy('next')));
  await flush();
  click(option(values[1]));
  await flush();
  click(triviaOption(1));
  click(buttonByText(matcherCopy('next')));
  await flush();
  click(option(values[2]));
  await flush();
}

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.guestOn = false;
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.push.mockReset();
  mocks.track.mockReset();
  mocks.get.mockImplementation((path: string) => Promise.resolve(path === '/game/matcher/status' ? { enabled: true } : CONTENT));
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('Chọn Chuẩn Xanh (web)', () => {
  it('5 bước rẽ nhánh theo câu 1, gửi đúng 3 đáp án kèm mã thiết bị, kết quả có MỘT nút chính và tổng tiền', async () => {
    mocks.post.mockResolvedValue({ ...RESULT, water: 4 });
    mounted = render(<MatcherFlow />);
    await playTo(['kitchen', 'machine', 'large']);
    await waitFor(() => expect(q('matcher-result')).not.toBeNull());
    const [path, body] = mocks.post.mock.calls[0]!;
    expect(path).toBe('/game/matcher/result');
    expect(body.answers).toEqual([
      { code: 'need', value: 'kitchen' },
      { code: 'kitchen_how', value: 'machine' },
      { code: 'size_home', value: 'large' },
    ]);
    expect(body.deviceId).toMatch(/^[0-9a-f]{32}$/);
    expect(q('matcher-items')?.querySelectorAll('li')).toHaveLength(4);
    expect(q('matcher-items')?.textContent).toContain('Món 1 · 1L');
    expect(q('matcher-items')?.textContent).toContain('Vì món 3 hợp.');
    expect(q('matcher-total')?.textContent).toContain(matcherCopy('result.total', { n: 4 }));
    expect(q('matcher-total')?.textContent?.replace(/\s/g, '')).toContain('500.000');
    expect(q('matcher-water')?.textContent).toBe(matcherCopy('result.water', { n: 4 }));
    const primaries = mounted.container.querySelectorAll('[data-testid="matcher-result"] button.zaui-btn-primary');
    expect(primaries.length).toBe(1);
    const events = mocks.track.mock.calls.map((c) => c[0]);
    expect(events).toEqual(['matcher_started', 'matcher_question_answered', 'matcher_question_answered', 'matcher_question_answered', 'matcher_question_answered', 'matcher_question_answered', 'matcher_completed']);
    expect(mocks.track.mock.calls[0]![1]).toEqual({ entry: 'direct' });
    expect(mocks.track.mock.calls.slice(1, 6).map((c) => c[1].index)).toEqual([1, 2, 3, 4, 5]);
    expect(mocks.track.mock.calls[6]![1]).toMatchObject({ outcomeId: RESULT.outcomeId, fallback: false });
    expect(mocks.track.mock.calls[6]![1].seconds % 5).toBe(0);
  });

  it('quay lại giữ đáp án: lùi về câu 1, đáp án cũ vẫn được đánh dấu', async () => {
    mocks.post.mockResolvedValue(RESULT);
    mounted = render(<MatcherFlow />);
    await waitFor(() => expect(buttonByText(matcherCopy('intro.start'))?.getAttribute('aria-busy')).not.toBe('true'));
    click(buttonByText(matcherCopy('intro.start')));
    await flush();
    click(option('kitchen'));
    await flush();
    expect(q('matcher-trivia')).not.toBeNull();
    click(q('matcher-back'));
    await flush();
    expect(option('kitchen')?.getAttribute('aria-pressed')).toBe('true');
    expect(option('laundry')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('câu đố: chọn xong hiện lời giải và nguồn mở tab mới, rel không lộ trang', async () => {
    mounted = render(<MatcherFlow />);
    await waitFor(() => expect(buttonByText(matcherCopy('intro.start'))?.getAttribute('aria-busy')).not.toBe('true'));
    click(buttonByText(matcherCopy('intro.start')));
    await flush();
    click(option('laundry'));
    await flush();
    click(triviaOption(2));
    await flush();
    const fb = q('matcher-trivia-feedback')!;
    expect(fb.textContent).toContain(matcherCopy('trivia.wrong', { a: 'Hai' }));
    const a = fb.querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(a.textContent).toBe(matcherCopy('trivia.source', { host: 'example.org' }));
  });

  it('thành viên: "Thêm cả bộ" một lệnh lô 4 món, nút thành "Xem giỏ", không tự chuyển trang; chạm đúp chỉ gửi một lần', async () => {
    mocks.post.mockImplementation((path: string) => Promise.resolve(path === '/cart/items/batch' ? { items: [] } : RESULT));
    mounted = render(<MatcherFlow />);
    await playTo(['kitchen', 'machine', 'large']);
    await waitFor(() => expect(q('matcher-result')).not.toBeNull());
    const btn = buttonByText(matcherCopy('result.addAll'));
    click(btn);
    click(btn);
    await waitFor(() => expect(q('matcher-add-status')?.textContent).toBe(matcherCopy('result.added', { n: 4 })));
    const batch = mocks.post.mock.calls.filter((c) => c[0] === '/cart/items/batch');
    expect(batch).toHaveLength(1);
    expect(batch[0]![1]).toEqual({ items: [1, 2, 3, 4].map((n) => ({ variationId: `v${n}`, quantity: 1 })), addSource: 'pdp' });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith('matcher_add_all', { itemCount: 4 });
    click(buttonByText(matcherCopy('result.viewCart')));
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
    expect(mocks.post.mock.calls.some((c) => String(c[0]).includes('reward') || String(c[0]).includes('/game/mini'))).toBe(false);
  });

  it('khách, giỏ khách bật: ghi 4 món vào giỏ trình duyệt, không gọi API giỏ, không gửi mã thiết bị', async () => {
    mocks.phase = 'guest';
    mocks.guestOn = true;
    mocks.post.mockResolvedValue(RESULT);
    mounted = render(<MatcherFlow />);
    await playTo(['kitchen', 'machine', 'large']);
    await waitFor(() => expect(q('matcher-result')).not.toBeNull());
    expect(mocks.post.mock.calls[0]![1].deviceId).toBeUndefined();
    click(buttonByText(matcherCopy('result.addAll')));
    await waitFor(() => expect(q('matcher-add-status')?.textContent).toBe(matcherCopy('result.added', { n: 4 })));
    const lines = JSON.parse(window.localStorage.getItem('tubu.guestCart.v1') ?? '[]');
    expect(lines.map((l: { variationId: string }) => l.variationId)).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(mocks.post.mock.calls.filter((c) => c[0] === '/cart/items/batch')).toHaveLength(0);
  });

  it('khách, giỏ khách tắt: giữ bộ trong phiên rồi sang đăng nhập; quay về thấy lại bộ, không chạy lại, không Giọt nước', async () => {
    mocks.phase = 'guest';
    mocks.post.mockResolvedValue({ ...RESULT, water: 0 });
    mounted = render(<MatcherFlow />);
    await playTo(['kitchen', 'machine', 'large']);
    await waitFor(() => expect(q('matcher-result')).not.toBeNull());
    click(buttonByText(matcherCopy('result.addAll')));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(String(mocks.push.mock.calls[0]![0])).toContain(encodeURIComponent('/vuon-xanh/chon-chuan-xanh'));
    expect(window.sessionStorage.getItem(MATCHER_PENDING_KEY)).not.toBeNull();
    mounted.unmount();
    mocks.phase = 'authenticated';
    mocks.post.mockReset();
    mounted = render(<MatcherFlow />);
    await waitFor(() => expect(q('matcher-result')).not.toBeNull());
    expect(q('matcher-result')?.textContent).toContain(matcherCopy('result.pending'));
    expect(q('matcher-water')).toBeNull();
    expect(q('matcher-total')).toBeNull();
    expect(q('matcher-pending-price')?.textContent).toBe(matcherCopy('result.pendingPrice'));
    expect(q('matcher-items')?.querySelector('[data-ds-part="price"]')?.textContent ?? '').toBe('');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(MATCHER_PENDING_KEY)).toBeNull();
  });

  it('bộ dự phòng: tiêu đề "Bán chạy còn hàng", câu ghi chú, dòng vì sao dùng câu chung', async () => {
    mocks.post.mockResolvedValue({ ...RESULT, fallback: true, items: [{ ...item(1), why: '' }, { ...item(2), why: '' }] });
    mounted = render(<MatcherFlow />);
    await playTo(['kitchen', 'hand', 'small']);
    await waitFor(() => expect(q('matcher-result')).not.toBeNull());
    expect(q('matcher-result')?.getAttribute('data-fallback')).toBe('true');
    expect(q('matcher-result')?.textContent).toContain(matcherCopy('result.fallback'));
    expect(q('matcher-fallback-note')).not.toBeNull();
    expect(q('matcher-items')?.textContent).toContain(matcherCopy('result.whyFallback'));
  });

  it('cờ tắt: nội dung 404 thì chỉ báo tạm nghỉ, không có nút Bắt đầu', async () => {
    mocks.get.mockImplementation(() => Promise.reject(Object.assign(new Error('nf'), { status: 404, code: 'GAME_DISABLED' })));
    mounted = render(<MatcherFlow />);
    await waitFor(() => expect(q('matcher-off')).not.toBeNull());
    expect(q('matcher-off')?.textContent).toContain(matcherCopy('error.disabled'));
    expect(buttonByText(matcherCopy('intro.start'))).toBeNull();
  });

  it('lỗi mạng khi ra bộ: giữ đáp án, Thử lại gửi lại đúng đáp án', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(RESULT);
    mounted = render(<MatcherFlow />);
    await playTo(['laundry', 'family', 'small']);
    await waitFor(() => expect(q('matcher-result-error')).not.toBeNull());
    click(buttonByText(matcherCopy('error.retry')));
    await waitFor(() => expect(q('matcher-result')).not.toBeNull());
    expect(mocks.post.mock.calls[1]![1].answers).toEqual(mocks.post.mock.calls[0]![1].answers);
  });
});

describe('Lối vào Chọn Chuẩn Xanh', () => {
  it('cờ bật: một dòng chữ kèm from; cờ tắt: không vẽ gì', async () => {
    mounted = render(<MatcherEntryLink from="empty_cart" />);
    await waitFor(() => expect(q('matcher-entry-empty_cart')).not.toBeNull());
    expect(q('matcher-entry-empty_cart')?.getAttribute('href')).toBe('/vuon-xanh/chon-chuan-xanh?from=empty_cart');
    expect(q('matcher-entry-empty_cart')?.textContent).toBe(matcherCopy('entry.link'));
    mounted.unmount();
    mocks.get.mockImplementation(() => Promise.resolve({ enabled: false }));
    mounted = render(<MatcherEntryLink from="empty_cart" />);
    await flush();
    expect(mounted.container.innerHTML).toBe('');
  });
});
