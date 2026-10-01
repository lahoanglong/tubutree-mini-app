import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { RECENTLY_VIEWED_MAX, recordRecentlyViewed } from '../../utils/recently-viewed';
import { RecentlyViewedRail } from './recently-viewed-rail';

describe('RecentlyViewedRail (spec 5b.4)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('chưa xem gì → không render (ẩn im lặng, spec §9)', () => {
    const { container } = render(<RecentlyViewedRail />);
    expect(container).toBeEmptyDOMElement();
  });

  it('mới xem nhất đứng đầu; chạm → PDP với listSource=recently_viewed', () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null, price: 45000 }, 1);
    recordRecentlyViewed({ slug: 'b', name: 'Sản phẩm B', thumbnail: null, price: 65000 }, 2);
    render(<RecentlyViewedRail />);
    const region = screen.getByRole('region', { name: 'Đã xem gần đây' });
    expect(Array.from(region.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual(['Sản phẩm B', 'Sản phẩm A']);
    expect(region).toHaveTextContent('65.000');
    fireEvent.click(screen.getByRole('button', { name: 'Sản phẩm A' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/a', { state: { listSource: 'recently_viewed' } });
  });

  it('cập nhật ngay khi có lượt xem mới (cùng tab)', () => {
    const { container } = render(<RecentlyViewedRail />);
    expect(container).toBeEmptyDOMElement();
    act(() => {
      recordRecentlyViewed({ slug: 'c', name: 'Sản phẩm C', thumbnail: null, price: 1000 });
    });
    expect(screen.getByRole('button', { name: 'Sản phẩm C' })).toBeInTheDocument();
  });

  it('tên truy cập là tên sản phẩm, giá được đọc qua mô tả; ảnh chỉ để trang trí (alt rỗng)', () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: 'https://img.test/a.jpg', price: 45000 });
    render(<RecentlyViewedRail />);
    const card = screen.getByRole('button', { name: 'Sản phẩm A' });
    expect(card).toHaveAccessibleDescription(/45\.000/);
    const img = card.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('src', 'https://img.test/a.jpg');
  });

  it('sản phẩm không có ảnh vẫn hiện thẻ (khung ảnh trống, không có thẻ img)', () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null, price: 45000 });
    render(<RecentlyViewedRail />);
    expect(screen.getByRole('button', { name: 'Sản phẩm A' }).querySelector('img')).toBeNull();
  });

  it('hiện tối đa 20 thẻ (giới hạn của kho lưu)', () => {
    for (let i = 0; i < RECENTLY_VIEWED_MAX + 5; i += 1) {
      recordRecentlyViewed({ slug: `p${i}`, name: `SP ${i}`, thumbnail: null, price: 1000 + i }, i);
    }
    render(<RecentlyViewedRail />);
    const region = screen.getByRole('region', { name: 'Đã xem gần đây' });
    expect(region.querySelectorAll('button')).toHaveLength(RECENTLY_VIEWED_MAX);
    expect(screen.getByRole('button', { name: `SP ${RECENTLY_VIEWED_MAX + 4}` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SP 0' })).toBeNull();
  });

  it('title tuỳ biến đổi cả tên vùng lẫn tiêu đề', () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null, price: 45000 });
    render(<RecentlyViewedRail title="Xem lại" />);
    expect(screen.getByRole('region', { name: 'Xem lại' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Xem lại' })).toBeInTheDocument();
  });
});
