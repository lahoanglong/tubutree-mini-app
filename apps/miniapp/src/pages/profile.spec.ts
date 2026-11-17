import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// Dòng menu Cá nhân (nhãn, thứ tự, đích, theo vai trò/cờ) có spec ở packages/app-core/src/profile-menu.spec.ts; web dựng từ cùng hàm.
describe('Cá nhân dựng dòng từ app-core', () => {
  it('pages/profile.tsx lấy dòng và hàng đơn từ profile-menu, không tự khai danh sách mục', () => {
    const src = readFileSync(join(process.cwd(), 'src/pages/profile.tsx'), 'utf8');
    expect(src).toMatch(/buildProfileMenu\(/);
    expect(src).toMatch(/PROFILE_ORDER_ROW\.map/);
    expect(src).not.toMatch(/export const MENU/);
    expect(src).not.toMatch(/CASHBACK_ENABLED|SUBSCRIPTIONS_IN_MINIAPP|'\/notifications'/);
  });
});

describe('lối vào Đổi rác không thêm lệnh gọi mạng (§16.1)', () => {
  const SRC = join(process.cwd(), 'src');
  it.each(['pages/home.tsx', 'pages/game.tsx'])('%s không gọi waste-api', (f) => {
    expect(readFileSync(join(SRC, f), 'utf8')).not.toMatch(/waste-api|useWasteMe/);
  });
  // Ngoại lệ duy nhất: hàng "Nhận hàng tại điểm" cho nhân viên, admin, đại lý. Khách thường không bị hỏi, và không gọi /waste/me.
  it('pages/profile.tsx chỉ hỏi điểm nhận hàng, và chỉ với vai có thể có điểm', () => {
    const src = readFileSync(join(SRC, 'pages/profile.tsx'), 'utf8');
    expect(src).not.toMatch(/getWasteMe|useWasteMe/);
    expect(src).toMatch(/enabled: authed && mayHaveDesk/);
    expect(src).toMatch(/const mayHaveDesk = isStaffOrAdmin \|\| \(user\?\.role === 'DEALER' && cfg\.waste\.enabled\)/);
  });
  it('pages/loyalty.tsx không còn lối Đổi rác (lối vào ở Cá nhân và Ưu đãi) nên không gọi API đổi rác nào', () => {
    const src = readFileSync(join(SRC, 'pages/loyalty.tsx'), 'utf8');
    expect(src).not.toMatch(/getWasteMe|useWasteMe|listWasteRequests|waste-api/);
  });
});
