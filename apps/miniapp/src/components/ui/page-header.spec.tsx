import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ZMPRouter } from 'zmp-ui';
import { PageHeader } from './page-header';

// /cart là trang con (không phải tab gốc): chỗ mà nút Quay lại của vỏ app (back-button.tsx) hiện ra. Nếu PageHeader còn tự vẽ một nút
// nữa thì có hai nút cùng tên ngay cả khi chỉ render PageHeader, nên ca bên dưới đo được chuyện đó.
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useLocation: () => ({ pathname: '/cart', search: '', state: null }),
}));

// BackButton dùng useNavigate của zmp-ui (không phải react-router-dom thuần) — hook này throw nếu
// không có AnimationRouterContext, chỉ ZMPRouter (zmp-ui) mới cấp context đó. react-router-dom's
// MemoryRouter trần không đủ.
function renderWithRouter(ui: React.ReactElement) {
  return render(<ZMPRouter memoryRouter>{ui}</ZMPRouter>);
}

describe('PageHeader', () => {
  it('renders title as a real heading element (fixes A4-23 zero-heading gap)', () => {
    renderWithRouter(<PageHeader title="Giỏ hàng" />);
    expect(screen.getByRole('heading', { name: 'Giỏ hàng' })).toBeInTheDocument();
  });
  it('title is the page h1 (axe page-has-heading-one, C-114)', () => {
    renderWithRouter(<PageHeader title="Đơn hàng" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Đơn hàng' })).toBeInTheDocument();
  });
  it('renders subtitle and actions when given', () => {
    renderWithRouter(<PageHeader title="Đơn hàng" subtitle="12 đơn" actions={<span>Lọc</span>} />);
    expect(screen.getByText('12 đơn')).toBeInTheDocument();
    expect(screen.getByText('Lọc')).toBeInTheDocument();
  });
  it('không tự vẽ nút Quay lại: nút nổi duy nhất do vỏ app (app.tsx) dựng, vẽ thêm một nút trong trang thành hai nút cùng tên, cùng chỗ', () => {
    renderWithRouter(<PageHeader title="Giỏ hàng" />);
    expect(screen.queryByRole('button', { name: /quay lại/i })).not.toBeInTheDocument();
  });
  it('chừa 48px bên trái tiêu đề cho nút nổi của vỏ app; back=false thì không chừa', () => {
    const { rerender } = renderWithRouter(<PageHeader title="Giỏ hàng" />);
    const titleBox = () => screen.getByRole('heading', { name: 'Giỏ hàng' }).parentElement as HTMLElement;
    expect(titleBox().style.paddingLeft).toBe('48px');
    rerender(<ZMPRouter memoryRouter><PageHeader title="Giỏ hàng" back={false} /></ZMPRouter>);
    expect(titleBox().style.paddingLeft).toBe('0px');
  });
});
