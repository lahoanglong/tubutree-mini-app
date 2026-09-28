import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ZMPRouter } from 'zmp-ui';
import { PageHeader } from './page-header';

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
  it('renders subtitle and actions when given', () => {
    renderWithRouter(<PageHeader title="Đơn hàng" subtitle="12 đơn" actions={<span>Lọc</span>} />);
    expect(screen.getByText('12 đơn')).toBeInTheDocument();
    expect(screen.getByText('Lọc')).toBeInTheDocument();
  });
  it('back=false omits the back button', () => {
    renderWithRouter(<PageHeader title="x" back={false} />);
    expect(screen.queryByRole('button', { name: /quay lại/i })).not.toBeInTheDocument();
  });
});
