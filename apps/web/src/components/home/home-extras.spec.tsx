// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Chép ý nghĩa HomeExtras trong home-parts.spec của Mini App: thẻ AI/Mua chung, hero "Tìm sản phẩm", lời chào + điểm, dải thương hiệu, hành trình, cộng đồng.
const mocks = vi.hoisted(() => ({ get: vi.fn(), user: null as null | { fullName: string | null; pointsBalance: number; pointsConvertedBalance?: number } }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: mocks.user }) }));

import { HomeExtras } from './home-extras';

let config: () => Promise<unknown>;
let brands: () => Promise<unknown>;
let mounted: Rendered | null = null;
const mount = async (props: Parameters<typeof HomeExtras>[0] = {}) => {
  mounted = render(<HomeExtras {...props} />);
  await flush(8);
  return mounted.container;
};
const link = (c: HTMLElement, name: string | RegExp) =>
  Array.from(c.querySelectorAll<HTMLAnchorElement>('a')).find((a) => (typeof name === 'string' ? a.getAttribute('aria-label') === name || a.textContent === name : name.test(a.textContent ?? '')));

beforeEach(() => {
  mocks.user = { fullName: 'Lan', pointsBalance: 60 };
  config = async () => ({ aiAdvisorEnabled: true });
  brands = async () => [{ brand: 'Tubu', count: 3 }];
  mocks.get.mockReset().mockImplementation((path: string) => (path === '/config/public' ? config() : brands()));
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('HomeExtras', () => {
  it('A2-33: hero dùng "Tìm sản phẩm" (không còn "Khám phá vườn") → mở ô tìm của /san-pham; lời chào kèm điểm', async () => {
    const c = await mount();
    expect(c.textContent).not.toContain('Khám phá vườn');
    expect(link(c, 'Tìm sản phẩm')?.getAttribute('href')).toBe('/san-pham?focus=search');
    expect(c.textContent).toContain('Chào Lan');
    expect(c.textContent).toContain('60 Điểm Xanh');
    expect(c.textContent).toContain('Thiên nhiên Việt cho cả nhà');
  });

  it('PD-3: tổng Điểm Xanh hai lô; khách chỉ có điểm quy đổi vẫn thấy đúng số; thiếu tên → "Chào bạn"', async () => {
    mocks.user = { fullName: 'Lan', pointsBalance: 60, pointsConvertedBalance: 40 };
    expect((await mount()).textContent).toContain('100 Điểm Xanh');
    mounted!.unmount();
    mocks.user = { fullName: null, pointsBalance: 0, pointsConvertedBalance: 1200 };
    const c = await mount();
    expect(c.textContent).toContain('Chào bạn');
    expect(c.textContent).toContain('1.200 Điểm Xanh');
  });

  it('khách chưa đăng nhập → hero không có lời chào', async () => {
    mocks.user = null;
    expect((await mount()).textContent).not.toContain('Chào ');
  });

  it('thẻ nhỏ AI / Mua chung; thương hiệu mở /san-pham lọc sẵn; Hành trình và Cộng đồng có lối vào', async () => {
    const c = await mount();
    expect(link(c, 'Hỏi trợ lý AI 24/7')?.getAttribute('href')).toBe('/tu-van');
    expect(link(c, 'Mua chung giá tốt')?.getAttribute('href')).toBe('/mua-chung');
    expect(link(c, 'Tubu')?.getAttribute('href')).toBe('/san-pham?brand=Tubu');
    expect(link(c, /Hành trình nguyên liệu/)?.getAttribute('href')).toBe('/cau-chuyen');
    expect(link(c, /Cộng đồng Vườn Tubu/)?.getAttribute('href')).toBe('/cong-dong');
  });

  it.each([
    ['server báo tắt', async () => ({ aiAdvisorEnabled: false })],
    ['API cũ không có cờ', async () => ({})],
    ['không tải được cấu hình', async () => Promise.reject(new Error('mạng'))],
  ])('AI tắt (%s) → ẩn thẻ AI, thẻ Mua chung vẫn còn', async (_name, arrange) => {
    config = arrange;
    const c = await mount();
    expect(link(c, 'Hỏi trợ lý AI 24/7')).toBeUndefined();
    expect(link(c, 'Mua chung giá tốt')).toBeDefined();
  });

  it('tên thương hiệu có ký tự đặc biệt được mã hoá trong URL', async () => {
    brands = async () => [{ brand: 'Cỏ & Cây', count: 1 }];
    const c = await mount();
    expect(link(c, 'Cỏ & Cây')?.getAttribute('href')).toBe('/san-pham?brand=C%E1%BB%8F+%26+C%C3%A2y');
  });

  it('dải thương hiệu: khung chờ trong lúc tải (5 ô), rồi chip thật', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    brands = () => new Promise((r) => (resolve = r));
    const c = await mount();
    expect(c.querySelector('section[aria-label="Thương hiệu Việt"]')).not.toBeNull();
    expect(c.querySelectorAll('[data-testid="brand-chip-skeleton"]')).toHaveLength(5);
    resolve([{ brand: 'Tubu', count: 3 }]);
    await flush(6);
    expect(c.querySelectorAll('[data-testid="brand-chip-skeleton"]')).toHaveLength(0);
    expect(link(c, 'Tubu')).toBeDefined();
  });

  it('dải thương hiệu có tên riêng để trình đọc màn hình hiểu là vùng cuộn ngang', async () => {
    const c = await mount();
    expect(c.querySelector('ul[aria-label="Dải thương hiệu, vuốt ngang để xem thêm"]')).not.toBeNull();
  });

  it('không có thương hiệu hoặc tải lỗi → ẩn cả dải, phần còn lại vẫn dùng được', async () => {
    brands = async () => [];
    let c = await mount();
    expect(c.querySelector('section[aria-label="Thương hiệu Việt"]')).toBeNull();
    mounted!.unmount();
    brands = async () => Promise.reject(new Error('x'));
    c = await mount();
    expect(c.querySelector('section[aria-label="Thương hiệu Việt"]')).toBeNull();
    expect(link(c, 'Tìm sản phẩm')).toBeDefined();
  });

  it('dùng danh sách thương hiệu server đã tải sẵn làm dữ liệu đầu (không chờ khung chờ)', async () => {
    brands = () => new Promise(() => undefined);
    mounted = render(<HomeExtras initialBrands={[{ brand: 'Mộc An', count: 2 }]} />);
    expect(link(mounted.container, 'Mộc An')).toBeDefined();
    expect(mounted.container.querySelectorAll('[data-testid="brand-chip-skeleton"]')).toHaveLength(0);
  });

  it('điều khiển có tên và vùng chạm 44px', async () => {
    const c = await mount();
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});
