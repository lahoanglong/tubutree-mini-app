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

  it('đã là nhân viên mà nhóm không đổi (để trống hoặc chọn đúng nhóm đang có): nói nhóm giữ nguyên, không hứa "sẽ áp khi mở app"', () => {
    const text = grantDoneText({ applied: false, permissionsChanged: false }, '0911111111', [], true);
    expect(text).toBe('0911111111 đã là nhân viên, nhóm việc giữ nguyên.');
    expect(grantDoneText({ applied: false }, '0911111111', ['Kho'], true)).toBe(text);
  });

  it('đã là nhân viên nhưng nhóm đổi ngay: vẫn báo nhóm mới', () => {
    expect(grantDoneText({ applied: false, permissionsChanged: true }, '0911111111', ['Kho'], true)).toBe('Đã đổi nhóm việc của 0911111111 thành Kho.');
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

  it('SĐT trùng lời mời đang chờ có nhóm: nêu nhóm của lời mời, nói lưu sẽ thay và để trống thì giữ nhóm của lời mời', () => {
    const text = grantPermissionsHint(null, ['Kho', 'Kế toán']);
    expect(text).toContain('Lời mời đang chờ với nhóm: Kho, Kế toán');
    expect(text).toContain('thay bằng nhóm bạn chọn');
    expect(text).toContain('giữ nguyên nhóm của lời mời');
    expect(text).not.toContain('chỉ dùng quầy');
  });

  it('lời mời đang chờ không ghi nhóm nào: vẫn là gợi ý chung', () => {
    expect(grantPermissionsHint(null, [])).toBe(grantPermissionsHint(null));
    expect(grantPermissionsHint(null, null)).toBe(grantPermissionsHint(null));
  });

  it('đã là nhân viên thì ưu tiên nhóm đang có, không nói lời mời', () => {
    expect(grantPermissionsHint(['Kho'], ['Kế toán'])).toContain('Nhóm đang có: Kho');
    expect(grantPermissionsHint(['Kho'], ['Kế toán'])).not.toContain('Lời mời');
  });
});
