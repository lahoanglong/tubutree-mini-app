import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ZmpUi from 'zmp-ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchBrands: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/shop-api', () => ({ fetchBrands: mocks.fetchBrands }));

import { BRAND_ORIGINS, brandBrowseTarget } from '@tubutree/app-core/brand-origins';
import { BrandJourney } from './brand-journey';

const SHELL = { brand: 'Tubu Tree', count: 111, slug: null };

function renderJourney() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BrandJourney />
    </QueryClientProvider>,
  );
}
const chip = (name: string) => screen.findByRole('button', { name });

beforeEach(() => vi.clearAllMocks());

describe('BrandJourney: dải thương hiệu dùng 8 nhãn hành trình như web (journeyBrands)', () => {
  it('API chỉ trả nhãn vỏ "Tubu Tree": vẫn đủ 8 chip hành trình, câu mô tả nói 8 thương hiệu, không có chip "Tubu Tree" hay "1 thương hiệu"', async () => {
    mocks.fetchBrands.mockResolvedValue([SHELL]);
    renderJourney();
    await chip(BRAND_ORIGINS[0]!.brand);
    for (const o of BRAND_ORIGINS) expect(screen.getByRole('button', { name: o.brand })).toBeTruthy();
    expect(BRAND_ORIGINS).toHaveLength(8);
    expect(screen.queryByRole('button', { name: 'Tubu Tree' })).toBeNull();
    expect(screen.getAllByText('8 thương hiệu Việt, từ nhiều vùng đất').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^1 thương hiệu/)).toBeNull();
  });

  it('chạm chip nhãn hành trình chưa có trang riêng: mở /browse tìm theo từ khoá của nhãn (cột brand của PROD đều là "Tubu Tree" nên không lọc ?brand=)', async () => {
    mocks.fetchBrands.mockResolvedValue([SHELL]);
    renderJourney();
    fireEvent.click(await chip(BRAND_ORIGINS[0]!.brand));
    expect(mocks.navigate).toHaveBeenCalledWith(brandBrowseTarget(BRAND_ORIGINS[0]!, '/browse'));
  });

  it('nhãn API khớp một nhãn hành trình và có slug: chip đi trang nhãn /brand/<slug>, các nhãn còn lại giữ đích tìm kiếm', async () => {
    mocks.fetchBrands.mockResolvedValue([SHELL, { brand: BRAND_ORIGINS[1]!.brand, count: 3, slug: 'nhan-hai' }]);
    renderJourney();
    // 8 chip hành trình có ngay từ lúc chưa tải; chip chỉ đổi đích sang trang nhãn khi danh sách API về, nên bấm lại tới khi đích đổi.
    const second = await chip(BRAND_ORIGINS[1]!.brand);
    await waitFor(() => {
      fireEvent.click(second);
      expect(mocks.navigate).toHaveBeenCalledWith('/brand/nhan-hai');
    });
    fireEvent.click(screen.getByRole('button', { name: BRAND_ORIGINS[0]!.brand }));
    expect(mocks.navigate).toHaveBeenLastCalledWith(brandBrowseTarget(BRAND_ORIGINS[0]!, '/browse'));
  });

  it('nhãn API lạ không thuộc 8 nhãn: nối phía sau và lọc ?brand= đúng tên catalog; lỗi tải danh sách thì vẫn đủ 8 chip', async () => {
    mocks.fetchBrands.mockResolvedValueOnce([SHELL, { brand: 'Nhãn Mới', count: 2, slug: null }]);
    const first = renderJourney();
    fireEvent.click(await chip('Nhãn Mới'));
    expect(mocks.navigate).toHaveBeenCalledWith(`/browse?${new URLSearchParams({ brand: 'Nhãn Mới' })}`);
    first.unmount();

    mocks.fetchBrands.mockRejectedValue(new Error('boom'));
    renderJourney();
    for (const o of BRAND_ORIGINS) expect(await chip(o.brand)).toBeTruthy();
  });
});
