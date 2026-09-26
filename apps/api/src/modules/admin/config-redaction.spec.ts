import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { REDACTED, isSecretKey, redactConfigRows, redactSecrets, restoreRedactedSecrets } from './config-redaction';

/**
 * GET /admin/config trả NGUYÊN VĂN value của SystemConfig. Bản WIP Gomdon từng lưu mật khẩu tài khoản
 * Gomdon trong `shipping.gomdon.config.password` (loadGomdonConfig vẫn đọc fallback này) — mọi admin mở
 * tab Cấu hình, hoặc bất kỳ ai có token admin, đều đọc được mật khẩu. Che mọi khoá khớp SECRET_KEY_RE
 * (password/pass/pwd/secret/token/api key/private key/credential/key/hmac/signature), đệ quy trong JSON.
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

  it('isSecretKey bắt thêm pass/pwd/api key/private key/credential/key/hmac/signature (không phân biệt hoa thường)', () => {
    for (const k of [
      'pass',
      'db_pass',
      'smtp.pass',
      'PASS',
      'adminPassword',
      'passwd',
      'passphrase',
      'pwd',
      'dbPwd',
      'apiKey',
      'api_key',
      'API-KEY',
      'privateKey',
      'private_key',
      'credentials',
      'gomdonCredential',
      'key',
      'KEY2',
      'hmac',
      'hmacSha256',
      'signature',
      'webhookSignature',
    ]) {
      expect({ k, secret: isSecretKey(k) }).toEqual({ k, secret: true });
    }
  });

  it('isSecretKey KHÔNG che khoá thường có chứa "pass"/"key" như chuỗi con (seasonpass.*, keyword, monkey…)', () => {
    // seasonpass.tiers / seasonpass.checkin_xp là key SystemConfig đang seed (prisma/seed.ts) — che nhầm
    // thì admin không đọc/sửa được bậc Season Pass trong tab Cấu hình.
    for (const k of [
      'seasonpass.tiers',
      'seasonpass.checkin_xp',
      'passport',
      'bypass',
      'compass',
      'keyword',
      'monkey',
      'keys_count',
      'key_id',
      'defaultWarehouse',
      'defaultWeightFallback',
      'province',
      'phone',
    ]) {
      expect({ k, secret: isSecretKey(k) }).toEqual({ k, secret: false });
    }
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

/**
 * Trước đây phần tử mảng được khôi phục THEO CHỈ SỐ: admin xoá/đổi thứ tự 1 phần tử trong danh sách
 * (vd 2 tài khoản đối tác, mỗi cái 1 token) mà token vẫn đang che → phần tử nhận NHẦM bí mật của phần tử
 * khác ở cùng vị trí cũ, âm thầm, không lỗi. Nay chỉ khôi phục khi chắc chắn là CÙNG phần tử.
 */
describe('restoreRedactedSecrets — bí mật che trong mảng đã đổi độ dài/thứ tự', () => {
  const REORDER_MSG = 'Nhập lại giá trị thật cho trường bí mật trong danh sách đã đổi thứ tự/độ dài';
  const stored = {
    accounts: [
      { name: 'A', token: 'tok-A' },
      { name: 'B', token: 'tok-B' },
    ],
  };

  function expect400(fn: () => unknown) {
    let err: unknown;
    try {
      fn();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toContain(REORDER_MSG);
  }

  it('cùng độ dài + cùng field thường → khôi phục đúng phần tử (kể cả khoá JSON bị jsonb xáo thứ tự)', () => {
    const incoming = { accounts: [{ token: REDACTED, name: 'A' }, { name: 'B', token: REDACTED }] };
    expect(restoreRedactedSecrets('partner.accounts', incoming, stored)).toEqual(stored);
  });

  it('xoá bớt 1 phần tử (độ dài khác) mà vẫn còn chuỗi che → 400, không gán nhầm tok-A cho B', () => {
    expect400(() => restoreRedactedSecrets('partner.accounts', { accounts: [{ name: 'B', token: REDACTED }] }, stored));
  });

  it('thêm phần tử mới (độ dài khác) → 400', () => {
    const incoming = {
      accounts: [
        { name: 'A', token: REDACTED },
        { name: 'B', token: REDACTED },
        { name: 'C', token: 'tok-C' },
      ],
    };
    expect400(() => restoreRedactedSecrets('partner.accounts', incoming, stored));
  });

  it('đổi thứ tự (field thường của phần tử khác phần tử cũ cùng vị trí) → 400', () => {
    const incoming = { accounts: [{ name: 'B', token: REDACTED }, { name: 'A', token: REDACTED }] };
    expect400(() => restoreRedactedSecrets('partner.accounts', incoming, stored));
  });

  it('bí mật che nằm sâu trong phần tử (item.auth.password) cũng được kiểm', () => {
    const deep = { list: [{ id: 1, auth: { user: 'u1', password: 'p1' } }, { id: 2, auth: { user: 'u2', password: 'p2' } }] };
    const same = { list: [{ id: 1, auth: { user: 'u1', password: REDACTED } }, { id: 2, auth: { user: 'u2', password: REDACTED } }] };
    expect(restoreRedactedSecrets('k', same, deep)).toEqual(deep);
    const swapped = { list: [{ id: 2, auth: { user: 'u2', password: REDACTED } }, { id: 1, auth: { user: 'u1', password: REDACTED } }] };
    expect400(() => restoreRedactedSecrets('k', swapped, deep));
  });

  it('mảng không chứa chuỗi che → tự do thêm/xoá/đổi thứ tự như trước', () => {
    const incoming = { accounts: [{ name: 'C', token: 'tok-C' }] };
    expect(restoreRedactedSecrets('partner.accounts', incoming, stored)).toEqual(incoming);
    expect(restoreRedactedSecrets('k', { tiers: [3, 2, 1, 0] }, { tiers: [1, 2, 3] })).toEqual({ tiers: [3, 2, 1, 0] });
  });

  it('phần tử có chuỗi che đổi được bí mật KHÁC sang giá trị mới mà vẫn khớp field thường → hợp lệ', () => {
    const s = { list: [{ name: 'A', token: 't', apiKey: 'k' }] };
    const incoming = { list: [{ name: 'A', token: REDACTED, apiKey: 'k-new' }] };
    expect(restoreRedactedSecrets('k', incoming, s)).toEqual({ list: [{ name: 'A', token: 't', apiKey: 'k-new' }] });
  });
});

/**
 * Mở rộng SECRET_KEY_RE không được che nhầm key/field đang seed: GET /admin/config trả "••••" cho
 * field che, form cấu hình (Gomdon/tích điểm/ô JSON thô) sẽ không đọc/sửa được giá trị thật nữa.
 * Đọc thẳng mảng SYSTEM_CONFIGS trong prisma/seed.ts (import seed.ts sẽ chạy main() → cần DB).
 */
describe('SECRET_KEY_RE không che nhầm SystemConfig đang seed', () => {
  function seededConfigs(): { key: string; value: unknown }[] {
    const src = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf-8');
    const start = src.indexOf('const SYSTEM_CONFIGS: ConfigSeed[] = [');
    expect(start).toBeGreaterThanOrEqual(0);
    const open = src.indexOf('[', src.indexOf('=', start));
    const end = src.indexOf('\n];', open);
    expect(end).toBeGreaterThan(open);
    // Literal JS thuần (không có cú pháp TS) — Prisma chỉ phòng trường hợp có Prisma.Decimal.
    const factory = new Function('Prisma', `return ${src.slice(open, end + 2)};`) as (p: unknown) => unknown;
    return factory({ Decimal: Number }) as { key: string; value: unknown }[];
  }

  function fieldNames(v: unknown, out: Set<string> = new Set()): Set<string> {
    if (Array.isArray(v)) v.forEach((x) => fieldNames(x, out));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        out.add(k);
        fieldNames(x, out);
      }
    }
    return out;
  }

  it('không key nào và không field lồng nào của config đang seed bị coi là bí mật', () => {
    const rows = seededConfigs();
    expect(rows.length).toBeGreaterThan(50);
    const keyHits = rows.map((r) => r.key).filter(isSecretKey);
    const fieldHits = [...fieldNames(rows.map((r) => r.value))].filter(isSecretKey);
    expect({ keyHits, fieldHits }).toEqual({ keyHits: [], fieldHits: [] });
    // Và vì thế GET /admin/config trả nguyên văn toàn bộ config đang seed.
    const redacted = redactConfigRows(rows);
    expect(redacted).toEqual(rows);
  });
});
