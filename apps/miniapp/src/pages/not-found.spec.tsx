import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => navigate,
}));

import NotFoundPage from './not-found';

describe('NotFoundPage — tiêu đề không đè lên hình minh hoạ (C-119)', () => {
  beforeEach(() => navigate.mockClear());

  it('hình minh hoạ là SVG có chiều cao cố định đứng riêng, không phải chữ emoji cỡ lớn trong dòng chữ', () => {
    const { container } = render(<NotFoundPage />);
    expect(container.querySelector('svg[aria-hidden]')).not.toBeNull();
    // Emoji 72px trong Text có line-height ~20px tràn xuống dòng tiêu đề kế bên.
    const oversizedText = Array.from(container.querySelectorAll<HTMLElement>('[style]')).filter(
      (el) => parseInt(el.style.fontSize || '0', 10) >= 48,
    );
    expect(oversizedText).toHaveLength(0);
  });

  it('trang có đúng một h1 cho trình đọc màn hình (C-114)', () => {
    render(<NotFoundPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Không tìm thấy trang');
  });

  it('có tiêu đề, lời giải thích và nút về trang chủ (thay thế lịch sử)', () => {
    render(<NotFoundPage />);
    expect(screen.getByText('Trang này lạc vào vườn rồi')).toBeInTheDocument();
    expect(screen.getByText(/liên kết đã cũ hoặc trang không tồn tại/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Về trang chủ' }));
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });
});
