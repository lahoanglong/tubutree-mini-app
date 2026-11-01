// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { headingProblems } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, push: vi.fn() }) }));

import CampaignNotFound from './not-found';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  mocks.replace.mockReset();
});

// Cùng chữ và nút với màn "Chương trình đã kết thúc" của pages/campaign.tsx ở Mini App.
describe('/chien-dich/[slug] — chương trình không còn', () => {
  it('báo "Chương trình đã kết thúc" kèm lời cảm ơn, nút "Về trang chủ" đưa về /', () => {
    const r = render(<CampaignNotFound />);
    mounted.push(r);
    expect(r.container.textContent).toContain('Chương trình đã kết thúc');
    expect(r.container.textContent).toContain('Cảm ơn bạn đã ghé. Xem các ưu đãi đang có nhé.');
    expect(byText(r.container, 'button', 'Thử lại')).toBeNull();
    click(byText(r.container, 'button', 'Về trang chủ'));
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });

  it('tiêu đề "Chương trình" nằm trong thanh PageHeader như Mini App, không ẩn', () => {
    const r = render(<CampaignNotFound />);
    mounted.push(r);
    expect(r.container.querySelector('header[data-page-bleed] h1')?.textContent).toBe('Chương trình');
  });

  it('có đúng một h1', () => {
    const r = render(<CampaignNotFound />);
    mounted.push(r);
    expect(headingProblems(r.container)).toEqual([]);
  });
});
