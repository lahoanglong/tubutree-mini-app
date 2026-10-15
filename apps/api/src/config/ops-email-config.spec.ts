import { parseEmailRecipients, resolveOpsEmailConfig } from './ops-email-config';

const FULL = {
  OPS_ALERT_EMAIL_TO: 'ops@tubutree.com',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'mailer',
  SMTP_PASS: 'p@ss-word',
  SMTP_FROM: 'Tubu Tree <alerts@tubutree.com>',
};

const issueKeys = (env: Record<string, string>) => {
  const r = resolveOpsEmailConfig(env);
  return r.state === 'misconfigured' ? r.issues.map((i) => i.key) : [];
};

describe('parseEmailRecipients', () => {
  it('tách theo dấu phẩy và chấm phẩy, bỏ khoảng trắng, bỏ mục rỗng, bỏ trùng không phân biệt hoa thường', () => {
    expect(parseEmailRecipients(' a@x.com ; B@x.com,, a@X.com ;')).toEqual({ valid: ['a@x.com', 'B@x.com'], invalid: [] });
  });

  it('trả riêng các mục sai để báo đúng chỗ, không nuốt', () => {
    const r = parseEmailRecipients('ok@x.com, khong-phai-email, a b@x.com, @x.com');
    expect(r.valid).toEqual(['ok@x.com']);
    expect(r.invalid).toEqual(['khong-phai-email', 'a b@x.com', '@x.com']);
  });

  it('rỗng hoặc chỉ có dấu phân cách → không có người nhận', () => {
    expect(parseEmailRecipients('')).toEqual({ valid: [], invalid: [] });
    expect(parseEmailRecipients(' ; , ')).toEqual({ valid: [], invalid: [] });
  });

  it('xuống dòng trong địa chỉ (chèn header) bị coi là sai', () => {
    expect(parseEmailRecipients('a@x.com\r\nBcc: evil@x.com').invalid).toHaveLength(1);
  });
});

describe('resolveOpsEmailConfig', () => {
  it('không đặt biến nào (hoặc toàn rỗng/khoảng trắng) → kênh email tắt', () => {
    expect(resolveOpsEmailConfig({})).toEqual({ state: 'disabled' });
    expect(resolveOpsEmailConfig({ OPS_ALERT_EMAIL_TO: '', SMTP_HOST: '  ', SMTP_PORT: '' })).toEqual({ state: 'disabled' });
  });

  it('đủ cấu hình → sẵn sàng; địa chỉ gửi tách tên hiển thị, STARTTLS bắt buộc khi có tài khoản', () => {
    const r = resolveOpsEmailConfig(FULL);
    expect(r).toEqual({
      state: 'ready',
      recipients: ['ops@tubutree.com'],
      from: { name: 'Tubu Tree', address: 'alerts@tubutree.com' },
      smtp: { host: 'smtp.example.test', port: 587, secure: false, requireTLS: true, auth: { user: 'mailer', pass: 'p@ss-word' } },
    });
  });

  it('tối thiểu chỉ cần người nhận + máy chủ + địa chỉ gửi; cổng mặc định 587, không tài khoản thì không ép STARTTLS', () => {
    const r = resolveOpsEmailConfig({ OPS_ALERT_EMAIL_TO: 'a@x.com;b@x.com', SMTP_HOST: 'smtp.example.test', SMTP_FROM: 'alerts@tubutree.com' });
    expect(r).toEqual({
      state: 'ready',
      recipients: ['a@x.com', 'b@x.com'],
      from: { address: 'alerts@tubutree.com' },
      smtp: { host: 'smtp.example.test', port: 587, secure: false, requireTLS: false },
    });
  });

  it('cổng 465 mà không đặt SMTP_SECURE → TLS ngay từ đầu; đặt false thì tôn trọng', () => {
    const base = { OPS_ALERT_EMAIL_TO: 'a@x.com', SMTP_HOST: 'h.test', SMTP_FROM: 'f@x.com', SMTP_PORT: '465' };
    expect(resolveOpsEmailConfig(base)).toMatchObject({ state: 'ready', smtp: { port: 465, secure: true } });
    expect(resolveOpsEmailConfig({ ...base, SMTP_SECURE: 'false' })).toMatchObject({ state: 'ready', smtp: { port: 465, secure: false } });
    expect(resolveOpsEmailConfig({ ...base, SMTP_PORT: '', SMTP_SECURE: 'TRUE' })).toMatchObject({ state: 'ready', smtp: { port: 465, secure: true } });
  });

  describe('SMTP_SECURE', () => {
    const base = { OPS_ALERT_EMAIL_TO: 'a@x.com', SMTP_HOST: 'h.test', SMTP_FROM: 'f@x.com', SMTP_PORT: '587' };
    const ACCEPTED_TRUE = ['true', 'yes', '1', 'on'];
    const ACCEPTED_FALSE = ['false', 'no', '0', 'off'];

    it.each([...ACCEPTED_TRUE, ...ACCEPTED_TRUE.map((v) => v.toUpperCase()), ' Yes '])('nhận %j là true', (v) => {
      expect(resolveOpsEmailConfig({ ...base, SMTP_SECURE: v })).toMatchObject({ state: 'ready', smtp: { secure: true } });
    });

    it.each([...ACCEPTED_FALSE, ...ACCEPTED_FALSE.map((v) => v.toUpperCase()), ' Off '])('nhận %j là false', (v) => {
      expect(resolveOpsEmailConfig({ ...base, SMTP_SECURE: v })).toMatchObject({ state: 'ready', smtp: { secure: false } });
    });

    it('giá trị lạ → thông báo liệt kê ĐỦ tám giá trị được nhận (true/false/yes/no/1/0/on/off), nêu khoá, không lộ giá trị đã gõ', () => {
      const r = resolveOpsEmailConfig({ ...base, SMTP_SECURE: 'tls-secret-value' });
      expect(r.state).toBe('misconfigured');
      if (r.state !== 'misconfigured') return;
      expect(r.issues).toHaveLength(1);
      const { key, message } = r.issues[0]!;
      expect(key).toBe('SMTP_SECURE');
      for (const v of [...ACCEPTED_TRUE, ...ACCEPTED_FALSE]) {
        expect({ v, listed: new RegExp(`(?<![\\w/])${v}(?![\\w])`).test(message) }).toEqual({ v, listed: true });
      }
      expect(message).not.toContain('tls-secret-value');
    });

    it('mọi giá trị mà thông báo liệt kê đều thật sự được nhận (không lệch giữa lời nhắc và luật)', () => {
      const r = resolveOpsEmailConfig({ ...base, SMTP_SECURE: 'nope' });
      if (r.state !== 'misconfigured') throw new Error('expected misconfigured');
      const listed = /chỉ nhận ([^(]+) \(/.exec(r.issues[0]!.message)?.[1]?.split(', ') ?? [];
      expect(listed.sort()).toEqual([...ACCEPTED_TRUE, ...ACCEPTED_FALSE].sort());
      for (const v of listed) expect(resolveOpsEmailConfig({ ...base, SMTP_SECURE: v }).state).toBe('ready');
    });
  });

  it('SMTP_USER là địa chỉ email thì dùng làm địa chỉ gửi khi không đặt SMTP_FROM', () => {
    const r = resolveOpsEmailConfig({ ...FULL, SMTP_FROM: '', SMTP_USER: 'alerts@tubutree.com' });
    expect(r).toMatchObject({ state: 'ready', from: { address: 'alerts@tubutree.com' } });
  });

  it.each([
    ['chỉ có người nhận, thiếu máy chủ', { OPS_ALERT_EMAIL_TO: 'a@x.com', SMTP_FROM: 'f@x.com' }, ['SMTP_HOST']],
    ['chỉ có máy chủ, thiếu người nhận', { SMTP_HOST: 'h.test', SMTP_FROM: 'f@x.com' }, ['OPS_ALERT_EMAIL_TO']],
    ['chỉ có cổng', { SMTP_PORT: '587' }, ['OPS_ALERT_EMAIL_TO', 'SMTP_HOST', 'SMTP_FROM']],
    ['có tài khoản, thiếu mật khẩu', { ...FULL, SMTP_PASS: '' }, ['SMTP_PASS']],
    ['có mật khẩu, thiếu tài khoản', { ...FULL, SMTP_USER: '' }, ['SMTP_USER']],
    ['tài khoản không phải email và không có SMTP_FROM', { ...FULL, SMTP_FROM: '' }, ['SMTP_FROM']],
    ['cổng không phải số', { ...FULL, SMTP_PORT: 'abc' }, ['SMTP_PORT']],
    ['cổng ngoài khoảng', { ...FULL, SMTP_PORT: '70000' }, ['SMTP_PORT']],
    ['cổng thập phân', { ...FULL, SMTP_PORT: '58.7' }, ['SMTP_PORT']],
    ['SMTP_SECURE không thuộc các giá trị được nhận', { ...FULL, SMTP_SECURE: 'maybe' }, ['SMTP_SECURE']],
    ['máy chủ có scheme', { ...FULL, SMTP_HOST: 'smtp://smtp.example.test' }, ['SMTP_HOST']],
    ['máy chủ có khoảng trắng', { ...FULL, SMTP_HOST: 'smtp.example test' }, ['SMTP_HOST']],
    ['địa chỉ gửi sai', { ...FULL, SMTP_FROM: 'không-phải-email' }, ['SMTP_FROM']],
    ['một người nhận sai', { ...FULL, OPS_ALERT_EMAIL_TO: 'ok@x.com, oops' }, ['OPS_ALERT_EMAIL_TO']],
  ])('cấu hình dở dang hoặc sai: %s → báo đúng khoá', (_name, env, keys) => {
    expect(issueKeys(env)).toEqual(keys);
  });

  it('thông báo lỗi bằng tiếng Việt, nêu tên khoá, không lộ mật khẩu', () => {
    const r = resolveOpsEmailConfig({ ...FULL, SMTP_HOST: '', SMTP_PORT: 'abc' });
    expect(r.state).toBe('misconfigured');
    if (r.state !== 'misconfigured') return;
    const text = r.issues.map((i) => i.message).join('\n');
    expect(text).toContain('SMTP_HOST');
    expect(text).toContain('SMTP_PORT');
    expect(text).not.toContain(FULL.SMTP_PASS);
  });
});
