// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { formatVnd } from '@/lib/format-vnd';

// Cùng ý nghĩa group-buy.tsx của Mini App: danh sách nhóm, nhóm được mời, tham gia cần đăng nhập, chia sẻ có ref, nút theo trạng thái.

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading' | 'unavailable',
  user: null as { referralCode?: string } | null,
  push: vi.fn(),
  retrySession: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  share: vi.fn(),
  list: [] as unknown[],
  one: null as unknown,
  oneError: false,
  flash: [] as unknown[],
}));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => mocks.flash }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: mocks.user, retrySession: mocks.retrySession }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { share: mocks.share } }));

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

let mounted: Rendered[] = [];
const mount = async (invitedId?: string) => {
  const r = render(<GroupBuyView invitedId={invitedId} />);
  mounted.push(r);
  await flush(5);
  return r.container;
};
const btn = (c: HTMLElement, name: string | RegExp) =>
  Array.from(c.querySelectorAll('button')).find((b) => {
    const t = (b.getAttribute('aria-label') ?? b.textContent ?? '').trim();
    return typeof name === 'string' ? t === name : name.test(t);
  });

beforeEach(() => {
  mocks.flash = [];
  mocks.phase = 'authenticated';
  mocks.user = null;
  mocks.list = [GROUP('a'), GROUP('b', { joined: true })];
  mocks.one = null;
  mocks.oneError = false;
  mocks.push.mockReset();
  mocks.retrySession.mockReset();
  mocks.share.mockReset().mockResolvedValue('shared');
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/group-buy') return mocks.list;
    if (mocks.oneError) throw new Error('không thấy nhóm');
    return mocks.one;
  });
  mocks.post.mockReset().mockResolvedValue({ joined: true, currentSize: 3, status: 'OPEN' });
});
describe('lời báo vừa mở nhóm (?moi=1)', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('có cờ → hiện lời báo như Mini App rồi gỡ cờ khỏi địa chỉ, giữ tham số khác', async () => {
    window.history.replaceState(null, '', '/mua-chung/g1?ref=A&moi=1');
    mocks.one = GROUP('g1', { isOwner: true, joined: true });
    const c = await mount('g1');
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Đã mở nhóm mua chung! Rủ bạn bè tham gia nhé');
    expect(window.location.search).toBe('?ref=A');
  });

  it('không có cờ → không có lời báo', async () => {
    mocks.one = GROUP('g1', { isOwner: true, joined: true });
    const c = await mount('g1');
    expect(c.querySelector('[role="status"]')).toBeNull();
  });
});

afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/mua-chung — danh sách nhóm', () => {
  it('hiện tên, giá nhóm, giá gốc, % giảm, số người và thời hạn của từng nhóm', async () => {
    const c = await mount();
    expect(c.querySelector('h1')?.textContent).toBe('Mua chung giá tốt');
    expect(c.textContent).toContain('Rủ thêm bạn cho đủ nhóm — đủ người, ai cũng nhận mã giảm giá!');
    expect(c.textContent).toContain('Sản phẩm a');
    expect(c.textContent).toContain(formatVnd(80_000));
    expect(c.textContent).toContain(formatVnd(100_000));
    expect(c.textContent).toContain('−20%');
    expect(c.textContent).toContain('2/5 người · còn 2 giờ');
    expect(mocks.get).toHaveBeenCalledWith('/group-buy');
  });

  it('lưới nhóm có cột co được (minmax(0,1fr)) để tên dài cắt bằng dấu ba chấm thay vì đẩy trang tràn ngang ở 320px', async () => {
    mocks.list = [GROUP('g1', { product: { name: 'Một sản phẩm có tên rất dài '.repeat(4), slug: 'sp', thumbnail: null } })];
    const c = await mount();
    // Mini App: thẻ không viền, chữ body-sm/caption (lớn hơn text-sm/xs cũ).
    const article = c.querySelector('article')!;
    expect(article.className).toContain('max-md:border-0');
    expect(article.className).toContain('max-md:shadow-[var(--elevation-1)]');
    expect(c.querySelector('article a span.font-semibold')!.className).toContain('max-md:text-[length:var(--type-body-sm-size)]');
    const grid = c.querySelector('article')?.parentElement;
    expect(grid?.className).toContain('grid-cols-[minmax(0,1fr)]');
  });

  it('bấm ảnh/tên sản phẩm mở trang sản phẩm web', async () => {
    const c = await mount();
    expect(c.querySelector('a[href="/san-pham/sp-a"]')).not.toBeNull();
  });

  it('nói rõ cơ chế: đủ người thì nhận mã giảm theo % của nhóm (mã giảm % trên biến thể khách mua, không phải số tiền cố định)', async () => {
    const c = await mount();
    expect(c.textContent).toContain(`Đủ 5 người: mỗi người nhận mã giảm 20%, dùng cho đơn từ ${formatVnd(80_000)}`);
    expect(c.textContent).not.toContain(`mã giảm ${formatVnd(20_000)}`);
  });

  it('Q18: đơn từ ghi đúng đơn tối thiểu của mã (minOrder) khi API trả, thiếu thì dùng giá nhóm', async () => {
    mocks.list = [GROUP('a', { unitPrice: 365_500, basePrice: 430_000, minOrder: 102_000, discountPct: 15 })];
    const c = await mount();
    expect(c.textContent).toContain(`Đủ 5 người: mỗi người nhận mã giảm 15%, dùng cho đơn từ ${formatVnd(102_000)}`);
    expect(c.textContent).not.toContain(`dùng cho đơn từ ${formatVnd(365_500)}`);
  });

  it('% lấy từ discountPct của nhóm, không tính lại từ basePrice - unitPrice', async () => {
    mocks.list = [GROUP('a', { discountPct: 15, basePrice: 100_000, unitPrice: 80_000 })];
    const c = await mount();
    expect(c.textContent).toContain('mỗi người nhận mã giảm 15%');
    expect(c.textContent).not.toContain('mã giảm 20%');
  });

  it('thời hạn: dưới một giờ tính phút, quá hạn thì "đã hết hạn"', async () => {
    mocks.list = [
      GROUP('m', { expiresAt: new Date(Date.now() + 30.5 * 60_000).toISOString() }),
      GROUP('d', { expiresAt: new Date(Date.now() + 49 * HOUR).toISOString() }),
      GROUP('x', { expiresAt: new Date(Date.now() - 1000).toISOString(), status: 'FAILED' }),
    ];
    const c = await mount();
    expect(c.textContent).toContain('còn 30 phút');
    expect(c.textContent).toContain('còn 2 ngày');
    expect(c.textContent).toContain('đã hết hạn');
  });

  it('chưa có nhóm nào: trạng thái trống, "Khám phá sản phẩm" sang /san-pham', async () => {
    mocks.list = [];
    const c = await mount();
    expect(c.textContent).toContain('Chưa có nhóm mua chung nào');
    expect(c.querySelector('a[href="/san-pham"]')?.textContent).toBe('Khám phá sản phẩm');
  });

  it('lỗi tải: báo lỗi và Thử lại tải lại', async () => {
    mocks.get.mockRejectedValueOnce(new Error('boom'));
    const c = await mount();
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    click(btn(c, 'Thử lại')!);
    await flush(4);
    expect(c.textContent).toContain('Sản phẩm a');
  });
});

describe('/mua-chung — tham gia', () => {
  it('đã đăng nhập, chưa tham gia: gửi POST /group-buy/:id/join, báo đã tham gia rồi tải lại danh sách', async () => {
    const c = await mount();
    click(btn(c, 'Tham gia mua chung (−20%)')!);
    await flush(5);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/group-buy/a/join');
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đã tham gia nhóm');
    expect(mocks.get.mock.calls.filter((x) => x[0] === '/group-buy').length).toBeGreaterThanOrEqual(2);
  });

  it('nhóm đủ người sau khi tham gia: báo mã giảm giá đã vào ví', async () => {
    mocks.post.mockResolvedValue({ joined: true, currentSize: 5, status: 'SUCCESS' });
    const c = await mount();
    click(btn(c, /^Tham gia mua chung/)!);
    await flush(5);
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Nhóm đã đủ người! Mã giảm giá đã vào ví của bạn.');
  });

  it('tham gia lỗi: hiện thông báo lỗi và không tải lại danh sách', async () => {
    mocks.post.mockRejectedValue(new Error('Nhóm đã đủ người'));
    const c = await mount();
    const before = mocks.get.mock.calls.length;
    click(btn(c, /^Tham gia mua chung/)!);
    await flush(5);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Nhóm đã đủ người');
    expect(mocks.get.mock.calls.length).toBe(before);
  });

  it('đã tham gia: chữ trạng thái kèm số người còn thiếu, không còn nút "Đã tham gia" bị khoá', async () => {
    const c = await mount();
    expect(btn(c, 'Đã tham gia')).toBeUndefined();
    expect(c.textContent).toMatch(/Bạn đã ở trong nhóm · cần thêm \d+ người/);
    expect(btn(c, 'Mời bạn bè')).toBeDefined();
  });

  it('B-72: ghi giá nhóm và giá mua một mình, không gạch giá', async () => {
    mocks.list = [GROUP('a', { unitPrice: 102_000, basePrice: 120_000, discountPct: 15 })];
    const c = await mount();
    expect(c.textContent).toContain(`Giá nhóm ${formatVnd(102_000)}`);
    expect(c.textContent).toContain(`Mua một mình ${formatVnd(120_000)}`);
    expect(c.querySelector('.line-through')).toBeNull();
  });

  it('B-72: Giờ vàng của phân loại giá nhóm dựa trên, còn đắt hơn giá nhóm: "Mua một mình" theo giá Giờ vàng hiện nay, không theo giá lưu', async () => {
    mocks.list = [GROUP('a', { unitPrice: 85_000, basePrice: 120_000, variationId: 'v1' })];
    mocks.flash = [{ itemId: 'f', variationId: 'v1', productSlug: 'sp-a', flashPrice: 90_000, retailPrice: 120_000, salePrice: null, endAt: new Date(Date.now() + 3_600_000).toISOString() }];
    const c = await mount();
    expect(c.textContent).toContain(`Mua một mình ${formatVnd(90_000)}`);
    expect(c.textContent).not.toContain(`Mua một mình ${formatVnd(120_000)}`);
  });

  it('B-72: Giờ vàng rẻ hơn cả giá nhóm: không còn nhãn "Mua một mình", ghi "Giờ vàng đang rẻ hơn"; suất của phân loại khác không tính', async () => {
    mocks.list = [GROUP('a', { unitPrice: 102_000, basePrice: 120_000, variationId: 'v1' })];
    mocks.flash = [{ itemId: 'f', variationId: 'v1', productSlug: 'sp-a', flashPrice: 90_000, retailPrice: 120_000, salePrice: null, endAt: new Date(Date.now() + 3_600_000).toISOString() }];
    const c = await mount();
    expect(c.textContent).toContain(`Giờ vàng đang rẻ hơn: ${formatVnd(90_000)}`);
    expect(c.textContent).not.toContain('Mua một mình');
    mocks.flash = [{ ...({ itemId: 'f', variationId: 'v1', productSlug: 'sp-a', flashPrice: 90_000, retailPrice: 120_000, salePrice: null, endAt: new Date(Date.now() + 3_600_000).toISOString() }), variationId: 'v-khac' }];
    mounted.forEach((m) => m.unmount());
    mounted = [];
    const c2 = await mount();
    expect(c2.textContent).toContain(`Mua một mình ${formatVnd(120_000)}`);
  });

  it('đang gửi tham gia: bấm lại không gửi thêm', async () => {
    let release!: (v: unknown) => void;
    mocks.post.mockReturnValue(new Promise((r) => (release = r)));
    const c = await mount();
    click(btn(c, /^Tham gia mua chung/)!);
    await flush(2);
    click(btn(c, /^Tham gia mua chung|Đang gửi/)!);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    release({ joined: true, currentSize: 3, status: 'OPEN' });
    await flush(3);
  });

  it('khách chưa đăng nhập: nút "Đăng nhập để tham gia" sang đăng nhập rồi quay lại, không gửi tham gia (kể cả nhóm joined)', async () => {
    mocks.phase = 'guest';
    mocks.list = [GROUP('a'), GROUP('b', { joined: true })];
    const c = await mount();
    const buttons = Array.from(c.querySelectorAll('button')).filter((b) => b.textContent === 'Đăng nhập để tham gia');
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => !b.disabled)).toBe(true);
    click(buttons[0]!);
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fmua-chung');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(btn(c, 'Mời bạn bè')).toBeUndefined();
  });

  it('khách mở link nhóm: quay lại đúng /mua-chung/:id sau đăng nhập', async () => {
    mocks.phase = 'guest';
    const c = await mount('g 1');
    click(btn(c, 'Đăng nhập để tham gia')!);
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fmua-chung%2Fg%201');
  });
});

describe('/mua-chung — nhóm của mình và mời bạn', () => {
  it('người mở nhóm thấy chữ trạng thái thay vì "Tham gia", nút chính là mời bạn', async () => {
    mocks.list = [GROUP('mine', { joined: true, isOwner: true })];
    const c = await mount();
    expect(btn(c, 'Nhóm của bạn')).toBeUndefined();
    expect(c.textContent).toContain('Bạn đã ở trong nhóm');
    expect(btn(c, /^Tham gia mua chung/)).toBeUndefined();
    expect(btn(c, 'Mời bạn bè')).toBeDefined();
  });

  it('"Mời bạn bè" chia sẻ đường dẫn thẳng tới nhóm web, có tiêu đề và nội dung nêu số người còn thiếu', async () => {
    mocks.list = [GROUP('mine', { joined: true, isOwner: true })];
    const c = await mount();
    click(btn(c, 'Mời bạn bè')!);
    await flush(2);
    expect(mocks.share).toHaveBeenCalledTimes(1);
    expect(mocks.share).toHaveBeenCalledWith({
      title: 'Mua chung Sản phẩm mine giảm 20%',
      text: 'Còn thiếu 3 người nữa là đủ nhóm, vào tham gia cùng mình nhé!',
      path: '/mua-chung/mine',
    });
  });

  it('người chia sẻ có mã giới thiệu: đường dẫn mang ?ref=', async () => {
    mocks.user = { referralCode: 'ABCD1234' };
    mocks.list = [GROUP('mine', { joined: true, isOwner: true })];
    const c = await mount();
    click(btn(c, 'Mời bạn bè')!);
    await flush(2);
    expect(mocks.share.mock.calls[0]![0].path).toBe('/mua-chung/mine?ref=ABCD1234');
  });

  it('kết quả chia sẻ: chép link thì báo đã chép, thất bại thì nói chép tay; khách đóng hộp thì im', async () => {
    mocks.list = [GROUP('mine', { joined: true, isOwner: true })];
    const c = await mount();
    mocks.share.mockResolvedValueOnce('copied');
    click(btn(c, 'Mời bạn bè')!);
    await flush(3);
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đã sao chép liên kết nhóm.');
    mocks.share.mockResolvedValueOnce('failed');
    click(btn(c, 'Mời bạn bè')!);
    await flush(3);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Không sao chép được');
    mocks.share.mockResolvedValueOnce('cancelled');
    click(btn(c, 'Mời bạn bè')!);
    await flush(3);
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(c.querySelector('[role="status"]')).toBeNull();
  });

  it('thành viên (không phải người mở) cũng mời được; nhóm chưa tham gia thì không có nút mời; nhóm đã đóng không có nút mời', async () => {
    const c = await mount();
    expect(Array.from(c.querySelectorAll('button')).filter((b) => b.textContent === 'Mời bạn bè')).toHaveLength(1);
    mounted.pop()!.unmount();
    mocks.list = [GROUP('done', { joined: true, status: 'SUCCESS' })];
    const c2 = await mount();
    expect(btn(c2, 'Mời bạn bè')).toBeUndefined();
  });
});

describe('/mua-chung/[id] — nhóm được mời', () => {
  it('nhóm được mời hiện đầu danh sách, không lặp ở danh sách chung, có biểu ngữ mời', async () => {
    mocks.one = GROUP('b');
    mocks.list = [GROUP('a'), GROUP('b')];
    const c = await mount('b');
    expect(c.textContent).toContain('Bạn được mời vào nhóm này');
    const names = Array.from(c.querySelectorAll('a[href^="/san-pham/"]'))
      .map((a) => a.getAttribute('href'))
      .filter((h, i, all) => all.indexOf(h) === i);
    expect(names).toEqual(['/san-pham/sp-b', '/san-pham/sp-a']);
    expect(mocks.get).toHaveBeenCalledWith('/group-buy/b');
  });

  it('nhóm của chính mình không có biểu ngữ mời', async () => {
    mocks.one = GROUP('mine', { joined: true, isOwner: true });
    mocks.list = [];
    const c = await mount('mine');
    expect(c.textContent).toContain('Bạn đã ở trong nhóm');
    expect(c.textContent).not.toContain('Bạn được mời vào nhóm này');
  });

  it('link tới nhóm đã hết hạn: báo nhóm đã đóng và không cho tham gia', async () => {
    mocks.one = GROUP('old', { status: 'FAILED' });
    mocks.list = [];
    const c = await mount('old');
    expect((btn(c, 'Nhóm đã hết hạn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('khách chưa đăng nhập: không gọi API chi tiết (cần đăng nhập), vẫn xem được danh sách', async () => {
    mocks.phase = 'guest';
    const c = await mount('b');
    expect(c.textContent).toContain('Sản phẩm a');
    expect(mocks.get).not.toHaveBeenCalledWith('/group-buy/b');
  });

  it('nhóm của mình đã đủ người: mục riêng, hiện mã giảm và nút mua ngay sang trang sản phẩm', async () => {
    mocks.list = [GROUP('a'), GROUP('done', { joined: true, isOwner: true, status: 'SUCCESS', currentSize: 5, couponCode: 'GBUY-DONE-ME' })];
    const c = await mount();
    expect(Array.from(c.querySelectorAll('h2')).map((h) => h.textContent)).toContain('Nhóm đã đủ người của bạn');
    expect(c.textContent).toContain('GBUY-DONE-ME');
    expect(c.textContent).toContain('5/5 người · đã đủ nhóm');
    const buy = Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Mua ngay với mã giảm 20%');
    expect(buy?.getAttribute('href')).toBe('/san-pham/sp-done');
    expect(btn(c, 'Nhóm đã đủ người')).toBeUndefined();
  });
});

describe('/mua-chung — cấu trúc và trợ năng', () => {
  it('một h1 ở mọi trạng thái, thanh tiến độ đúng phần trăm, điều khiển có tên, vùng chạm đủ 44px', async () => {
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(c.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('2');
    expect(c.querySelector('[role="progressbar"]')?.getAttribute('aria-valuemax')).toBe('5');
  });

  it('nhóm không có chỉ tiêu thì thanh tiến độ 0%', async () => {
    mocks.list = [GROUP('z', { targetSize: 0, currentSize: 0 })];
    const c = await mount();
    expect(c.querySelector<HTMLElement>('[data-testid="progress-fill"]')?.style.width).toBe('0%');
  });

  it('đang tải và lỗi vẫn có đúng một h1', async () => {
    const r = render(<GroupBuyView />);
    mounted.push(r);
    expect(r.container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('R-103: ảnh và tên gộp một liên kết cao từ 44px (min-h-14), không có ảnh thì vẫn một liên kết có tên sản phẩm', async () => {
    mocks.list = [GROUP('n', { product: { name: 'Không ảnh', slug: 'khong-anh', thumbnail: null } })];
    const c = await mount();
    const links = c.querySelectorAll('a[href="/san-pham/khong-anh"]');
    expect(links).toHaveLength(1);
    expect(links[0]!.className).toContain('min-h-14');
    expect(links[0]!.textContent).toContain('Không ảnh');
  });
});
