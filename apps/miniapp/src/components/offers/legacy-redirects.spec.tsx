import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LegacyRewardsRedirect, LegacyVouchersRedirect } from './legacy-redirects';

function Landed() {
  const location = useLocation();
  return <output data-type={useNavigationType()}>{`${location.pathname}${location.search}`}</output>;
}

function open(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/vouchers" element={<LegacyVouchersRedirect />} />
        <Route path="/rewards" element={<LegacyRewardsRedirect />} />
        <Route path="/offers" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByRole('status');
}

describe('đường cũ Mã giảm giá / Kho quà chuyển vào hub Ưu đãi', () => {
  it.each([
    ['/vouchers', '/offers?tab=deals&codes=all'],
    ['/vouchers?code=X', '/offers?tab=deals&codes=all&code=X'],
    ['/vouchers?tab=claim&utm_source=zns', '/offers?tab=deals&codes=all&utm_source=zns'],
    ['/vouchers?tab=mine', '/offers?tab=wallet'],
    ['/vouchers?tab=history&code=X', '/offers?tab=wallet&history=1&code=X'],
    ['/vouchers?tab=la', '/offers?tab=deals&codes=all'],
    ['/rewards', '/offers?tab=rewards'],
    ['/rewards?utm_source=zns', '/offers?tab=rewards&utm_source=zns'],
  ])('%s → %s, thay mục lịch sử (Back không quay về đường cũ)', (from, to) => {
    const landed = open(from);
    expect(landed).toHaveTextContent(to);
    expect(landed).toHaveAttribute('data-type', 'REPLACE');
  });

  it('app.tsx giữ hai đường cũ trong bộ định tuyến dưới dạng chuyển hướng, không còn nạp trang riêng; /rewards/mine vẫn là trang', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'components', 'app.tsx'), 'utf8');
    expect(src).toContain('<Route path="/vouchers" element={<LegacyVouchersRedirect />} />');
    expect(src).toContain('<Route path="/rewards" element={<LegacyRewardsRedirect />} />');
    expect(src).not.toContain("import('../pages/vouchers')");
    expect(src).not.toMatch(/import\('\.\.\/pages\/rewards'\)/);
    expect(src).toContain("const RewardsMinePage = lazy(() => import('../pages/rewards-mine'));");
  });

  it('Hoàn tiền sàn ngoài tắt cờ: /cashback về Cá nhân, và chỉ nạp trang khi cờ bật (bản build không có chunk hoàn tiền)', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'components', 'app.tsx'), 'utf8');
    expect(src).toContain("const CashbackPage: ComponentType = CASHBACK_ENABLED ? lazy(() => import('../pages/cashback')) : () => null;");
    expect(src).toContain('<Route path="/cashback" element={CASHBACK_ENABLED ? <RouteShell><CashbackPage /></RouteShell> : <Navigate to="/profile" replace />} />');
  });
});
