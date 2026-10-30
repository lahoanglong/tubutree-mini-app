// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { headingProblems } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, push: vi.fn() }) }));

import BrandNotFound from './not-found';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  mocks.replace.mockReset();
});

// Cùng chữ và nút với màn 404 của `brand-view.tsx` ở Mini App.
describe('/brand/[slug] — nhãn không có', () => {
  it('báo "Không tìm thấy nhãn hàng", nói nhãn chưa công khai hoặc liên kết cũ, nút Xem Danh mục sang /san-pham', () => {
    const r = render(<BrandNotFound />);
    mounted.push(r);
    expect(r.container.textContent).toContain('Không tìm thấy nhãn hàng');
    expect(r.container.textContent).toContain('Nhãn này chưa được công khai hoặc liên kết đã cũ. Xem các nhãn khác trong Danh mục nhé.');
    expect(byText(r.container, 'button', 'Thử lại')).toBeNull();
    click(byText(r.container, 'button', 'Xem Danh mục'));
    expect(mocks.replace).toHaveBeenCalledWith('/san-pham');
  });

  it('có đúng một h1', () => {
    const r = render(<BrandNotFound />);
    mounted.push(r);
    expect(headingProblems(r.container)).toEqual([]);
  });
});
