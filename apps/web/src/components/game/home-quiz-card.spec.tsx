// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageResponse, ProductCard } from '@tubutree/app-core/api/catalog';
import { homeQuizQuestions, pickKitProducts, type HomeQuizAnswers } from '@tubutree/app-core/arcade/home-quiz';
import { QUICK_ADD_SOLD_OUT } from '@tubutree/app-core/quick-add';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingLevels, unnamedControls } from '@/test-utils/a11y';
import { newTestClient } from '@/test-utils/render-hook';
import { loginHref, takePendingAdd } from '@/lib/return-to';

// Lớp mạng (apiFetch) là bản giả; core-http, query, quick-add và ProductCard là bản THẬT để sheet đi đúng đường thêm giỏ nhanh của web.
const net = vi.hoisted(() => ({ apiFetch: vi.fn(), push: vi.fn(), phase: 'authenticated' as 'authenticated' | 'guest' }));
vi.mock('@/lib/client-api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/client-api')>()), apiFetch: net.apiFetch }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => net.phase, useAuthRestoring: () => false }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, status: net.phase, initialized: true }) }));
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: net.push }), usePathname: () => '/vuon-xanh' }));
vi.mock('@/components/variation-sheet', () => ({
  VariationSheet: (p: { open: boolean; productName: string; variations: { id: string }[] }) =>
    p.open ? (
      <div data-testid="variation-sheet">
        {p.productName}:{p.variations.length}
      </div>
    ) : null,
}));

import { HomeQuizCard } from './home-quiz-card';

const product = (id: string, name: string, over: Partial<ProductCard> = {}): ProductCard => ({
  id, slug: id, brand: 'Tubu', name, thumbnail: `https://img.test/${id}.webp`, basePrice: 50000, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${id}`, ...over,
});
// Với đáp án (baby_pet, grease, refill): Túi Refill 18 điểm, Bồ Hòn 9, Gel tẩy dầu 3, hai món còn lại 0 và Hết hàng bị loại.
const CATALOG: ProductCard[] = [
  product('nen', 'Nến thơm sả chanh', { isFeatured: true }),
  product('bohon', 'Nước rửa chén Bồ Hòn'),
  product('het', 'Túi Refill hết sạch', { inStock: false }),
  product('refill', 'Túi Refill nước giặt'),
  product('gel', 'Gel tẩy dầu mỡ bếp'),
  product('xit', 'Xịt kính'),
];
const ANSWERS: HomeQuizAnswers = { family: 'baby_pet', worry: 'grease', format: 'refill' };
const KIT_NAMES = ['Túi Refill nước giặt', 'Nước rửa chén Bồ Hòn', 'Gel tẩy dầu mỡ bếp'];
const page = (data: ProductCard[]): PageResponse<ProductCard> => ({ data, meta: { page: 1, limit: 40, total: data.length } }) as unknown as PageResponse<ProductCard>;
const detail = (slug: string, variations = 1) => ({
  id: slug, slug, brand: 'Tubu', name: `Món ${slug}`, shortDesc: null, description: 'Mô tả', images: [], thumbnail: null, basePrice: 50000, salePrice: null, certifications: [], ingredients: null, storyConfig: null,
  variations: Array.from({ length: variations }, (_, i) => ({ id: variations === 1 ? `v-${slug}` : `v-${slug}-${i}`, sku: `${slug}${i}`, name: `Loại ${i}`, attributes: {}, retailPrice: 50000, salePrice: null, stock: 5 })),
});
const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 0 };

const STATUS = (quizClaimed: boolean) => ({
  games: { dew_catcher: { bestScore: 0, plays: 0, used: 0, cap: 3 }, refill_rush: { bestScore: 0, plays: 0, used: 0, cap: 3 } },
  window: null,
  windowBonus: false,
  nextWindowAt: null,
  quizClaimed,
});
const h = { catalog: CATALOG, productsHang: null as null | ((v: unknown) => void), variations: {} as Record<string, number>, soldOut: new Set<string>(), quizClaimed: false, statusHang: false };

let mounted: Rendered | null = null;
let qc: QueryClient;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const dialogText = () => dialog()?.textContent ?? '';
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
const byLabel = (text: string) => buttons().find((b) => b.textContent?.includes(text)) ?? null;
const calls = () => net.apiFetch.mock.calls.map(([p, o]) => `${(o as { method?: string } | undefined)?.method ?? 'GET'} ${String(p).split('?')[0]}`);
const callsTo = (key: string) => net.apiFetch.mock.calls.filter(([p, o]) => `${(o as { method?: string } | undefined)?.method ?? 'GET'} ${String(p).split('?')[0]}` === key);
const kitNames = () => Array.from(document.querySelectorAll('[data-testid="home-quiz-kit"] li a')).map((a) => a.textContent?.trim()).filter((t) => t && !t.startsWith('+'));
const addButtons = () => buttons().filter((b) => b.textContent === '+ Thêm vào giỏ');

// Sheet nạp bằng next/dynamic: lần mở đầu của cả file phải chờ module về, nên đợi đến khi hộp thoại có mặt thay vì đếm số lượt.
async function until(cond: () => unknown, tries = 60) {
  for (let i = 0; i < tries && !cond(); i++) await flush(1);
}
async function openSheet() {
  click(byLabel('Bắt đầu'));
  await until(dialog);
  await flush(2);
}
async function pick(label: string) {
  click(byLabel(label));
  await flush(1);
}
async function answerAll() {
  const [a, b, c] = homeQuizQuestions().map((x) => x.options);
  await pick(a!.find((o) => o.value === ANSWERS.family)!.label);
  await pick(b!.find((o) => o.value === ANSWERS.worry)!.label);
  await pick(c!.find((o) => o.value === ANSWERS.format)!.label);
  await flush(4);
}
async function reachResult() {
  mounted = render(<HomeQuizCard />, qc);
  await openSheet();
  await answerAll();
}

beforeEach(() => {
  net.phase = 'authenticated';
  net.push.mockReset();
  net.apiFetch.mockReset();
  qc = newTestClient();
  h.catalog = CATALOG;
  h.productsHang = null;
  h.variations = {};
  h.soldOut = new Set();
  h.quizClaimed = false;
  h.statusHang = false;
  sessionStorage.clear();
  localStorage.clear();
  window.history.pushState({}, '', '/vuon-xanh');
  net.apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
    const key = path.split('?')[0]!;
    const method = opts?.method ?? 'GET';
    if (key === '/products' && method === 'GET') return h.productsHang ? new Promise((r) => (h.productsHang = r)) : page(h.catalog);
    if (key === '/game/arcade/status') return h.statusHang ? new Promise(() => undefined) : STATUS(h.quizClaimed);
    if (key === '/game/home-quiz/complete') return { granted: 20, alreadyClaimed: false, totalSeeds: 25 };
    if (key === '/cart/items' && method === 'POST') return { ...CART, itemCount: 1 };
    if (key === '/cart') return CART;
    if (key === '/config/public') return {};
    const m = /^\/products\/([^/]+)$/.exec(key);
    if (m) {
      const slug = decodeURIComponent(m[1]!);
      const d = detail(slug, h.variations[slug] ?? 1);
      return h.soldOut.has(slug) ? { ...d, variations: d.variations.map((v) => ({ ...v, stock: 0 })) } : d;
    }
    throw new Error(`đường dẫn lạ ${path}`);
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

describe('HomeQuizCard: thẻ mời', () => {
  it('khách: thẻ tĩnh (h2, mô tả, dòng hứa quà, nút Bắt đầu có tên đầy đủ), chưa bấm thì không gọi mạng và không có hộp thoại', async () => {
    net.phase = 'guest';
    mounted = render(<HomeQuizCard />, qc);
    await flush(3);
    const c = q('home-quiz-card')!;
    expect(c.querySelector('h2')!.textContent).toBe('Chẩn đoán tổ ấm');
    expect(c.textContent).toContain('30 giây, gợi ý bộ sản phẩm hợp nhà bạn');
    expect(c.textContent).toContain('Lần đầu hoàn thành có quà Giọt nước');
    expect(c.querySelector('button')!.getAttribute('aria-label')).toBe('Bắt đầu Chẩn đoán tổ ấm');
    expect(c.getAttribute('aria-labelledby')).toBe(c.querySelector('h2')!.id);
    expect(dialog()).toBeNull();
    expect(net.apiFetch).not.toHaveBeenCalled();
  });

  it('đã đăng nhập: chỉ đọc trạng thái (GET /game/arcade/status), chưa gọi sản phẩm hay quà; chưa nhận quà thì vẫn hứa quà', async () => {
    mounted = render(<HomeQuizCard />, qc);
    await flush(3);
    expect(calls()).toEqual(['GET /game/arcade/status']);
    expect(q('home-quiz-card')!.textContent).toContain('Lần đầu hoàn thành có quà Giọt nước');
    expect(dialog()).toBeNull();
  });

  it('đã đăng nhập và máy chủ báo quizClaimed: dòng phụ đổi sang "đã nhận quà", không hứa lần nữa', async () => {
    h.quizClaimed = true;
    mounted = render(<HomeQuizCard />, qc);
    await flush(3);
    const c = q('home-quiz-card')!;
    expect(c.textContent).not.toContain('Lần đầu hoàn thành có quà Giọt nước');
    expect(c.textContent).toContain('Bạn đã nhận quà Giọt nước của Chẩn đoán tổ ấm');
  });

  it('đang chờ trạng thái: dòng quà vẫn chiếm chỗ nhưng ẩn (không thấy lời hứa rồi mất, thẻ không đổi chiều cao)', async () => {
    h.statusHang = true;
    mounted = render(<HomeQuizCard />, qc);
    await flush(3);
    const line = Array.from(q('home-quiz-card')!.querySelectorAll('p')).find((p) => p.textContent === 'Lần đầu hoàn thành có quà Giọt nước')!;
    expect(line.className).toContain('invisible');
  });

  it('lỗi đọc trạng thái: quay về dòng hứa quà, hiện rõ', async () => {
    const base = net.apiFetch.getMockImplementation()!;
    net.apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path.split('?')[0] === '/game/arcade/status') throw new Error('mất mạng');
      return base(path, opts);
    });
    mounted = render(<HomeQuizCard />, qc);
    await flush(4);
    const line = Array.from(q('home-quiz-card')!.querySelectorAll('p')).find((p) => p.textContent === 'Lần đầu hoàn thành có quà Giọt nước')!;
    expect(line.className).not.toContain('invisible');
  });

  it('bấm Bắt đầu mở sheet ở câu 1/3 với hai đáp án; vẫn chưa tải sản phẩm', async () => {
    mounted = render(<HomeQuizCard />, qc);
    await openSheet();
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Chẩn đoán tổ ấm');
    expect(dialogText()).toContain('Câu 1/3');
    expect(dialogText()).toContain('Nhà bạn có em bé hoặc thú cưng không?');
    expect(q('home-quiz-question')!.querySelectorAll('[role="group"] button')).toHaveLength(2);
    expect(callsTo('GET /products')).toHaveLength(0);
  });
});

describe('HomeQuizCard: ba câu hỏi', () => {
  it('chạm một đáp án là sang câu kế (2/3, 3/3) rồi ra kết quả; sản phẩm chỉ tải sau câu cuối', async () => {
    mounted = render(<HomeQuizCard />, qc);
    await openSheet();
    await pick('Có em bé hoặc thú cưng');
    expect(dialogText()).toContain('Câu 2/3');
    expect(dialogText()).toContain('Bạn ngại điều gì nhất khi dọn nhà, rửa chén?');
    expect(q('home-quiz-question')!.querySelectorAll('[role="group"] button')).toHaveLength(3);
    await pick('Vết dầu mỡ bám dai');
    expect(dialogText()).toContain('Câu 3/3');
    expect(callsTo('GET /products')).toHaveLength(0);
    await pick('Túi Refill tiết kiệm');
    await flush(4);
    expect(q('home-quiz-question')).toBeNull();
    expect(dialogText()).toContain('Bộ gợi ý cho nhà bạn');
    expect(callsTo('GET /products')).toHaveLength(1);
  });

  it('Quay lại về câu trước và giữ đáp án đã chọn (aria-pressed); câu 1 không có Quay lại', async () => {
    mounted = render(<HomeQuizCard />, qc);
    await openSheet();
    expect(byLabel('Quay lại')).toBeNull();
    await pick('Chỉ có người lớn');
    expect(dialogText()).toContain('Câu 2/3');
    click(byLabel('Quay lại'));
    await flush(1);
    expect(dialogText()).toContain('Câu 1/3');
    expect(byLabel('Chỉ có người lớn')!.getAttribute('aria-pressed')).toBe('true');
    expect(byLabel('Có em bé hoặc thú cưng')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('chạm đúp liền nhau vào một đáp án chỉ sang câu kế, không nhảy qua câu 2', async () => {
    mounted = render(<HomeQuizCard />, qc);
    await openSheet();
    const opt = byLabel('Có em bé hoặc thú cưng')!;
    act(() => {
      opt.click();
      opt.click();
    });
    await flush(2);
    expect(dialogText()).toContain('Câu 2/3');
    expect(dialogText()).not.toContain('Câu 3/3');
  });
});

describe('HomeQuizCard: kết quả', () => {
  it('tải danh sách bán chạy giới hạn 40 và vẽ đúng các món pickKitProducts chọn, theo thứ tự điểm', async () => {
    await reachResult();
    const [path] = callsTo('GET /products')[0]!;
    expect(String(path)).toContain('limit=40');
    expect(String(path)).toContain('sort=best_seller');
    expect(kitNames()).toEqual(KIT_NAMES);
    expect(kitNames()).toEqual(pickKitProducts(ANSWERS, CATALOG, 3).map((p) => p.name));
    expect(addButtons()).toHaveLength(3);
  });

  it('chờ danh sách: ba khung chờ có aria-busy, rồi thay bằng thẻ thật', async () => {
    h.productsHang = () => undefined;
    await reachResult();
    expect(q('home-quiz-loading')!.getAttribute('aria-busy')).toBe('true');
    expect(q('home-quiz-kit')).toBeNull();
    await act(async () => h.productsHang!(page(CATALOG)));
    await flush(4);
    expect(q('home-quiz-loading')).toBeNull();
    expect(kitNames()).toEqual(KIT_NAMES);
  });

  it('không có món bán được: câu thân thiện và nút Xem sản phẩm đóng sheet rồi sang /san-pham', async () => {
    h.catalog = [product('het', 'Hết sạch', { inStock: false }), product('free', 'Quà tặng', { basePrice: 0 })];
    await reachResult();
    expect(q('home-quiz-kit')).toBeNull();
    expect(q('home-quiz-empty')!.textContent).toContain('Chưa có sản phẩm để gợi ý lúc này');
    click(byLabel('Xem sản phẩm'));
    await flush(2);
    expect(dialog()).toBeNull();
    expect(net.push).toHaveBeenCalledWith('/san-pham');
  });

  it('danh sách rỗng cũng ra trạng thái rỗng, không lỗi', async () => {
    h.catalog = [];
    await reachResult();
    expect(q('home-quiz-empty')).not.toBeNull();
    expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
  });

  it('tải sản phẩm lỗi: báo lỗi, Thử lại tải lại và ra danh sách; có kết quả rồi thì hết báo lỗi', async () => {
    let fail = true;
    const base = net.apiFetch.getMockImplementation()!;
    net.apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path.split('?')[0] === '/products' && fail) throw new Error('mất mạng');
      return base(path, opts);
    });
    await reachResult();
    const alert = dialog()!.querySelector('[role="alert"]')!;
    expect(alert.textContent!.length).toBeGreaterThan(0);
    expect(q('home-quiz-kit')).toBeNull();
    fail = false;
    click(Array.from(alert.querySelectorAll('button')).find((b) => b.textContent === 'Thử lại')!);
    await flush(4);
    expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
    expect(kitNames()).toEqual(KIT_NAMES);
  });

  it('Làm lại: về câu 1/3, xoá đáp án đã chọn', async () => {
    await reachResult();
    click(byLabel('Làm lại'));
    await flush(2);
    expect(dialogText()).toContain('Câu 1/3');
    expect(byLabel('Có em bé hoặc thú cưng')!.getAttribute('aria-pressed')).toBe('false');
    expect(byLabel('Chỉ có người lớn')!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('HomeQuizCard: nhận quà (đã đăng nhập)', () => {
  it('gọi completeHomeQuiz đúng một lần với ba đáp án; hiện 20 Giọt nước; làm mới game', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    await reachResult();
    const posts = callsTo('POST /game/home-quiz/complete');
    expect(posts).toHaveLength(1);
    expect(posts[0]![1]).toMatchObject({ method: 'POST', body: { family: 'baby_pet', worry: 'grease', format: 'refill' } });
    expect(dialogText()).toContain('Bạn nhận 20 Giọt nước vào Vườn');
    expect(spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain('["game"]');
    expect(dialog()!.querySelector('a[href^="/dang-nhap"]')).toBeNull();
  });

  it('alreadyClaimed từ máy chủ: không khoe quà, nói một dòng đã nhận, không báo lỗi', async () => {
    net.apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const key = path.split('?')[0]!;
      if (key === '/game/home-quiz/complete') return { granted: 0, alreadyClaimed: true, totalSeeds: 25 };
      if (key === '/products') return page(CATALOG);
      if (key === '/cart') return CART;
      if (key === '/config/public') return {};
      throw new Error(`đường dẫn lạ ${path} ${opts?.method}`);
    });
    await reachResult();
    expect(callsTo('POST /game/home-quiz/complete')).toHaveLength(1);
    expect(dialogText()).not.toContain('Giọt nước vào Vườn');
    expect(dialogText()).toContain('Bạn đã nhận quà Giọt nước của Chẩn đoán tổ ấm');
    expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
  });

  it('máy chủ đã báo quizClaimed từ trước: sheet không gọi nhận quà, chỉ một dòng "đã nhận quà"', async () => {
    h.quizClaimed = true;
    mounted = render(<HomeQuizCard />, qc);
    await flush(3);
    await openSheet();
    await answerAll();
    expect(callsTo('POST /game/home-quiz/complete')).toHaveLength(0);
    expect(dialogText()).toContain('Bạn đã nhận quà Giọt nước của Chẩn đoán tổ ấm');
    expect(dialogText()).not.toContain('Bạn nhận');
    expect(kitNames()).toEqual(KIT_NAMES);
  });

  it('nhận quà lần đầu thì không có dòng "đã nhận quà"', async () => {
    await reachResult();
    expect(dialogText()).toContain('Bạn nhận 20 Giọt nước vào Vườn');
    expect(dialogText()).not.toContain('Bạn đã nhận quà');
  });

  it('Làm lại rồi xong lần nữa trong cùng sheet: không gọi máy chủ lần hai', async () => {
    await reachResult();
    click(byLabel('Làm lại'));
    await flush(2);
    await answerAll();
    expect(callsTo('POST /game/home-quiz/complete')).toHaveLength(1);
    expect(dialogText()).toContain('Bạn nhận 20 Giọt nước vào Vườn');
  });

  it('đóng rồi mở lại sheet ở cùng thẻ: không gọi lần hai, vẫn thấy dòng quà đã nhận', async () => {
    await reachResult();
    click(dialog()!.querySelector('button[aria-label="Đóng"]'));
    await flush(2);
    expect(dialog()).toBeNull();
    await openSheet();
    await answerAll();
    expect(callsTo('POST /game/home-quiz/complete')).toHaveLength(1);
    expect(dialogText()).toContain('Bạn nhận 20 Giọt nước vào Vườn');
  });

  it('lưu lỗi: báo "Chưa lưu được kết quả", giữ danh sách sản phẩm; Thử lại gửi lại và hết báo lỗi', async () => {
    const base = net.apiFetch.getMockImplementation()!;
    let failures = 1;
    net.apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path.split('?')[0] === '/game/home-quiz/complete' && failures-- > 0) throw new Error('mất mạng');
      return base(path, opts);
    });
    await reachResult();
    const alert = dialog()!.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Chưa lưu được kết quả. Bạn thử lại nhé.');
    expect(kitNames()).toEqual(KIT_NAMES);
    click(Array.from(alert.querySelectorAll('button')).find((b) => b.textContent === 'Thử lại')!);
    await flush(4);
    expect(callsTo('POST /game/home-quiz/complete')).toHaveLength(2);
    expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
    expect(dialogText()).toContain('Bạn nhận 20 Giọt nước vào Vườn');
  });

  it('Thử lại bấm đúp: chỉ gửi thêm một lần', async () => {
    const base = net.apiFetch.getMockImplementation()!;
    let failures = 1;
    net.apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path.split('?')[0] === '/game/home-quiz/complete') {
        if (failures-- > 0) throw new Error('mất mạng');
        return new Promise(() => undefined);
      }
      return base(path, opts);
    });
    await reachResult();
    const retry = Array.from(dialog()!.querySelectorAll('[role="alert"] button')).find((b) => b.textContent === 'Thử lại') as HTMLButtonElement;
    act(() => {
      retry.click();
      retry.click();
    });
    await flush(2);
    expect(callsTo('POST /game/home-quiz/complete')).toHaveLength(2);
  });
});

describe('HomeQuizCard: khách', () => {
  beforeEach(() => {
    net.phase = 'guest';
  });

  it('kết quả vẫn đầy đủ, không gọi máy chủ để nhận quà, có nút đăng nhập quay lại đúng trang', async () => {
    await reachResult();
    expect(kitNames()).toEqual(KIT_NAMES);
    expect(callsTo('POST /game/home-quiz/complete')).toHaveLength(0);
    const link = dialog()!.querySelector<HTMLAnchorElement>('a[href^="/dang-nhap"]')!;
    expect(link.textContent).toBe('Đăng nhập để nhận quà Giọt nước');
    expect(link.getAttribute('href')).toBe(loginHref('/vuon-xanh'));
    expect(dialogText()).not.toContain('Bạn nhận');
  });

  it('+ Thêm vào giỏ một phân loại: nhớ món chờ rồi sang đăng nhập về trang sản phẩm, không thêm giỏ', async () => {
    await reachResult();
    click(addButtons()[0]!);
    await flush(4);
    expect(callsTo('GET /products/refill')).toHaveLength(1);
    expect(callsTo('POST /cart/items')).toHaveLength(0);
    expect(net.push).toHaveBeenCalledWith(loginHref('/san-pham/refill'));
    expect(takePendingAdd(['v-refill'])).toEqual({ variationId: 'v-refill', quantity: 1 });
  });

  it('nhiều phân loại: không nhớ món, vẫn sang đăng nhập về trang sản phẩm để khách chọn', async () => {
    h.variations = { refill: 2 };
    await reachResult();
    click(addButtons()[0]!);
    await flush(4);
    expect(takePendingAdd(['v-refill-0', 'v-refill-1'])).toBeNull();
    expect(net.push).toHaveBeenCalledWith(loginHref('/san-pham/refill'));
  });
});

describe('HomeQuizCard: thêm vào giỏ (đã đăng nhập)', () => {
  it('một phân loại: tải chi tiết, POST /cart/items số lượng 1; thông báo và Xem giỏ hàng nằm TRONG sheet, không có thông báo nổi dưới sheet', async () => {
    await reachResult();
    click(addButtons()[0]!);
    await flush(5);
    expect(callsTo('GET /products/refill')).toHaveLength(1);
    const posts = callsTo('POST /cart/items');
    expect(posts).toHaveLength(1);
    expect(posts[0]![1]).toMatchObject({ body: { variationId: 'v-refill', quantity: 1 } });
    expect(dialogText()).toContain('Đã thêm vào giỏ!');
    const cart = Array.from(dialog()!.querySelectorAll('a')).find((a) => a.textContent === 'Xem giỏ hàng')!;
    expect(cart.getAttribute('href')).toBe('/gio-hang');
    expect(document.querySelector('.fixed.bottom-24')).toBeNull();
    expect(dialog()!.querySelector('[role="status"]')!.contains(cart)).toBe(true);
  });

  it('nhiều phân loại: mở bảng chọn phân loại, chưa thêm giỏ', async () => {
    h.variations = { refill: 3 };
    await reachResult();
    click(addButtons()[0]!);
    await flush(5);
    expect(q('variation-sheet')!.textContent).toBe('Túi Refill nước giặt:3');
    expect(callsTo('POST /cart/items')).toHaveLength(0);
  });

  it('vừa hết hàng: báo hết hàng trong sheet, không thêm giỏ, không có liên kết Xem giỏ hàng', async () => {
    h.soldOut = new Set(['refill']);
    await reachResult();
    click(addButtons()[0]!);
    await flush(5);
    expect(dialogText()).toContain(QUICK_ADD_SOLD_OUT);
    expect(callsTo('POST /cart/items')).toHaveLength(0);
    expect(Array.from(dialog()!.querySelectorAll('a')).some((a) => a.textContent === 'Xem giỏ hàng')).toBe(false);
  });

  it('máy chủ từ chối thêm giỏ: báo lỗi trong sheet, không nói "Đã thêm", không có Xem giỏ hàng', async () => {
    const base = net.apiFetch.getMockImplementation()!;
    net.apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path.split('?')[0] === '/cart/items') throw new Error('mất mạng');
      return base(path, opts);
    });
    await reachResult();
    click(addButtons()[0]!);
    await flush(5);
    expect(dialogText()).not.toContain('Đã thêm vào giỏ!');
    expect(dialog()!.querySelector('[role="status"]')!.textContent!.length).toBeGreaterThan(0);
    expect(Array.from(dialog()!.querySelectorAll('a')).some((a) => a.textContent === 'Xem giỏ hàng')).toBe(false);
  });

  it('bấm đúp một nút thêm giỏ chỉ POST một lần', async () => {
    await reachResult();
    const add = addButtons()[0]!;
    act(() => {
      add.click();
      add.click();
    });
    await flush(5);
    expect(callsTo('POST /cart/items')).toHaveLength(1);
  });
});

describe('HomeQuizCard: bàn phím và trợ năng', () => {
  it('Esc đóng sheet và trả focus về nút Bắt đầu', async () => {
    mounted = render(<HomeQuizCard />, qc);
    const opener = byLabel('Bắt đầu')!;
    opener.focus();
    click(opener);
    await until(dialog);
    expect(dialog()).not.toBeNull();
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await flush(2);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });

  it('Tab không rơi ra nền: từ phần tử cuối quay về đầu, Shift+Tab từ đầu về cuối', async () => {
    mounted = render(<HomeQuizCard />, qc);
    await openSheet();
    const items = Array.from(dialog()!.querySelectorAll<HTMLElement>('button'));
    const [first, last] = [items[0]!, items[items.length - 1]!];
    last.focus();
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(first);
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(last);
  });

  it('thẻ tĩnh: nút có tên, heading đúng cấp', async () => {
    mounted = render(<HomeQuizCard />, qc);
    expect(unnamedControls(mounted.container)).toEqual([]);
    expect(headingLevels(mounted.container)).toEqual([2]);
  });

  it('sheet ở câu hỏi và ở kết quả: mọi điều khiển có tên, heading h2 rồi h3, đáp án đủ 44px', async () => {
    mounted = render(<HomeQuizCard />, qc);
    await openSheet();
    expect(unnamedControls(dialog()!)).toEqual([]);
    expect(headingLevels(dialog()!)).toEqual([2, 3]);
    const options = Array.from(q('home-quiz-question')!.querySelectorAll<HTMLElement>('[role="group"] button'));
    for (const o of options) expect(parseFloat(o.style.minHeight || '0')).toBeGreaterThanOrEqual(44);
    await answerAll();
    expect(unnamedControls(dialog()!)).toEqual([]);
    expect(headingLevels(dialog()!)).toEqual([2, 3]);
  });

  it('vùng thông báo role="status" có mặt cả khi chưa có thông báo (để lần báo đầu được đọc ra)', async () => {
    await reachResult();
    expect(dialog()!.querySelectorAll('[role="status"]').length).toBeGreaterThanOrEqual(1);
  });
});
