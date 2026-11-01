// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignBanner as Banner, CampaignPlacement } from '@tubutree/app-core/api/campaign';
import { BANNER_HINT_KEY, OFFERS_BANNER_HINT_KEY, type HomeKindState } from '@tubutree/app-core/home-layout';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Bản web của campaign-banner.spec.tsx (Mini App): banner đầu trang Ưu đãi và gợi ý giữ chỗ riêng của vị trí này.
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));

import { CampaignBanner } from './campaign-banner';

const DAY = 86_400_000;
const camp = (id: string, over: Partial<Banner> = {}): Banner => ({
  id, slug: id, title: `Chiến dịch ${id}`, image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', linkType: 'CAMPAIGN_PAGE', linkValue: null,
  audience: 'ALL', startAt: new Date(Date.now() - DAY).toISOString(), endAt: new Date(Date.now() + DAY).toISOString(), ...over,
});

let mounted: Rendered | null = null;
const mount = async (placement: CampaignPlacement, kind: HomeKindState, settle = true) => {
  mounted = render(<CampaignBanner placement={placement} kind={kind} />);
  await flush(settle ? 8 : 2);
  return mounted.container;
};
const links = (c: HTMLElement) => [...c.querySelectorAll<HTMLAnchorElement>('a[href]')].map((a) => a.getAttribute('href'));

beforeEach(() => {
  localStorage.clear();
  mocks.get.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('CampaignBanner (web) — banner đầu trang Ưu đãi', () => {
  it('hỏi đúng vị trí OFFERS_TOP, không đăng nhập', async () => {
    mocks.get.mockResolvedValue([]);
    await mount('OFFERS_TOP', 'new');
    expect(mocks.get).toHaveBeenCalledWith('/campaigns', expect.objectContaining({ query: { placement: 'OFFERS_TOP' }, anonymous: true }));
  });

  it('không có chiến dịch: không vẽ gì, không giữ chỗ', async () => {
    mocks.get.mockResolvedValue([]);
    expect((await mount('OFFERS_TOP', 'new')).innerHTML).toBe('');
  });

  it('chiến dịch cho mọi người hiện, chiến dịch cho khách mới ẩn khi chưa biết loại khách', async () => {
    mocks.get.mockResolvedValue([camp('chung'), camp('moi', { audience: 'NEW' })]);
    const c = await mount('OFFERS_TOP', 'unknown');
    expect(links(c)).toEqual(['/chien-dich/chung']);
    expect(c.querySelector('[data-offers-banner]')).not.toBeNull();
  });

  it('từ lg banner Ưu đãi thấp hơn: tỉ lệ 4:1 ghi đè --banner-ratio chỉ trong khung banner, khung chờ cùng lớp nên không nhảy', async () => {
    mocks.get.mockResolvedValue([camp('chung')]);
    const c = await mount('OFFERS_TOP', 'new');
    expect(c.querySelector('[data-offers-banner]')!.className).toContain('lg:[--banner-ratio:4/1]');
    mounted!.unmount();
    localStorage.setItem(OFFERS_BANNER_HINT_KEY, '1');
    mocks.get.mockReturnValue(new Promise(() => undefined));
    const loading = await mount('OFFERS_TOP', 'new', false);
    expect(loading.querySelector('[data-testid="offers-banner-loading"]')!.className).toContain('lg:[--banner-ratio:4/1]');
  });

  it('API lỗi: rỗng và không ném', async () => {
    mocks.get.mockRejectedValue(new Error('boom'));
    expect((await mount('OFFERS_TOP', 'new')).innerHTML).toBe('');
  });

  describe('giữ chỗ chống nhảy trang (gợi ý riêng của vị trí Ưu đãi)', () => {
    const pending = () => mocks.get.mockReturnValue(new Promise(() => undefined));

    it('lần trước có banner Ưu đãi và đang tải: khung chờ theo --banner-ratio, ẩn với trình đọc màn hình', async () => {
      localStorage.setItem(OFFERS_BANNER_HINT_KEY, '1');
      pending();
      const c = await mount('OFFERS_TOP', 'new', false);
      const frame = c.querySelector('[data-testid="offers-banner-loading"]')!;
      expect(frame.getAttribute('aria-hidden')).toBe('true');
      expect((frame.firstElementChild as HTMLElement).style.aspectRatio).toBe('var(--banner-ratio)');
    });

    it('chưa nhớ gì: chờ im lặng, không giữ chỗ', async () => {
      pending();
      expect((await mount('OFFERS_TOP', 'new', false)).innerHTML).toBe('');
    });

    it('gợi ý của Trang chủ không làm hiện khung chờ ở Ưu đãi (hai vị trí khác nhau)', async () => {
      localStorage.setItem(BANNER_HINT_KEY, '1');
      pending();
      expect((await mount('OFFERS_TOP', 'new', false)).innerHTML).toBe('');
    });

    it('tải xong không có slide: bỏ khung chờ và ghi gợi ý 0; có slide thì ghi 1', async () => {
      localStorage.setItem(OFFERS_BANNER_HINT_KEY, '1');
      mocks.get.mockResolvedValue([]);
      const first = await mount('OFFERS_TOP', 'new');
      expect(first.innerHTML).toBe('');
      expect(localStorage.getItem(OFFERS_BANNER_HINT_KEY)).toBe('0');
      mounted!.unmount();
      mocks.get.mockResolvedValue([camp('a')]);
      await mount('OFFERS_TOP', 'new');
      expect(localStorage.getItem(OFFERS_BANNER_HINT_KEY)).toBe('1');
    });

    it('chưa biết loại khách (unknown): không ghi gợi ý, kẻo lần sau khách mới nhảy trang', async () => {
      mocks.get.mockResolvedValue([camp('chung')]);
      await mount('OFFERS_TOP', 'unknown');
      expect(localStorage.getItem(OFFERS_BANNER_HINT_KEY)).toBeNull();
    });
  });
});
