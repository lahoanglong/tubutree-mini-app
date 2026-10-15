import type { AlertMessage } from './ops-alerts';
import { alertEmail, emailEnvLabel, redactSensitive, scrubSecrets, testEmail } from './ops-email';

const CTX = { appName: 'Tubu Tree', envLabel: 'production' };

const alert = (messages: string[], extra: Partial<AlertMessage> = {}): AlertMessage => ({
  status: 'ALERT',
  title: '⚠️ Sự cố vận hành',
  summary: messages.join('; '),
  problems: messages.map((message, i) => ({ key: `k${i}`, message })),
  generatedAt: '2026-10-15T07:05:00.000Z',
  ...extra,
});

describe('alertEmail', () => {
  it('tiêu đề tiếng Việt có tên ứng dụng và môi trường, nêu số vấn đề', () => {
    const m = alert(['3 đơn quá 30 phút chưa lên Pancake: TUBU1, TUBU2 và 1 việc khác', 'Hàng đợi pancake-push: 7 job lỗi trong 1 giờ qua']);
    expect(alertEmail(m, CTX).subject).toBe('[Tubu Tree · production] Sự cố vận hành: 2 vấn đề cần xử lý');
    expect(alertEmail(alert(['x']), { appName: 'Tubu Tree', envLabel: 'staging' }).subject).toBe('[Tubu Tree · staging] Sự cố vận hành: 1 vấn đề cần xử lý');
  });

  it('nội dung nêu từng vấn đề kèm số lượng và mã đơn cũ nhất, ở cả bản văn bản lẫn HTML', () => {
    const msg = '3 đơn quá 30 phút chưa lên Pancake: TUBU2026101500001, TUBU2026101500002 và 1 việc khác';
    const e = alertEmail(alert([msg]), CTX);
    expect(e.text).toContain(msg);
    expect(e.html).toContain(msg);
    expect(e.text).toContain('14:05 15/10/2026');
  });

  it('chỉ dẫn nơi xử lý là chữ (màn Sức khoẻ hệ thống) và KHÔNG có đường link — chưa có cấu hình địa chỉ trang quản trị', () => {
    const e = alertEmail(alert(['x']), CTX);
    expect(e.text).toContain('Sức khoẻ hệ thống');
    expect(e.html).toContain('Sức khoẻ hệ thống');
    expect(`${e.text}${e.html}`).not.toMatch(/https?:\/\/|href=/i);
  });

  it('HTML thoát ký tự đặc biệt của nội dung động', () => {
    const e = alertEmail(alert(['Đồng bộ danh mục Pancake lỗi: <script>alert(1)</script> & "x"']), CTX);
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.html).toContain('&amp;');
    expect(e.html).toContain('&quot;x&quot;');
  });

  it('không để lọt số điện thoại, mã bí mật hoặc thông tin đăng nhập trong thông điệp lỗi tự do', () => {
    const e = alertEmail(
      alert([
        'Đồng bộ danh mục Pancake lỗi: sđt 0912 345 678 không hợp lệ; +84 912-345-678; 84912345678',
        'Hàng đợi không phản hồi: connect redis://default:hunter2@redis.internal:6379 api_key=sk_live_ABCDEF123456 Bearer abc.def.ghi',
        `Lỗi token ${'a1b2c3d4'.repeat(6)}`,
      ]),
      CTX,
    );
    for (const out of [e.text, e.html]) {
      expect(out).not.toMatch(/0912|912-345|912 345|84912345678/);
      expect(out).not.toContain('hunter2');
      expect(out).not.toContain('sk_live_ABCDEF123456');
      expect(out).not.toContain('abc.def.ghi');
      expect(out).not.toContain('a1b2c3d4a1b2c3d4');
    }
  });

  it('thông điệp quá dài bị cắt, không đẩy cả thân phản hồi lỗi vào email', () => {
    const e = alertEmail(alert([`Đồng bộ danh mục Pancake lỗi: ${'lỗi '.repeat(500)}`]), CTX);
    expect(e.text.length).toBeLessThan(1500);
    expect(e.text).toContain('…');
  });

  it('báo đã ổn: tiêu đề riêng, nội dung là tóm tắt hết sự cố', () => {
    const m: AlertMessage = {
      status: 'RECOVERED',
      title: '✅ Vận hành đã ổn trở lại',
      summary: 'Hết sự cố bắt đầu lúc 10:00 15/10/2026 (kiểm lúc 14:05 15/10/2026).',
      problems: [],
      generatedAt: '2026-10-15T07:05:00.000Z',
    };
    const e = alertEmail(m, CTX);
    expect(e.subject).toBe('[Tubu Tree · production] Vận hành đã ổn trở lại');
    expect(e.text).toContain('Hết sự cố bắt đầu lúc 10:00 15/10/2026');
    expect(e.html).toContain('Hết sự cố bắt đầu lúc 10:00 15/10/2026');
  });
});

describe('testEmail', () => {
  it('email thử có tiêu đề riêng, nói rõ là thử và không mang dữ liệu sự cố', () => {
    const e = testEmail(CTX, new Date('2026-10-15T07:05:00.000Z'));
    expect(e.subject).toBe('[Tubu Tree · production] Email thử báo động vận hành');
    expect(e.text).toContain('email thử');
    expect(e.text).toContain('14:05 15/10/2026');
    expect(e.html).toContain('14:05 15/10/2026');
  });
});

describe('emailEnvLabel', () => {
  it('ưu tiên nhãn đặt tay, rồi NODE_ENV, cuối cùng development', () => {
    expect(emailEnvLabel(' staging ', 'production')).toBe('staging');
    expect(emailEnvLabel('', 'production')).toBe('production');
    expect(emailEnvLabel(undefined, undefined)).toBe('development');
  });
});

describe('redactSensitive / scrubSecrets', () => {
  it('giữ nguyên mã đơn, số lượng và tên hàng đợi (không che nhầm)', () => {
    const t = '12 đơn quá 30 phút chưa lên Pancake: TUBU2026101500001, TUBUSUB1234567890, #987654321 · Hàng đợi pancake-push: 7 job lỗi';
    expect(redactSensitive(t)).toBe(t);
  });

  describe('che số điện thoại', () => {
    const MASK = '[số điện thoại đã ẩn]';

    it.each([
      ['SĐT0912345678', `SĐT${MASK}`],
      ['SĐT:0912345678', `SĐT:${MASK}`],
      ['sdt0912345678 gọi lại', `sdt${MASK} gọi lại`],
      ['Khách0912345678giao', `Khách${MASK}giao`],
      ['KH+84912345678', `KH${MASK}`],
      ['ĐT84912345678.', `ĐT${MASK}.`],
      ['gọi_0912345678', `gọi_${MASK}`],
      ['SĐT0912 345 678', `SĐT${MASK}`],
      ['SĐT0912.345.678', `SĐT${MASK}`],
      ['liên hệ 0912345678', `liên hệ ${MASK}`],
      ['0912345678', MASK],
      ['(0912345678)', `(${MASK})`],
      ['+84 912-345-678', MASK],
      ['bàn 0243 8123 456', `bàn ${MASK}`],
    ])('che %j', (input, expected) => {
      expect(redactSensitive(input)).toBe(expected);
    });

    it('che mọi số trong một câu, kể cả số dính chữ và số tách rời', () => {
      const out = redactSensitive('Pancake lỗi: SĐT0912345678 và 0987654321, người nhận KH0388888888.');
      expect(out).toBe(`Pancake lỗi: SĐT${MASK} và ${MASK}, người nhận KH${MASK}.`);
    });

    it.each([
      'TUBU2026101500001',
      'TUBU2026101500001,TUBU2026101500002',
      'TUBUSUB1234567890',
      'TUBUSUB0000123007',
      'TUBUSUB0912345007',
      'TUBUSUB0387654321',
      'tubusub0912345007',
      'TUBU0912345678',
      '#987654321',
      'ref0000123007',
      'sku0112345678',
      'abc20261015000010912345678',
      '0912345678901234',
      '84912345678901234',
      'job 1234567890123',
      'Đã quá 30 phút, 12 đơn, lỗi 500',
      'Lúc 2026-10-15T07:05:00.000Z và 14:05 15/10/2026',
      'Hàng đợi pancake-push: 7 job lỗi trong 1 giờ qua',
    ])('giữ nguyên %j (mã đơn, id, mốc giờ, dãy số khác)', (input) => {
      expect(redactSensitive(input)).toBe(input);
    });

    it('mã đơn nằm cạnh số điện thoại: che số, giữ mã', () => {
      expect(redactSensitive('Đơn TUBUSUB0000123007 của SĐT0912345678')).toBe(`Đơn TUBUSUB0000123007 của SĐT${MASK}`);
      expect(redactSensitive('TUBU2026101500001 SĐT:0912345678')).toBe(`TUBU2026101500001 SĐT:${MASK}`);
    });

    it('chuỗi giống khoá dài (UUID, hex) được che hẳn, không bị chẻ đôi quanh dãy số giống số điện thoại', () => {
      const token = 'ab-0912-3456-7890-abcdef0123456789ab';
      const out = redactSensitive(`token lạ ${token}`);
      expect(out).toBe('token lạ ***');
      expect(redactSensitive(`id ${'f'.repeat(8)}-0912345678-${'e'.repeat(20)}`)).toBe('id ***');
    });
  });

  it('scrubSecrets thay mọi giá trị bí mật đã biết, bỏ qua giá trị quá ngắn để không phá chữ thường', () => {
    expect(scrubSecrets('Invalid login for mailer: password hunter2 rejected', ['mailer', 'hunter2', 'a'])).toBe(
      'Invalid login for ***: password *** rejected',
    );
    expect(scrubSecrets('abc', ['', ' '])).toBe('abc');
  });
});
