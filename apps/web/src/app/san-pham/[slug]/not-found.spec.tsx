// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { headingProblems } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, push: vi.fn() }) }));
vi.mock('@/components/catalog/suggested-rail', () => ({ SuggestedRail: () => <section data-testid="suggested-rail" /> }));

import ProductNotFound from './not-found';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  mocks.replace.mockReset();
});

describe('/san-pham/[slug] — sản phẩm không có', () => {
  it('cùng chữ với Mini App: "Không tìm thấy sản phẩm này.", nút Về trang chủ, không có Thử lại, có kệ gợi ý', () => {
    const r = render(<ProductNotFound />);
    mounted.push(r);
    expect(r.container.textContent).toContain('Không tìm thấy');
    expect(r.container.textContent).toContain('Không tìm thấy sản phẩm này.');
    expect(byText(r.container, 'button', 'Thử lại')).toBeNull();
    expect(r.container.querySelector('[data-testid="suggested-rail"]')).not.toBeNull();
    click(byText(r.container, 'button', 'Về trang chủ'));
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });

  it('có đúng một h1', () => {
    const r = render(<ProductNotFound />);
    mounted.push(r);
    expect(headingProblems(r.container)).toEqual([]);
  });
});
