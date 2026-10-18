import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ cfg: { isLoaded: true } as { isLoaded: boolean; loyalty?: Record<string, unknown> } }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));

import { PointsBoostStrip } from './points-boost-strip';

const LOYALTY = { earnPct: 2, vndPerPoint: 50, marketplaceEarnPct: 1, marketplaceClaimEnabled: true };

describe('PointsBoostStrip', () => {
  beforeEach(() => {
    mocks.cfg = { isLoaded: true, loyalty: { ...LOYALTY } };
  });

  it('cờ bật, đúng gấp đôi: tiêu đề "gấp đôi" và dòng phụ lấy số từ config', () => {
    render(<PointsBoostStrip placement="scan" />);
    expect(screen.getByText('Mua trong Mini App: tích gấp đôi')).toBeInTheDocument();
    expect(screen.getByText('Đơn sàn 1% · Mua trong Mini App từ 2%, nhân theo hạng')).toBeInTheDocument();
  });

  it('không đúng gấp đôi: "nhiều hơn", số không viết cứng', () => {
    mocks.cfg = { isLoaded: true, loyalty: { ...LOYALTY, earnPct: 2.5, marketplaceEarnPct: 1.2 } };
    render(<PointsBoostStrip placement="home" />);
    expect(screen.getByText('Mua trong Mini App tích nhiều hơn')).toBeInTheDocument();
    expect(screen.getByText('Đơn sàn 1,2% · Mua trong Mini App từ 2,5%, nhân theo hạng')).toBeInTheDocument();
  });

  it('cờ tắt ở trang chủ: chỉ dòng "Tích {e}%", không so với sàn', () => {
    mocks.cfg = { isLoaded: true, loyalty: { ...LOYALTY, marketplaceClaimEnabled: false } };
    render(<PointsBoostStrip placement="home" />);
    expect(screen.getByTestId('points-boost')).toHaveTextContent('Tích 2% tiền hàng thành Điểm Xanh khi mua trong Mini App');
    expect(screen.queryByText(/Đơn sàn/)).toBeNull();
  });

  it('trang Điểm Xanh: cờ bật thì có dải so sánh, cờ tắt thì không thêm dòng', () => {
    const { rerender, container } = render(<PointsBoostStrip placement="wallet" />);
    expect(screen.getByText('Mua trong Mini App: tích gấp đôi')).toBeInTheDocument();
    mocks.cfg = { isLoaded: true, loyalty: { ...LOYALTY, marketplaceClaimEnabled: false } };
    rerender(<PointsBoostStrip placement="wallet" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('omitPlain: cờ tắt ở trang chủ không nói lại mức tích; cờ bật vẫn so sánh', () => {
    mocks.cfg = { isLoaded: true, loyalty: { ...LOYALTY, marketplaceClaimEnabled: false } };
    const { container, rerender } = render(<PointsBoostStrip placement="home" omitPlain />);
    expect(container).toBeEmptyDOMElement();
    mocks.cfg = { isLoaded: true, loyalty: { ...LOYALTY } };
    rerender(<PointsBoostStrip placement="home" omitPlain />);
    expect(screen.getByText('Mua trong Mini App: tích gấp đôi')).toBeInTheDocument();
  });

  it('cờ tắt ở trang sản phẩm: không thêm dòng (đã có dòng Nhận Điểm Xanh dưới giá)', () => {
    mocks.cfg = { isLoaded: true, loyalty: { ...LOYALTY, marketplaceClaimEnabled: false } };
    const { container } = render(<PointsBoostStrip placement="product" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('config chưa về hoặc thiếu mức đơn app: không vẽ gì', () => {
    mocks.cfg = { isLoaded: false, loyalty: { ...LOYALTY } };
    const { container, rerender } = render(<PointsBoostStrip placement="home" />);
    expect(container).toBeEmptyDOMElement();
    mocks.cfg = { isLoaded: true };
    rerender(<PointsBoostStrip placement="home" />);
    expect(container).toBeEmptyDOMElement();
  });
});
