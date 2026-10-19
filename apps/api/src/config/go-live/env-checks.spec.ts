import { evaluateEnv } from './env-checks';
import { GOOD_ENV, SECRET_ENV_KEYS, byId, envWith } from './go-live.fixtures';

const status = (patch: Record<string, string | undefined>, id: string) => byId(evaluateEnv(envWith(patch)), id).status;

describe('evaluateEnv', () => {
  it('môi trường tốt: mọi dòng PASS', () => {
    const bad = evaluateEnv(GOOD_ENV).filter((r) => r.status !== 'PASS');
    expect(bad).toEqual([]);
  });

  it('mọi WARN/FAIL đều có cách sửa, PASS thì không', () => {
    const results = evaluateEnv(envWith({ JWT_ACCESS_SECRET: '', PANCAKE_API_KEY: '', GOMDON_PHONE: '', OPS_ALERT_WEBHOOK_URL: '' }));
    for (const r of results) {
      if (r.status === 'PASS') expect(r.hint).toBe('');
      else expect(r.hint.length).toBeGreaterThan(10);
    }
  });

  it('không bao giờ in giá trị bí mật, kể cả khi sai', () => {
    const broken = envWith({ JWT_ACCESS_SECRET: 'short', SMTP_PORT: 'abc', GOMDON_PHONE: '' });
    for (const env of [GOOD_ENV, broken]) {
      const dump = JSON.stringify(evaluateEnv(env));
      for (const key of SECRET_ENV_KEYS) {
        const v = env[key];
        if (v && v.length >= 5) expect(dump).not.toContain(v);
      }
      expect(dump).not.toContain('db-pass-zz91');
      expect(dump).not.toContain('xoxb-secret-path');
    }
  });

  describe('NODE_ENV', () => {
    it.each([
      ['production', 'PASS'],
      ['development', 'FAIL'],
      [undefined, 'FAIL'],
    ])('%s thì %s', (v, expected) => {
      expect(status({ NODE_ENV: v }, 'env.node_env')).toBe(expected);
    });
  });

  describe('bộ kiểm schema', () => {
    it('PASS với env tốt', () => expect(status({}, 'env.schema')).toBe('PASS'));
    it('FAIL và chỉ nêu tên khoá, không nêu giá trị', () => {
      const r = byId(evaluateEnv(envWith({ JWT_ACCESS_SECRET: 'tooshort', PANCAKE_WEBHOOK_SECRET: '' })), 'env.schema');
      expect(r.status).toBe('FAIL');
      expect(r.detail).toContain('JWT_ACCESS_SECRET');
      expect(r.detail).toContain('PANCAKE_WEBHOOK_SECRET');
      expect(r.detail).not.toContain('tooshort');
    });
  });

  describe('DATABASE_URL', () => {
    it('thiếu thì FAIL', () => expect(status({ DATABASE_URL: undefined }, 'env.database_url')).toBe('FAIL'));
    it('không đọc được thì FAIL và không in chuỗi', () => {
      const r = byId(evaluateEnv(envWith({ DATABASE_URL: 'not a url' })), 'env.database_url');
      expect(r.status).toBe('FAIL');
      expect(r.detail).not.toContain('not a url');
    });
    it('không phải postgres thì FAIL', () => expect(status({ DATABASE_URL: 'mysql://u:p@h/db' }, 'env.database_url')).toBe('FAIL'));
    it('trỏ localhost thì WARN', () => expect(status({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db?connection_limit=20' }, 'env.database_url')).toBe('WARN'));
    it('thiếu connection_limit thì WARN', () => expect(status({ DATABASE_URL: 'postgresql://u:p@postgres:5432/db' }, 'env.database_url')).toBe('WARN'));
    it('không ghi cổng thì hiện 5432', () => {
      const r = byId(evaluateEnv(envWith({ DATABASE_URL: 'postgresql://u:p@postgres/tubutree?connection_limit=20' })), 'env.database_url');
      expect(r.detail).toBe('trỏ postgres:5432/tubutree');
    });
    it('đủ thì PASS và chỉ in host, cổng, tên DB', () => {
      const r = byId(evaluateEnv(GOOD_ENV), 'env.database_url');
      expect(r.status).toBe('PASS');
      expect(r.detail).toBe('trỏ postgres:5432/tubutree');
    });
  });

  describe('khoá JWT', () => {
    const long = 'Zq8Lm3Vx7Tn1Bw5Rk9Yd2Hc6Jf4Pg0SaUe';
    it.each([
      ['thiếu', undefined, 'FAIL'],
      ['là giá trị mẫu', 'dev-access-secret-change-me-please', 'FAIL'],
      ['dưới 16 ký tự', 'abc123', 'FAIL'],
      ['16 đến 31 ký tự', 'Zq8Lm3Vx7Tn1Bw5Rk9Yd', 'WARN'],
      ['từ 32 ký tự', long, 'PASS'],
    ])('access %s thì %s', (_label, value, expected) => {
      expect(status({ JWT_ACCESS_SECRET: value }, 'env.jwt_access')).toBe(expected);
    });

    it('refresh cũng được kiểm riêng', () => {
      expect(status({ JWT_REFRESH_SECRET: 'abc123' }, 'env.jwt_refresh')).toBe('FAIL');
      expect(status({}, 'env.jwt_refresh')).toBe('PASS');
    });

    it('hai khoá giống nhau thì FAIL', () => {
      expect(status({ JWT_ACCESS_SECRET: long, JWT_REFRESH_SECRET: long }, 'env.jwt_distinct')).toBe('FAIL');
      expect(status({}, 'env.jwt_distinct')).toBe('PASS');
    });

    it('không có dòng distinct khi thiếu một khoá', () => {
      expect(evaluateEnv(envWith({ JWT_REFRESH_SECRET: undefined })).some((r) => r.id === 'env.jwt_distinct')).toBe(false);
    });
  });

  describe('CORS_ORIGINS', () => {
    it.each([
      ['rỗng', '', 'FAIL'],
      ['chỉ dấu phẩy', ' , ', 'FAIL'],
      ['có dấu *', 'https://*.tubutree.com', 'WARN'],
      ['không https', 'http://app.tubutree.com', 'WARN'],
      ['dấu / ở cuối', 'https://app.tubutree.com/', 'WARN'],
      ['localhost', 'https://localhost', 'WARN'],
      ['đúng', 'https://app.tubutree.com,https://tubutree.com', 'PASS'],
    ])('%s thì %s', (_label, value, expected) => {
      expect(status({ CORS_ORIGINS: value }, 'env.cors')).toBe(expected);
    });
  });

  describe('cookie', () => {
    it.each([
      ['lax', 'PASS'],
      ['strict', 'PASS'],
      ['none', 'WARN'],
      ['bậy', 'FAIL'],
    ])('SAMESITE %s thì %s', (v, expected) => {
      expect(status({ AUTH_COOKIE_SAMESITE: v }, 'env.cookie_samesite')).toBe(expected);
    });

    it('SAMESITE trống tính là lax', () => expect(status({ AUTH_COOKIE_SAMESITE: '' }, 'env.cookie_samesite')).toBe('PASS'));

    it.each([
      ['', 'PASS'],
      ['.tubutree.com', 'PASS'],
      ['tubutree.com', 'PASS'],
      ['https://tubutree.com', 'FAIL'],
      ['tubutree.com:443', 'FAIL'],
      ['.khac-domain.vn', 'WARN'],
    ])('DOMAIN "%s" thì %s', (v, expected) => {
      expect(status({ AUTH_COOKIE_DOMAIN: v }, 'env.cookie_domain')).toBe(expected);
    });
  });

  describe('THROTTLE_BYPASS_TOKEN', () => {
    const token = 'tb-Mn4Bv7Cx1Zl9Kj2Hg5Fd8Sa3Pq6Wr0Ey';
    it('không đặt thì WARN kèm cách sinh token', () => {
      const r = byId(evaluateEnv(envWith({ THROTTLE_BYPASS_TOKEN: '' })), 'env.throttle_bypass');
      expect(r.status).toBe('WARN');
      expect(r.hint).toContain('openssl rand -hex 32');
    });
    it('đặt đủ 32 ký tự thì PASS và không in token', () => {
      const r = byId(evaluateEnv(envWith({ THROTTLE_BYPASS_TOKEN: token })), 'env.throttle_bypass');
      expect(r.status).toBe('PASS');
      expect(JSON.stringify(r)).not.toContain(token);
    });
    it('ngắn hơn 32 ký tự thì FAIL vì API không khởi động', () => {
      expect(status({ THROTTLE_BYPASS_TOKEN: 'ngan-qua-khong-du-32-ky-tu' }, 'env.throttle_bypass')).toBe('FAIL');
    });
  });

  describe('Pancake', () => {
    it('thiếu khoá API hoặc mã shop thì FAIL', () => {
      expect(status({ PANCAKE_API_KEY: '' }, 'env.pancake.credentials')).toBe('FAIL');
      expect(status({ PANCAKE_SHOP_ID: undefined }, 'env.pancake.credentials')).toBe('FAIL');
      expect(status({}, 'env.pancake.credentials')).toBe('PASS');
    });
    it('token webhook: thiếu FAIL, ngắn WARN, đủ PASS', () => {
      expect(status({ PANCAKE_WEBHOOK_SECRET: '' }, 'env.pancake.webhook_secret')).toBe('FAIL');
      expect(status({ PANCAKE_WEBHOOK_SECRET: 'abc' }, 'env.pancake.webhook_secret')).toBe('WARN');
      expect(status({}, 'env.pancake.webhook_secret')).toBe('PASS');
    });
    it('base url: http hoặc rác thì FAIL, trống thì dùng mặc định', () => {
      expect(status({ PANCAKE_BASE_URL: 'http://pos.pages.fm/api/v1' }, 'env.pancake.base_url')).toBe('FAIL');
      expect(status({ PANCAKE_BASE_URL: 'abc' }, 'env.pancake.base_url')).toBe('FAIL');
      expect(status({ PANCAKE_BASE_URL: '' }, 'env.pancake.base_url')).toBe('PASS');
    });
  });

  describe('Gomdon', () => {
    it('chưa đặt tài khoản thì WARN (tính năng tuỳ chọn)', () => {
      expect(status({ GOMDON_PHONE: '', GOMDON_PASSWORD: '' }, 'env.gomdon.credentials')).toBe('WARN');
    });
    it('chỉ đặt một nửa thì FAIL', () => {
      expect(status({ GOMDON_PASSWORD: '' }, 'env.gomdon.credentials')).toBe('FAIL');
      expect(status({ GOMDON_PHONE: '' }, 'env.gomdon.credentials')).toBe('FAIL');
    });
    it('đặt đủ thì PASS', () => expect(status({}, 'env.gomdon.credentials')).toBe('PASS'));
    it('đã có tài khoản mà thiếu token webhook thì FAIL', () => {
      expect(status({ GOMDON_WEBHOOK_SECRET: '' }, 'env.gomdon.webhook_secret')).toBe('FAIL');
    });
    it('chưa có tài khoản và thiếu token webhook thì chỉ WARN', () => {
      expect(status({ GOMDON_PHONE: '', GOMDON_PASSWORD: '', GOMDON_WEBHOOK_SECRET: '' }, 'env.gomdon.webhook_secret')).toBe('WARN');
    });
    it('token webhook ngắn thì WARN, đủ thì PASS', () => {
      expect(status({ GOMDON_WEBHOOK_SECRET: 'abc' }, 'env.gomdon.webhook_secret')).toBe('WARN');
      expect(status({}, 'env.gomdon.webhook_secret')).toBe('PASS');
    });
    it('GOMDON_BASE_URL: không có dòng khi trống, http thì FAIL, https thì PASS', () => {
      expect(evaluateEnv(envWith({ GOMDON_BASE_URL: '' })).some((r) => r.id === 'env.gomdon.base_url')).toBe(false);
      expect(status({ GOMDON_BASE_URL: 'http://admin.gomdon.com.vn' }, 'env.gomdon.base_url')).toBe('FAIL');
      expect(status({ GOMDON_BASE_URL: 'https://admin.gomdon.com.vn' }, 'env.gomdon.base_url')).toBe('PASS');
    });
  });

  describe('ZaloPay', () => {
    it('chưa đặt thì WARN, không chặn', () => {
      expect(status({ ZALOPAY_APP_ID: '', ZALOPAY_KEY1: '', ZALOPAY_KEY2: '' }, 'env.zalopay')).toBe('WARN');
    });
    it('đặt dở thì FAIL', () => expect(status({ ZALOPAY_KEY2: '' }, 'env.zalopay')).toBe('FAIL'));
    it('khoá đủ nhưng endpoint sandbox hoặc để trống thì WARN', () => {
      expect(status({ ZALOPAY_ENDPOINT: 'https://sb-openapi.zalopay.vn/v2' }, 'env.zalopay')).toBe('WARN');
      expect(status({ ZALOPAY_ENDPOINT: '' }, 'env.zalopay')).toBe('WARN');
    });
    it('khoá đủ, endpoint production thì PASS', () => expect(status({}, 'env.zalopay')).toBe('PASS'));
  });

  describe('Zalo', () => {
    it('đăng nhập: thiếu app id hoặc secret thì FAIL', () => {
      expect(status({ ZALO_APP_SECRET: '' }, 'env.zalo.login')).toBe('FAIL');
      expect(status({ ZALO_APP_ID: undefined }, 'env.zalo.login')).toBe('FAIL');
      expect(status({}, 'env.zalo.login')).toBe('PASS');
    });
    it('OA: không có thì WARN, thiếu một phần thì WARN, đủ thì PASS', () => {
      expect(status({ ZALO_OA_ID: '', ZALO_OA_ACCESS_TOKEN: '', ZALO_OA_REFRESH_TOKEN: '' }, 'env.zalo.oa')).toBe('WARN');
      expect(status({ ZALO_OA_REFRESH_TOKEN: '' }, 'env.zalo.oa')).toBe('WARN');
      expect(status({}, 'env.zalo.oa')).toBe('PASS');
    });
    it('token webhook OA: trống WARN, ngắn WARN, đủ PASS', () => {
      expect(status({ ZALO_OA_WEBHOOK_SECRET: '' }, 'env.zalo.oa_webhook_secret')).toBe('WARN');
      expect(status({ ZALO_OA_WEBHOOK_SECRET: 'abc' }, 'env.zalo.oa_webhook_secret')).toBe('WARN');
      expect(status({}, 'env.zalo.oa_webhook_secret')).toBe('PASS');
    });
  });

  describe('Accesstrade', () => {
    it('token webhook: thiếu FAIL, đủ PASS', () => {
      expect(status({ ACCESSTRADE_WEBHOOK_SECRET: '' }, 'env.accesstrade.webhook_secret')).toBe('FAIL');
      expect(status({}, 'env.accesstrade.webhook_secret')).toBe('PASS');
    });
    it('khoá API: thiếu WARN, đủ PASS', () => {
      expect(status({ ACCESSTRADE_TOKEN: '' }, 'env.accesstrade.api')).toBe('WARN');
      expect(status({}, 'env.accesstrade.api')).toBe('PASS');
    });
  });

  describe('Cloudinary', () => {
    it('không thấy biến nào: WARN vì không kiểm được từ server', () => {
      const r = byId(evaluateEnv(envWith({ VITE_CLOUDINARY_CLOUD_NAME: undefined, VITE_CLOUDINARY_UPLOAD_PRESET: undefined })), 'env.cloudinary');
      expect(r.status).toBe('WARN');
      expect(r.detail).toContain('không kiểm được');
    });
    it('chỉ một biến thì FAIL', () => expect(status({ VITE_CLOUDINARY_UPLOAD_PRESET: undefined }, 'env.cloudinary')).toBe('FAIL'));
    it('đủ hai biến thì PASS', () => expect(status({}, 'env.cloudinary')).toBe('PASS'));
  });

  describe('báo động vận hành', () => {
    it('webhook: trống WARN, rác FAIL, http WARN, https PASS và chỉ in host', () => {
      expect(status({ OPS_ALERT_WEBHOOK_URL: '' }, 'env.ops.webhook')).toBe('WARN');
      expect(status({ OPS_ALERT_WEBHOOK_URL: 'khong-phai-url' }, 'env.ops.webhook')).toBe('FAIL');
      expect(status({ OPS_ALERT_WEBHOOK_URL: 'http://n8n.tubutree.com/hook/abc' }, 'env.ops.webhook')).toBe('WARN');
      const ok = byId(evaluateEnv(GOOD_ENV), 'env.ops.webhook');
      expect(ok.status).toBe('PASS');
      expect(ok.detail).toBe('host hooks.slack.com');
    });

    it('email: tắt WARN, dở dang FAIL, đủ PASS', () => {
      const off = { OPS_ALERT_EMAIL_TO: '', SMTP_HOST: '', SMTP_PORT: '', SMTP_SECURE: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '' };
      expect(status(off, 'env.ops.email')).toBe('WARN');
      expect(status({ SMTP_HOST: '' }, 'env.ops.email')).toBe('FAIL');
      expect(status({ SMTP_PORT: '99999' }, 'env.ops.email')).toBe('FAIL');
      const ok = byId(evaluateEnv(GOOD_ENV), 'env.ops.email');
      expect(ok.status).toBe('PASS');
      expect(ok.detail).toContain('2 người nhận');
      expect(ok.detail).toContain('smtp.example-mail.com:587');
    });

    it('email qua TLS không cần tài khoản SMTP', () => {
      const r = byId(evaluateEnv(envWith({ SMTP_USER: '', SMTP_PASS: '', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_FROM: 'alerts@tubutree.com' })), 'env.ops.email');
      expect(r.status).toBe('PASS');
      expect(r.detail).toContain('(TLS)');
      expect(r.detail).toContain('không đăng nhập SMTP');
    });

    it('kênh ra ngoài: không có WARN, có một PASS', () => {
      const none = { OPS_ALERT_WEBHOOK_URL: '', OPS_ALERT_EMAIL_TO: '', SMTP_HOST: '', SMTP_PORT: '', SMTP_SECURE: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '' };
      expect(status(none, 'env.ops.channels')).toBe('WARN');
      expect(status({ OPS_ALERT_WEBHOOK_URL: '' }, 'env.ops.channels')).toBe('PASS');
      expect(byId(evaluateEnv(envWith({ OPS_ALERT_WEBHOOK_URL: '' })), 'env.ops.channels').detail).toBe('email');
    });

    it('nhãn môi trường: chỉ xét khi có kênh, trống thì WARN', () => {
      expect(status({ OPS_ALERT_ENV_LABEL: '' }, 'env.ops.label')).toBe('WARN');
      expect(status({}, 'env.ops.label')).toBe('PASS');
      const none = { OPS_ALERT_WEBHOOK_URL: '', OPS_ALERT_EMAIL_TO: '', SMTP_HOST: '', SMTP_PORT: '', SMTP_SECURE: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '' };
      expect(evaluateEnv(envWith(none)).some((r) => r.id === 'env.ops.label')).toBe(false);
    });
  });

  describe('token webhook khác nhau', () => {
    it('trùng nhau thì WARN và nêu tên khoá, không nêu giá trị', () => {
      const same = 'same-hook-Aq1Sw2De3Fr4Gt5Hy6Ju7Ki8';
      const r = byId(evaluateEnv(envWith({ PANCAKE_WEBHOOK_SECRET: same, GOMDON_WEBHOOK_SECRET: same })), 'env.webhook_secrets_distinct');
      expect(r.status).toBe('WARN');
      expect(r.detail).toContain('PANCAKE_WEBHOOK_SECRET và GOMDON_WEBHOOK_SECRET');
      expect(r.detail).not.toContain(same);
    });
    it('khác nhau thì PASS', () => expect(status({}, 'env.webhook_secrets_distinct')).toBe('PASS'));
  });

  describe('AI tư vấn', () => {
    it('đủ URL và KEY → PASS', () => {
      expect(status({}, 'env.ai_advisor')).toBe('PASS');
    });
    it('thiếu một trong URL/KEY → WARN', () => {
      expect(status({ ANTIGRAVITY_GATEWAY_KEY: '' }, 'env.ai_advisor')).toBe('WARN');
      expect(status({ ANTIGRAVITY_GATEWAY_URL: '' }, 'env.ai_advisor')).toBe('WARN');
    });
    it('chưa provider nào → WARN (Mini App ẩn lối vào)', () => {
      expect(status({ ANTIGRAVITY_GATEWAY_URL: '', ANTIGRAVITY_GATEWAY_KEY: '' }, 'env.ai_advisor')).toBe('WARN');
    });
    it('tắt chủ ý bằng AI_ADVISOR_ENABLED=false → PASS dù chưa cấu hình', () => {
      expect(status({ AI_ADVISOR_ENABLED: 'false', ANTIGRAVITY_GATEWAY_URL: '', ANTIGRAVITY_GATEWAY_KEY: '' }, 'env.ai_advisor')).toBe('PASS');
    });
    it('AI_ADVISOR_PROVIDER chọn provider chưa đủ khoá → WARN', () => {
      expect(status({ AI_ADVISOR_PROVIDER: 'deepseek' }, 'env.ai_advisor')).toBe('WARN');
    });
  });
});
