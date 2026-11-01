import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  config: {} as Record<string, unknown>,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Sheet: ({ visible, title, children }: { visible: boolean; title?: string; children: ReactNode }) =>
    visible ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.config }));

import { PointsEarnLine } from './points-earn-line';

const LOYALTY = {
  earnPct: 2,
  vndPerPoint: 50,
  vndPerPointRedeem: 100,
  tierMultipliers: { t1: 1, t2: 1.2 },
  tierNames: { t1: 'Mầm Xanh', t2: 'Lộc Biếc' },
};

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.config = { isLoaded: true, loyalty: { ...LOYALTY, marketplaceClaimEnabled: false } };
});

const openPopup = () => {
  fireEvent.click(screen.getByRole('button', { name: /Xem cách tính Điểm Xanh/ }));
  return screen.getByRole('dialog', { name: 'Cách tính Điểm Xanh' });
};

describe('PointsEarnLine — bấm mở popup Cách tính Điểm Xanh', () => {
  it('dòng là nút có nhãn đọc màn hình và vùng bấm đủ lớn; chữ dòng không đổi', () => {
    render(<PointsEarnLine goods={289000} authStatus="authenticated" tierId="t2" />);
    const btn = screen.getByRole('button', { name: /Xem cách tính Điểm Xanh/ });
    expect(btn).toHaveTextContent('Nhận ~6.936 Điểm Xanh');
    expect(parseInt(btn.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('có hạng: popup nói hạng và hệ số theo tierId', () => {
    render(<PointsEarnLine goods={289000} authStatus="authenticated" tierId="t2" />);
    expect(within(openPopup()).getByText('Hạng Lộc Biếc: ×1,2')).toBeInTheDocument();
  });

  it('khách vãng lai: ×1 và mời đăng nhập', () => {
    render(<PointsEarnLine goods={289000} authStatus="unauthenticated" tierId={undefined} />);
    expect(within(openPopup()).getByText(/hệ số ×1\. Đăng nhập/)).toBeInTheDocument();
  });

  it('giải thích dấu "~" và điểm vào khi giao thành công', () => {
    render(<PointsEarnLine goods={289000} authStatus="authenticated" tierId="t1" />);
    const dlg = openPopup();
    expect(within(dlg).getByText(/giảm giá, mã giảm giá và điểm dùng lúc thanh toán/)).toBeInTheDocument();
    expect(within(dlg).getByText('Nhận Điểm Xanh khi đơn giao thành công')).toBeInTheDocument();
  });

  it('cờ đơn sàn tắt: không có mục đơn sàn', () => {
    render(<PointsEarnLine goods={289000} authStatus="authenticated" tierId="t1" />);
    const dlg = openPopup();
    expect(within(dlg).queryByText(/Đơn sàn/)).toBeNull();
    expect(within(dlg).queryByRole('button', { name: /đơn sàn/i })).toBeNull();
  });

  it('cờ đơn sàn bật: nguyên câu đơn sàn và đường tới trang gửi đơn sàn', () => {
    mocks.config = { isLoaded: true, loyalty: { ...LOYALTY, marketplaceClaimEnabled: true, marketplaceEarnPct: 1 } };
    render(<PointsEarnLine goods={289000} authStatus="authenticated" tierId="t1" />);
    const dlg = openPopup();
    expect(within(dlg).getByText('Đơn sàn 1% · Mua trong Mini App từ 2%, nhân theo hạng')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Gửi đơn sàn để tích điểm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/points/scan');
  });

  it('liên kết tới trang Điểm Xanh', () => {
    render(<PointsEarnLine goods={289000} authStatus="authenticated" tierId="t1" />);
    fireEvent.click(within(openPopup()).getByRole('button', { name: 'Xem các hạng Điểm Xanh' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/loyalty');
  });

  it('đóng được bằng nút Đóng', () => {
    render(<PointsEarnLine goods={289000} authStatus="authenticated" tierId="t1" />);
    openPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
