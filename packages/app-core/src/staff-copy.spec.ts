import { describe, expect, it } from 'vitest';
import { grantDoneText, grantPermissionsHint } from './staff-copy';

describe('grantDoneText', () => {
  it('vai trò vừa đổi: áp ngay', () => {
    expect(grantDoneText({ applied: true }, '0911111111', ['Kho'])).toBe('Đã cấp quyền & áp ngay.');
  });

  it('vai trò không đổi nhưng nhóm việc đã đổi ngay: nêu SĐT và nhóm mới, không hứa "sẽ áp khi mở app"', () => {
    const text = grantDoneText({ applied: false, permissionsChanged: true }, '0911111111', ['Chăm sóc khách', 'Kho']);
    expect(text).toBe('Đã đổi nhóm việc của 0911111111 thành Chăm sóc khách, Kho.');
    expect(text).not.toContain('mở app');
  });

  it('chưa có tài khoản (hoặc máy chủ cũ không trả cờ): lời mời chờ họ mở app', () => {
    expect(grantDoneText({ applied: false, permissionsChanged: false }, '0911111111', [])).toBe('Đã lưu quyền (sẽ áp khi họ mở app).');
    expect(grantDoneText({ applied: false }, '0911111111', [])).toBe('Đã lưu quyền (sẽ áp khi họ mở app).');
  });
});

describe('grantPermissionsHint', () => {
  it('người chưa là nhân viên: nhắc chọn trống chỉ dùng quầy, Đổi rác, chấm công', () => {
    expect(grantPermissionsHint(null)).toBe('Không chọn nhóm nào: chỉ dùng quầy thu ngân, Đổi rác và chấm công.');
  });

  it('người đã là nhân viên: nêu nhóm đang có, nói lưu sẽ thay và để trống thì giữ nguyên', () => {
    const text = grantPermissionsHint(['Kho', 'Kế toán']);
    expect(text).toContain('Nhóm đang có: Kho, Kế toán');
    expect(text).toContain('thay bằng nhóm bạn chọn');
    expect(text).toContain('giữ nguyên nhóm đang có');
    expect(text).not.toContain('chỉ dùng quầy');
  });

  it('nhân viên chưa có nhóm nào', () => {
    expect(grantPermissionsHint([])).toContain('Nhóm đang có: chưa có nhóm nào');
  });
});
