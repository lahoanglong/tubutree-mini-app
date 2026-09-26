import { BadRequestException } from '@nestjs/common';
import { REDACTED, isSecretKey, redactConfigRows, redactSecrets, restoreRedactedSecrets } from './config-redaction';

/**
 * GET /admin/config trả NGUYÊN VĂN value của SystemConfig. Bản WIP Gomdon từng lưu mật khẩu tài khoản
 * Gomdon trong `shipping.gomdon.config.password` (loadGomdonConfig vẫn đọc fallback này) — mọi admin mở
 * tab Cấu hình, hoặc bất kỳ ai có token admin, đều đọc được mật khẩu. Che mọi khoá khớp
 * /password|secret|token/i, đệ quy trong JSON.
 */
describe('redactSecrets — che khoá bí mật trong JSON (đệ quy)', () => {
  it('che password lồng trong object, giữ nguyên field khác', () => {
    const out = redactSecrets({
      phone: '0900000000',
      password: 'hunter2',
      defaultWarehouse: { name: 'Kho HCM', apiToken: 'tok-123' },
      defaultWeightFallback: 500,
    });
    expect(out).toEqual({
      phone: '0900000000',
      password: REDACTED,
      defaultWarehouse: { name: 'Kho HCM', apiToken: REDACTED },
      defaultWeightFallback: 500,
    });
  });

  it('không phân biệt hoa thường, bắt cả secret/token trong tên dài', () => {
    const out = redactSecrets({ WEBHOOK_SECRET: 'abc', AccessToken: 'x', refresh_token_ttl: 30, clientSecretKey: { a: 1 } });
    expect(out).toEqual({ WEBHOOK_SECRET: REDACTED, AccessToken: REDACTED, refresh_token_ttl: REDACTED, clientSecretKey: REDACTED });
  });

  it('đi vào mảng', () => {
    expect(redactSecrets([{ token: 't1' }, { name: 'ok' }])).toEqual([{ token: REDACTED }, { name: 'ok' }]);
  });

  it('bí mật rỗng/null giữ nguyên (admin cần thấy là CHƯA đặt, không lộ gì)', () => {
    expect(redactSecrets({ password: '', token: null })).toEqual({ password: '', token: null });
  });

  it('không làm thay đổi object gốc (cache SystemConfigService dùng chung tham chiếu)', () => {
    const src = { password: 'p', nested: { secret: 's' } };
    redactSecrets(src);
    expect(src).toEqual({ password: 'p', nested: { secret: 's' } });
  });

  it('giá trị nguyên thuỷ không có khoá → giữ nguyên', () => {
    expect(redactSecrets(5)).toBe(5);
    expect(redactSecrets('abc')).toBe('abc');
    expect(redactSecrets(true)).toBe(true);
  });
});

describe('redactConfigRows — áp cho danh sách dòng SystemConfig và dạng theo category', () => {
  it('dòng có KEY bí mật (vd zalo.oa_access_token) → che cả value', () => {
    const rows = redactConfigRows([
      { key: 'zalo.oa_access_token', value: 'abc', category: 'zalo', description: null },
      { key: 'shipping.gomdon.config', value: { password: 'p', defaultWeightFallback: 500 }, category: 'shipping', description: null },
      { key: 'shipping.free_threshold', value: 200000, category: 'shipping', description: null },
    ]);
    expect(rows[0]!.value).toBe(REDACTED);
    expect(rows[1]!.value).toEqual({ password: REDACTED, defaultWeightFallback: 500 });
    expect(rows[2]!.value).toBe(200000);
  });

  it('dạng Record<key, value> (getByCategory) cũng được che', () => {
    const out = redactConfigRows({ 'shipping.gomdon.config': { password: 'p' }, 'x.secret': 'zz', 'x.ok': 1 });
    expect(out).toEqual({ 'shipping.gomdon.config': { password: REDACTED }, 'x.secret': REDACTED, 'x.ok': 1 });
  });

  it('isSecretKey khớp password/secret/token, không khớp khoá thường', () => {
    expect(isSecretKey('password')).toBe(true);
    expect(isSecretKey('GOMDON_WEBHOOK_SECRET')).toBe(true);
    expect(isSecretKey('accessToken')).toBe(true);
    expect(isSecretKey('defaultWarehouse')).toBe(false);
  });
});

/**
 * GET đã che thì form sửa JSON thô (ConfigItem) sẽ gửi lại chuỗi che khi admin bấm Lưu — không khôi
 * phục thì mật khẩu thật bị ghi đè thành "••••••" và tích hợp chết lặng lẽ.
 */
describe('restoreRedactedSecrets — lưu lại không được ghi đè bí mật bằng chuỗi che', () => {
  it('trả lại giá trị thật ở đúng vị trí đang là chuỗi che', () => {
    const existing = { password: 'real', defaultWarehouse: { name: 'A', apiToken: 'tok' }, defaultWeightFallback: 500 };
    const incoming = { password: REDACTED, defaultWarehouse: { name: 'B', apiToken: REDACTED }, defaultWeightFallback: 800 };
    expect(restoreRedactedSecrets('shipping.gomdon.config', incoming, existing)).toEqual({
      password: 'real',
      defaultWarehouse: { name: 'B', apiToken: 'tok' },
      defaultWeightFallback: 800,
    });
  });

  it('admin nhập bí mật MỚI (không phải chuỗi che) → dùng giá trị mới', () => {
    expect(restoreRedactedSecrets('k', { password: 'new' }, { password: 'old' })).toEqual({ password: 'new' });
  });

  it('khoá top-level bí mật gửi lại chuỗi che → giữ giá trị cũ', () => {
    expect(restoreRedactedSecrets('zalo.oa_access_token', REDACTED, 'abc')).toBe('abc');
  });

  it('chuỗi che mà KHÔNG có giá trị cũ để khôi phục → 400 (không lưu chuỗi che làm bí mật)', () => {
    expect(() => restoreRedactedSecrets('k', { password: REDACTED }, {})).toThrow(BadRequestException);
    expect(() => restoreRedactedSecrets('k', { password: REDACTED }, undefined)).toThrow(BadRequestException);
  });

  it('không có chuỗi che nào → giữ nguyên input', () => {
    const v = { a: 1, b: [1, 2] };
    expect(restoreRedactedSecrets('k', v, { a: 0 })).toEqual(v);
  });
});
