// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { featuredAffiliateProducts, type FeaturedSource } from '@tubutree/app-core/commerce/affiliate-share';
import { vnd } from '@tubutree/app-core/commerce/money';
import { byText, click, flush } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { mount } from '@/components/mini/harness';

const mocks = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('@/lib/copy-text', () => ({ copyText: (t: string) => mocks.copyText(t) }));

import { AffiliateFeaturedProducts } from './featured-products';

const source = (over: Partial<FeaturedSource> & Pick<FeaturedSource, 'id' | 'name' | 'slug'>): FeaturedSource => ({
  thumbnail: null,
  basePrice: 100000,
  salePrice: null,
  maxAffiliateRate: 10,
  ...over,
});

const PRODUCTS = featuredAffiliateProducts(
  [
    source({ id: 'a', name: 'Ly tre', slug: 'ly-tre', basePrice: 100000, maxAffiliateRate: 10 }),
    source({ id: 'b', name: 'Bàn chải tre', slug: 'ban-chai-tre', basePrice: 200000, salePrice: 150000, maxAffiliateRate: 20 }),
  ],
  { baseUrl: 'https://tubutree.com', affiliateCode: 'TUBU01' },
);

const rows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="ctv-featured-row"]'));
const buttonIn = (row: HTMLElement) => row.querySelector('button');

beforeEach(() => {
  mocks.copyText.mockReset();
  mocks.copyText.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe('AffiliateFeaturedProducts (web)', () => {
  it('tiêu đề, dòng xếp hoa hồng nhiều nhất lên đầu, mỗi dòng ghi mức % và số tiền dự kiến mỗi đơn', () => {
    const { container } = mount(<AffiliateFeaturedProducts products={PRODUCTS} />);
    const h2 = container.querySelector('h2');
    expect(h2?.textContent).toBe('Sản phẩm hoa hồng nổi bật');
    expect(container.querySelector('section')?.getAttribute('aria-labelledby')).toBe(h2?.id);
    expect(container.textContent).toContain('Chia sẻ nhanh');
    const r = rows(container);
    expect(r).toHaveLength(2);
    expect(r[0]!.textContent).toContain('Bàn chải tre');
    expect(r[0]!.textContent).toContain('Hoa hồng tới 20%');
    expect(r[0]!.textContent).toContain(`Dự kiến tới ${vnd(30000)} mỗi đơn`);
    expect(r[1]!.textContent).toContain('Ly tre');
    expect(r[1]!.textContent).toContain('Hoa hồng tới 10%');
    expect(r[1]!.textContent).toContain(`Dự kiến tới ${vnd(10000)} mỗi đơn`);
  });

  it('số tiền dự kiến dùng số đều (tabular-nums)', () => {
    const { container } = mount(<AffiliateFeaturedProducts products={PRODUCTS} />);
    const amount = byText(container, 'span', `Dự kiến tới ${vnd(30000)} mỗi đơn`);
    expect(amount?.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('chạm "Chép link giới thiệu": chép lời giới thiệu kèm link có ?ref=, chỉ dòng đó đổi nhãn "Đã chép link", 2 giây sau trả nhãn cũ', async () => {
    vi.useFakeTimers();
    const { container } = mount(<AffiliateFeaturedProducts products={PRODUCTS} />);
    const first = () => rows(container)[0]!;
    const second = () => rows(container)[1]!;
    expect(buttonIn(first())?.getAttribute('aria-label')).toBe('Chép link giới thiệu Bàn chải tre');
    await act(async () => {
      click(buttonIn(first()));
    });
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    const copied = mocks.copyText.mock.calls[0]?.[0] as string;
    expect(copied).toContain('https://tubutree.com/san-pham/ban-chai-tre?ref=TUBU01');
    expect(copied).not.toContain('!');
    expect(buttonIn(first())?.getAttribute('aria-label')).toBe('Đã chép link giới thiệu Bàn chải tre');
    expect(buttonIn(second())?.getAttribute('aria-label')).toBe('Chép link giới thiệu Ly tre');
    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(buttonIn(first())?.getAttribute('aria-label')).toBe('Đã chép link giới thiệu Bàn chải tre');
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(buttonIn(first())?.getAttribute('aria-label')).toBe('Chép link giới thiệu Bàn chải tre');
  });

  it('chép không được: giữ nhãn cũ và nói cách chép tay ở đúng dòng đó', async () => {
    mocks.copyText.mockResolvedValue(false);
    const { container } = mount(<AffiliateFeaturedProducts products={PRODUCTS} />);
    click(buttonIn(rows(container)[1]!));
    await flush();
    expect(rows(container)[1]!.textContent).toContain('Không chép được, hãy chép link thủ công.');
    expect(rows(container)[0]!.textContent).not.toContain('Không chép được');
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Không chép được, hãy chép link thủ công.');
    expect(container.querySelector('button[aria-label^="Đã chép link"]')).toBeNull();
  });

  it('vùng aria-live có sẵn từ lúc dựng (không chèn cùng chữ) và đọc "Đã chép link giới thiệu <tên>" sau khi chép', async () => {
    const { container } = mount(<AffiliateFeaturedProducts products={PRODUCTS} />);
    const live = () => container.querySelector('[aria-live="polite"]');
    expect(live()).not.toBeNull();
    expect(live()?.textContent).toBe('');
    click(buttonIn(rows(container)[1]!));
    await flush();
    expect(live()?.textContent).toBe('Đã chép link giới thiệu Ly tre');
  });

  it('ghi chú nói số tiền là ước tính theo giá hiển thị; không hiện ở trạng thái chờ, rỗng, lỗi', () => {
    const note = 'Ước tính theo giá đang hiển thị, hoa hồng thật tính trên số tiền khách đã trả.';
    expect(mount(<AffiliateFeaturedProducts products={PRODUCTS} />).container.textContent).toContain(note);
    for (const ui of [<AffiliateFeaturedProducts key="a" products={null} />, <AffiliateFeaturedProducts key="b" products={[]} />, <AffiliateFeaturedProducts key="c" products={null} error />]) {
      expect(mount(ui).container.textContent).not.toContain(note);
    }
  });

  it('đang tải: khung chờ có tên, chưa có dòng nào', () => {
    const { container } = mount(<AffiliateFeaturedProducts products={null} />);
    expect(container.querySelector('[role="status"][aria-label="Sản phẩm hoa hồng nổi bật"]')).not.toBeNull();
    expect(rows(container)).toHaveLength(0);
  });

  it('danh sách rỗng: nói rõ chưa có sản phẩm, không có nút', () => {
    const { container } = mount(<AffiliateFeaturedProducts products={[]} />);
    expect(container.textContent).toContain('Chưa có sản phẩm nào có hoa hồng để chia sẻ.');
    expect(container.querySelector('button')).toBeNull();
  });

  it('tải lỗi: lời báo role=alert, nút "Thử lại" gọi onRetry; thiếu onRetry thì không có nút', () => {
    const onRetry = vi.fn();
    const withRetry = mount(<AffiliateFeaturedProducts products={null} error onRetry={onRetry} />);
    expect(withRetry.container.querySelector('[role="alert"]')?.textContent).toContain('Chưa tải được danh sách sản phẩm.');
    click(byText(withRetry.container, 'button', 'Thử lại'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    const withoutRetry = mount(<AffiliateFeaturedProducts products={null} error />);
    expect(byText(withoutRetry.container, 'button', 'Thử lại')).toBeNull();
  });

  it('nút có tên và đủ vùng chạm 44px', () => {
    const { container } = mount(<AffiliateFeaturedProducts products={PRODUCTS} error={false} />);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
});
