import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ZmpUi from 'zmp-ui';
import type { CampaignBanner as Banner } from '@tubutree/app-core/api/campaign';
import type { HomeKindState } from '@tubutree/app-core/home-layout';
import type { CampaignPlacement } from '@tubutree/app-core/api/campaign';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('../../services/campaign-api', () => ({ fetchHomeCampaigns: vi.fn() }));

import { CampaignBanner } from './campaign-banner';

const DAY = 86_400_000;
const camp = (id: string, over: Partial<Banner> = {}): Banner => ({
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

function renderBanner(placement: CampaignPlacement, kind: HomeKindState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CampaignBanner placement={placement} kind={kind} />
    </QueryClientProvider>,
  );
}

describe('CampaignBanner — banner đầu trang Ưu đãi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hỏi đúng vị trí OFFERS_TOP', async () => {
    mocks.get.mockResolvedValue([]);
    renderBanner('OFFERS_TOP', 'new');
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/campaigns', expect.objectContaining({ query: { placement: 'OFFERS_TOP' } })));
  });

  it('không có chiến dịch: không vẽ gì, không giữ chỗ', async () => {
    mocks.get.mockResolvedValue([]);
    const { container } = renderBanner('OFFERS_TOP', 'new');
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('chiến dịch cho mọi người hiện, chiến dịch cho khách mới ẩn khi chưa biết loại khách', async () => {
    mocks.get.mockResolvedValue([camp('chung'), camp('moi', { audience: 'NEW' })]);
    renderBanner('OFFERS_TOP', 'unknown');
    expect(await screen.findByRole('link', { name: 'Chiến dịch chung' })).toHaveAttribute('href', '/campaign/chung');
    expect(screen.queryByRole('link', { name: 'Chiến dịch moi' })).toBeNull();
  });

  it('khách mới thấy cả chiến dịch dành cho khách mới', async () => {
    mocks.get.mockResolvedValue([camp('moi', { audience: 'NEW' })]);
    renderBanner('OFFERS_TOP', 'new');
    expect(await screen.findByRole('link', { name: 'Chiến dịch moi' })).toBeInTheDocument();
  });

  it('API lỗi: rỗng và không ném', async () => {
    mocks.get.mockRejectedValue(new Error('boom'));
    const { container } = renderBanner('OFFERS_TOP', 'new');
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
