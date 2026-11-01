import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ZmpUi from 'zmp-ui';
import type { BundleDTO, BundleItemDTO } from '@tubutree/app-core/api/bundle';
import type { CampaignBanner } from '@tubutree/app-core/api/campaign';
import { comboView } from '@tubutree/app-core/commerce/bundle-view';
import type { HomeKindState } from '@tubutree/app-core/home-layout';
import { BANNER_HINT_KEY } from '@tubutree/app-core/home-layout';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchHome: vi.fn(), navigate: vi.fn(), notify: vi.fn(), addAll: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/campaign-api', () => ({ fetchHomeCampaigns: mocks.fetchHome }));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../services/cart-batch', () => ({ addAllToCart: mocks.addAll }));

import { HomeBanner } from './home-banner';
import { HomeCombos } from './home-combos';

const DAY = 86_400_000;
// Lượt vẽ băng chuyền đầu tiên của file chậm hẳn khi máy chạy nhiều bộ test cùng lúc (đã vượt 3s ở tải ~110): chờ lâu hơn mức chung.
const SLOW = { timeout: 5000 };
const camp = (id: string, over: Partial<CampaignBanner> = {}): CampaignBanner => ({
  id,
  slug: id,
  title: `Chiến dịch ${id}`,
  image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: new Date(Date.now() - DAY).toISOString(),
  endAt: new Date(Date.now() + DAY).toISOString(),
  ...over,
});

function renderBanner(kind: HomeKindState = 'new') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HomeBanner kind={kind} />
    </QueryClientProvider>,
  );
}

describe('HomeBanner — banner chiến dịch của Trang chủ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('không có chiến dịch: không vẽ gì, không giữ chỗ', async () => {
    mocks.fetchHome.mockResolvedValue([]);
    const { container } = renderBanner();
    await waitFor(() => expect(mocks.fetchHome).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('hai chiến dịch: vùng "Chương trình nổi bật", nút Dừng tự chuyển chưa bấm, mỗi slide đọc tên và vị trí', async () => {
    mocks.fetchHome.mockResolvedValue([camp('a'), camp('b')]);
    renderBanner();
    expect(await screen.findByRole('region', { name: 'Chương trình nổi bật' }, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dừng tự chuyển' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'Chiến dịch a, 1 trên 2' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Chiến dịch b, 2 trên 2' })).toBeInTheDocument();
  });

  it('một chiến dịch: không nút Dừng, không chấm chuyển slide', async () => {
    mocks.fetchHome.mockResolvedValue([camp('a')]);
    renderBanner();
    expect(await screen.findByRole('region', { name: 'Chương trình nổi bật' }, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('slide là liên kết tới trang chiến dịch', async () => {
    mocks.fetchHome.mockResolvedValue([camp('giua-thu')]);
    renderBanner();
    const link = await screen.findByRole('link', { name: 'Chiến dịch giua-thu' }, SLOW);
    expect(link).toHaveAttribute('href', '/campaign/giua-thu');
  });

  it('khách cũ không thấy chiến dịch dành cho khách mới', async () => {
    mocks.fetchHome.mockResolvedValue([camp('chung'), camp('moi', { audience: 'NEW' })]);
    renderBanner('returning');
    await screen.findByRole('link', { name: 'Chiến dịch chung' }, SLOW);
    expect(screen.queryByRole('link', { name: 'Chiến dịch moi' })).toBeNull();
  });

  it('chưa biết loại khách: chỉ chiến dịch cho mọi người', async () => {
    mocks.fetchHome.mockResolvedValue([camp('chung'), camp('moi', { audience: 'NEW' }), camp('cu', { audience: 'RETURNING' })]);
    renderBanner('unknown');
    await screen.findByRole('link', { name: 'Chiến dịch chung' }, SLOW);
    expect(screen.queryByRole('link', { name: 'Chiến dịch moi' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Chiến dịch cu' })).toBeNull();
  });

  it('chiến dịch đã quá hạn (cache cũ) bị ẩn theo giờ máy chủ', async () => {
    mocks.fetchHome.mockResolvedValue([camp('het', { endAt: new Date(Date.now() - 1000).toISOString() })]);
    const { container } = renderBanner();
    await waitFor(() => expect(mocks.fetchHome).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('API lỗi: rỗng, không ném, không ghi gợi ý', async () => {
    mocks.fetchHome.mockRejectedValue(new Error('boom'));
    const { container } = renderBanner();
    await waitFor(() => expect(mocks.fetchHome).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(localStorage.getItem(BANNER_HINT_KEY)).toBeNull();
  });

  it('nhớ lần trước có banner: đang tải thì giữ khung đúng tỉ lệ, tải xong không có thì bỏ khung và ghi "0"', async () => {
    localStorage.setItem(BANNER_HINT_KEY, '1');
    let resolve: (v: CampaignBanner[]) => void = () => undefined;
    mocks.fetchHome.mockReturnValue(new Promise<CampaignBanner[]>((r) => (resolve = r)));
    renderBanner();
    const frame = screen.getByTestId('home-banner-loading');
    expect(frame.firstElementChild).toHaveStyle({ aspectRatio: 'var(--banner-ratio)' });
    resolve([]);
    await waitFor(() => expect(screen.queryByTestId('home-banner-loading')).toBeNull());
    expect(localStorage.getItem(BANNER_HINT_KEY)).toBe('0');
  });

  it('chưa nhớ gì: đang tải thì không giữ chỗ', () => {
    mocks.fetchHome.mockReturnValue(new Promise(() => undefined));
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('có slide và đã biết loại khách: ghi gợi ý "1" cho lần mở sau', async () => {
    mocks.fetchHome.mockResolvedValue([camp('a')]);
    renderBanner('new');
    await screen.findByRole('region', { name: 'Chương trình nổi bật' }, SLOW);
    await waitFor(() => expect(localStorage.getItem(BANNER_HINT_KEY)).toBe('1'));
  });

  it('chưa biết loại khách thì không ghi gợi ý: lát nữa khách mới có thể thấy thêm chiến dịch', async () => {
    mocks.fetchHome.mockResolvedValue([camp('moi', { audience: 'NEW' })]);
    const { container } = renderBanner('unknown');
    await waitFor(() => expect(mocks.fetchHome).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(localStorage.getItem(BANNER_HINT_KEY)).toBeNull();
  });
});

const bundleItem = (id: string): BundleItemDTO => ({
  productId: id, variationId: `v-${id}`, maxQty: 1, addonPrice: null, inStock: true,
  product: { id, slug: `sp-${id}`, brand: 'Tubu', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: 100_000, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${id}` },
});
const bundle = (id: string): BundleDTO => ({
  id, kind: 'BUNDLE_PCT', title: `Combo ${id}`, pct: 10, endAt: new Date(Date.now() + DAY).toISOString(), anchorProductId: null, items: [bundleItem(`${id}a`), bundleItem(`${id}b`)],
});
const views = (...ids: string[]) => ids.flatMap((id) => comboView(bundle(id), Date.now()) ?? []);

describe('Khối combo của Trang chủ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addAll.mockResolvedValue({});
  });

  function renderCombos(v: ReturnType<typeof views>) {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <HomeCombos views={v} />
      </QueryClientProvider>,
    );
  }

  it('không có combo: không vẽ gì, không giữ chỗ', () => {
    const { container } = renderCombos([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('hai combo: vùng "Combo tiết kiệm" với hai thẻ, mỗi thẻ có nút thêm cả combo', () => {
    renderCombos(views('c1', 'c2'));
    const region = screen.getByRole('region', { name: 'Combo tiết kiệm' });
    expect(within(region).getByText('Combo c1')).toBeInTheDocument();
    expect(within(region).getByText('Combo c2')).toBeInTheDocument();
    expect(within(region).getAllByRole('button', { name: /^Thêm cả combo/ })).toHaveLength(2);
  });

  it('"Thêm cả combo" gửi đúng các món của combo đó', async () => {
    renderCombos(views('c1', 'c2'));
    fireEvent.click(screen.getByRole('button', { name: /^Thêm cả combo Combo c2/ }));
    await waitFor(() => expect(mocks.addAll).toHaveBeenCalledWith([{ variationId: 'v-c2a', quantity: 1 }, { variationId: 'v-c2b', quantity: 1 }]));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
  });
});
