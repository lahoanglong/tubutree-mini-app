import { envSchema } from '../env.validation';
import { isAdvisorEnabled, providerConfigured, resolveProviderOrder } from '../../modules/ai-advisor/advisor-config';
import { resolveOpsEmailConfig } from '../ops-email-config';
import { describeSecret, envValue, looksLikePlaceholder } from './secrets';
import { fail, pass, warn, type CheckResult, type Env } from './types';

const G_CORE = 'Cấu hình lõi';
const G_ZALO = 'Zalo';
const G_PANCAKE = 'Pancake';
const G_GOMDON = 'Gomdon';
const G_ZALOPAY = 'ZaloPay';
const G_AT = 'Accesstrade';
const G_IMG = 'Ảnh (Cloudinary)';
const G_OPS = 'Báo động vận hành';
const G_AI = 'AI tư vấn';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function coreChecks(env: Env): CheckResult[] {
  const out: CheckResult[] = [];

  const nodeEnv = envValue(env, 'NODE_ENV');
  out.push(
    nodeEnv === 'production'
      ? pass(G_CORE, 'env.node_env', 'NODE_ENV', 'production')
      : fail(G_CORE, 'env.node_env', 'NODE_ENV', `đang là "${nodeEnv || 'chưa đặt'}"`, 'Chạy trong container api (compose đặt NODE_ENV=production). Chạy ngoài container thì đặt NODE_ENV=production.'),
  );

  const parsed = envSchema.safeParse(env);
  if (parsed.success) {
    out.push(pass(G_CORE, 'env.schema', 'Bộ kiểm cấu hình lúc API khởi động', 'hợp lệ'));
  } else {
    const keys = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(chung)'))];
    out.push(
      fail(
        G_CORE,
        'env.schema',
        'Bộ kiểm cấu hình lúc API khởi động',
        `sai hoặc thiếu: ${keys.join(', ')}`,
        'Chạy `node dist/config/check-env.js` để xem từng lỗi, sửa .env (ops.yml, hành động set-env) rồi chạy lại.',
      ),
    );
  }

  out.push(databaseUrlCheck(env));
  out.push(jwtCheck(env, 'JWT_ACCESS_SECRET', 'env.jwt_access', 'Khoá JWT access'));
  out.push(jwtCheck(env, 'JWT_REFRESH_SECRET', 'env.jwt_refresh', 'Khoá JWT refresh'));
  const access = envValue(env, 'JWT_ACCESS_SECRET');
  const refresh = envValue(env, 'JWT_REFRESH_SECRET');
  if (access && refresh) {
    out.push(
      access === refresh
        ? fail(G_CORE, 'env.jwt_distinct', 'Hai khoá JWT khác nhau', 'access và refresh dùng chung một giá trị', 'Sinh hai chuỗi khác nhau: `openssl rand -base64 48` chạy hai lần.')
        : pass(G_CORE, 'env.jwt_distinct', 'Hai khoá JWT khác nhau', 'khác nhau'),
    );
  }
  out.push(corsCheck(env));
  out.push(cookieSameSiteCheck(env));
  out.push(cookieDomainCheck(env));
  out.push(throttleBypassCheck(env));
  out.push(webhookSecretsDistinct(env));
  return out;
}

function databaseUrlCheck(env: Env): CheckResult {
  const title = 'DATABASE_URL';
  const raw = envValue(env, 'DATABASE_URL');
  if (!raw) return fail(G_CORE, 'env.database_url', title, 'chưa đặt', 'Compose tự đặt DATABASE_URL cho api; chạy bên trong container api.');
  const u = parseUrl(raw);
  if (!u || !/^postgres(ql)?:$/.test(u.protocol)) {
    return fail(G_CORE, 'env.database_url', title, 'không đọc được (không in ra vì có mật khẩu)', 'Dạng đúng: postgresql://user:matkhau@host:5432/tenDB.');
  }
  const target = `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  if (LOCAL_HOSTS.has(u.hostname)) {
    return warn(G_CORE, 'env.database_url', title, `trỏ ${target}`, 'Trong container, host phải là tên service (postgres), không phải localhost.');
  }
  if (!u.searchParams.has('connection_limit')) {
    return warn(G_CORE, 'env.database_url', title, `trỏ ${target}, thiếu connection_limit`, 'Thêm ?connection_limit=20&pool_timeout=30 như docker-compose.vietnix.yml để không cạn pool Prisma khi đông.');
  }
  return pass(G_CORE, 'env.database_url', title, `trỏ ${target}`);
}

function jwtCheck(env: Env, key: string, id: string, title: string): CheckResult {
  const v = envValue(env, key);
  const sign = 'Sinh khoá mới bằng `openssl rand -base64 48` và đặt trong .env. Đổi khoá làm mọi phiên đăng nhập hết hạn, nên làm trước khi mở bán.';
  if (!v) return fail(G_CORE, id, title, `${key} chưa đặt`, sign);
  if (looksLikePlaceholder(v)) return fail(G_CORE, id, title, `${key} còn là giá trị mẫu`, sign);
  if (v.length < 16) return fail(G_CORE, id, title, `${key} ${describeSecret(v)}`, sign);
  if (v.length < 32) {
    // Khớp env.validation.ts: production không boot với khoá dưới 32 ký tự.
    const make = envValue(env, 'NODE_ENV') === 'production' ? fail : warn;
    return make(G_CORE, id, title, `${key} ${describeSecret(v)} (production đòi từ 32 ký tự)`, sign);
  }
  return pass(G_CORE, id, title, `${key} ${describeSecret(v)}`);
}

function corsCheck(env: Env): CheckResult {
  const title = 'CORS_ORIGINS';
  const list = envValue(env, 'CORS_ORIGINS')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (list.length === 0) {
    return fail(G_CORE, 'env.cors', title, 'rỗng', 'Đặt danh sách origin được phép, ví dụ https://app.tubutree.com,https://tubutree.com (cách nhau bằng dấu phẩy).');
  }
  const bad = list.filter((o) => o.includes('*') || o.endsWith('/') || !o.startsWith('https://') || LOCAL_HOSTS.has(parseUrl(o)?.hostname ?? ''));
  if (bad.length > 0) {
    return warn(
      G_CORE,
      'env.cors',
      title,
      `${list.length} origin, đáng ngờ: ${bad.join(', ')}`,
      'Origin phải so khớp chính xác: có https://, không có dấu / ở cuối, không có dấu *, không có localhost. Subdomain *.tubutree.com đã được code cho phép sẵn.',
    );
  }
  return pass(G_CORE, 'env.cors', title, `${list.length} origin: ${list.join(', ')}`);
}

function cookieSameSiteCheck(env: Env): CheckResult {
  const title = 'AUTH_COOKIE_SAMESITE';
  const v = envValue(env, 'AUTH_COOKIE_SAMESITE') || 'lax';
  if (v !== 'lax' && v !== 'strict' && v !== 'none') {
    return fail(G_CORE, 'env.cookie_samesite', title, `giá trị "${v}" không hợp lệ`, 'Chỉ nhận lax, strict hoặc none; web và API cùng domain gốc (tubutree.com) thì dùng lax.');
  }
  if (v === 'none') {
    return warn(G_CORE, 'env.cookie_samesite', title, 'none', 'None chỉ cần khi web và API khác domain gốc; cookie bắt buộc đi kèm https. Cùng domain gốc thì đặt lax.');
  }
  return pass(G_CORE, 'env.cookie_samesite', title, v);
}

function cookieDomainCheck(env: Env): CheckResult {
  const title = 'AUTH_COOKIE_DOMAIN';
  const v = envValue(env, 'AUTH_COOKIE_DOMAIN');
  if (!v) {
    return pass(G_CORE, 'env.cookie_domain', title, 'để trống: cookie gắn riêng host API (đúng khi web và API cùng domain gốc, xác nhận bằng đăng nhập thật)');
  }
  if (!/^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(v)) {
    return fail(G_CORE, 'env.cookie_domain', title, `"${v}" không phải tên miền cookie hợp lệ`, 'Chỉ tên miền, ví dụ .tubutree.com: không có https://, cổng hay đường dẫn.');
  }
  const bare = v.replace(/^\./, '').toLowerCase();
  const hosts = envValue(env, 'CORS_ORIGINS')
    .split(',')
    .map((o) => parseUrl(o.trim())?.hostname.toLowerCase())
    .filter((h): h is string => Boolean(h));
  if (hosts.length > 0 && !hosts.some((h) => h === bare || h.endsWith(`.${bare}`))) {
    return warn(G_CORE, 'env.cookie_domain', title, `${v} không khớp host nào trong CORS_ORIGINS`, 'Domain cookie phải là đuôi của host web (ví dụ .tubutree.com cho app.tubutree.com), nếu không trình duyệt bỏ cookie.');
  }
  return pass(G_CORE, 'env.cookie_domain', title, v);
}

function throttleBypassCheck(env: Env): CheckResult {
  const title = 'THROTTLE_BYPASS_TOKEN cho các lượt render phía máy chủ của web';
  const v = envValue(env, 'THROTTLE_BYPASS_TOKEN');
  if (!v) {
    return warn(
      G_CORE,
      'env.throttle_bypass',
      title,
      'chưa đặt: web render phía máy chủ đi ra từ một IP nên khi đông có thể dính giới hạn 300 yêu cầu/phút cho mỗi route (lỗi 429)',
      'Sinh bằng `openssl rand -hex 32`, đặt CÙNG một giá trị cho api và web trong .env rồi tạo lại hai container. Không thêm tiền tố NEXT_PUBLIC_ (xem docs/2026-10-review/impl/PA-2.md).',
    );
  }
  if (v.length < 32) {
    return fail(G_CORE, 'env.throttle_bypass', title, `${describeSecret(v)}, ngắn hơn 32 ký tự nên API không khởi động`, 'Dùng chuỗi dài ít nhất 32 ký tự: `openssl rand -hex 32`.');
  }
  return pass(G_CORE, 'env.throttle_bypass', title, describeSecret(v));
}

function secretRow(group: string, id: string, title: string, key: string, env: Env, missing: { status: 'FAIL' | 'WARN'; hint: string; note?: string }): CheckResult {
  const v = envValue(env, key);
  if (!v) {
    const make = missing.status === 'FAIL' ? fail : warn;
    return make(group, id, title, `${key} chưa đặt${missing.note ? `: ${missing.note}` : ''}`, missing.hint);
  }
  if (v.length < 16) {
    return warn(group, id, title, `${key} ${describeSecret(v)}`, 'Token webhook ngắn dễ đoán: sinh chuỗi dài hơn (`openssl rand -hex 32`) và dán lại đúng y hệt ở phía đối tác.');
  }
  return pass(group, id, title, `${key} ${describeSecret(v)}`);
}

function pancakeChecks(env: Env): CheckResult[] {
  const out: CheckResult[] = [];
  const missing = ['PANCAKE_API_KEY', 'PANCAKE_SHOP_ID'].filter((k) => !envValue(env, k));
  out.push(
    missing.length === 0
      ? pass(G_PANCAKE, 'env.pancake.credentials', 'Khoá API và mã shop Pancake', 'PANCAKE_API_KEY và PANCAKE_SHOP_ID đã đặt')
      : fail(G_PANCAKE, 'env.pancake.credentials', 'Khoá API và mã shop Pancake', `thiếu ${missing.join(', ')}`, 'Lấy ở Pancake POS (Cài đặt, Tích hợp, API) rồi đặt vào .env; thiếu thì đơn không bao giờ tới kho.'),
  );
  out.push(
    secretRow(G_PANCAKE, 'env.pancake.webhook_secret', 'Token webhook Pancake', 'PANCAKE_WEBHOOK_SECRET', env, {
      status: 'FAIL',
      hint: 'Đặt PANCAKE_WEBHOOK_SECRET và dán y hệt vào Pancake, Webhook, Request Headers, x-webhook-token.',
    }),
  );
  const base = envValue(env, 'PANCAKE_BASE_URL') || 'https://pos.pages.fm/api/v1';
  const u = parseUrl(base);
  out.push(
    u && u.protocol === 'https:'
      ? pass(G_PANCAKE, 'env.pancake.base_url', 'PANCAKE_BASE_URL', `host ${u.hostname}`)
      : fail(G_PANCAKE, 'env.pancake.base_url', 'PANCAKE_BASE_URL', 'không phải URL https hợp lệ', 'Để trống để dùng https://pos.pages.fm/api/v1.'),
  );
  return out;
}

function gomdonChecks(env: Env): CheckResult[] {
  const phone = envValue(env, 'GOMDON_PHONE');
  const password = envValue(env, 'GOMDON_PASSWORD');
  const title = 'Tài khoản Gomdon (Thu kèm đơn)';
  const out: CheckResult[] = [];
  if (!phone && !password) {
    out.push(
      warn(G_GOMDON, 'env.gomdon.credentials', title, 'GOMDON_PHONE và GOMDON_PASSWORD chưa đặt', 'Chưa đặt thì cách Thu kèm đơn không mở được cho khách. Không mở tính năng này lúc đầu thì bỏ qua.'),
    );
  } else if (!phone || !password) {
    out.push(fail(G_GOMDON, 'env.gomdon.credentials', title, 'chỉ đặt một trong GOMDON_PHONE và GOMDON_PASSWORD', 'Đặt đủ cả hai hoặc xoá cả hai.'));
  } else {
    out.push(pass(G_GOMDON, 'env.gomdon.credentials', title, 'GOMDON_PHONE và GOMDON_PASSWORD đã đặt'));
  }
  const hasAccount = Boolean(phone && password);
  out.push(
    secretRow(G_GOMDON, 'env.gomdon.webhook_secret', 'Token webhook Gomdon', 'GOMDON_WEBHOOK_SECRET', env, {
      status: hasAccount ? 'FAIL' : 'WARN',
      note: hasAccount ? 'đã có tài khoản nên bắt buộc' : undefined,
      hint: 'Đặt GOMDON_WEBHOOK_SECRET và đưa cho Gomdon (header x-webhook-token hoặc đường dẫn /api/webhooks/gomdon/<token>); thiếu thì mọi webhook bị từ chối 401 và đơn thu gom không tự cập nhật.',
    }),
  );
  const baseRaw = envValue(env, 'GOMDON_BASE_URL');
  if (baseRaw) {
    const u = parseUrl(baseRaw);
    out.push(
      u && u.protocol === 'https:'
        ? pass(G_GOMDON, 'env.gomdon.base_url', 'GOMDON_BASE_URL', `host ${u.hostname}`)
        : fail(G_GOMDON, 'env.gomdon.base_url', 'GOMDON_BASE_URL', 'không phải URL https hợp lệ', 'Để trống ở production để dùng https://admin.gomdon.com.vn.'),
    );
  }
  return out;
}

function zalopayChecks(env: Env): CheckResult[] {
  const title = 'Merchant ZaloPay';
  const set = ['ZALOPAY_APP_ID', 'ZALOPAY_KEY1', 'ZALOPAY_KEY2'].filter((k) => envValue(env, k));
  if (set.length === 0) {
    return [
      warn(
        G_ZALOPAY,
        'env.zalopay',
        title,
        'chưa đặt ZALOPAY_APP_ID, ZALOPAY_KEY1, ZALOPAY_KEY2',
        'Cả hai app hiện ẩn ZaloPay (chỉ COD, chuyển khoản, Ví) nên không chặn mở bán. Chỉ cấu hình khi chủ shop quyết định bật ZaloPay.',
      ),
    ];
  }
  if (set.length < 3) {
    return [fail(G_ZALOPAY, 'env.zalopay', title, `chỉ có ${set.join(', ')}`, 'Đặt đủ ZALOPAY_APP_ID, ZALOPAY_KEY1, ZALOPAY_KEY2 hoặc xoá hết.')];
  }
  const endpoint = envValue(env, 'ZALOPAY_ENDPOINT') || 'https://sb-openapi.zalopay.vn/v2';
  if (/sb-openapi|sandbox/i.test(endpoint)) {
    return [warn(G_ZALOPAY, 'env.zalopay', title, 'khoá đã đặt nhưng ZALOPAY_ENDPOINT đang là sandbox', 'Production dùng https://openapi.zalopay.vn/v2 cùng bộ khoá production.')];
  }
  return [pass(G_ZALOPAY, 'env.zalopay', title, 'khoá đã đặt, endpoint không phải sandbox')];
}

/** Bằng `appId` trong apps/miniapp/app-config.json (spec so khớp); image api không có apps/miniapp nên phải có hằng số. */
export const PRODUCTION_MINIAPP_ID = '2070857098114207963';

function zaloChecks(env: Env): CheckResult[] {
  const out: CheckResult[] = [];
  const loginMissing = ['ZALO_APP_ID', 'ZALO_APP_SECRET'].filter((k) => !envValue(env, k));
  const loginTitle = 'Zalo App (app id và secret)';
  out.push(
    loginMissing.length === 0
      ? pass(G_ZALO, 'env.zalo.login', loginTitle, 'ZALO_APP_ID và ZALO_APP_SECRET đã đặt')
      : fail(
          G_ZALO,
          'env.zalo.login',
          loginTitle,
          `thiếu ${loginMissing.join(', ')}`,
          'Lấy ở developers.zalo.me, mục Ứng dụng. Đăng nhập trong Mini App chỉ dùng token của khách nên vẫn chạy khi thiếu; secret cần cho lấy số điện thoại (/me/info), vị trí, đăng nhập Zalo trên web (đổi mã OAuth) và làm mới token OA.',
        ),
  );
  const appId = envValue(env, 'ZALO_APP_ID');
  const miniAppId = envValue(env, 'ZALO_MINIAPP_ID');
  const idsTitle = 'ZALO_APP_ID khác ID Mini App';
  const idsHint = 'ZALO_APP_ID phải là App ID của Zalo App trên developers.zalo.me (đăng nhập web, làm mới token OA). ID Mini App chỉ dùng cho link zalo.me/s/<id>; để chung thì Zalo trả "Invalid appId".';
  // Thử trên giá trị thô: API đọc env nguyên văn (không trim), nên khoảng trắng thừa làm Zalo từ chối dù envValue đã cắt.
  const nonNumeric = ['ZALO_APP_ID', 'ZALO_MINIAPP_ID'].filter((k) => {
    const raw = env[k] ?? '';
    return raw !== '' && !/^[0-9]+$/.test(raw);
  });
  if (nonNumeric.length > 0) {
    out.push(fail(G_ZALO, 'env.zalo.ids', idsTitle, `${nonNumeric.join(', ')} không phải chuỗi số`, 'ID của Zalo chỉ gồm chữ số; kiểm tra lỗi gõ nhầm hoặc dán thừa khoảng trắng, dấu nháy.'));
  } else if (appId && (appId === miniAppId || appId === PRODUCTION_MINIAPP_ID)) {
    out.push(fail(G_ZALO, 'env.zalo.ids', idsTitle, appId === miniAppId ? 'ZALO_APP_ID trùng ZALO_MINIAPP_ID' : 'ZALO_APP_ID đang là Mini App ID', idsHint));
  } else if (!miniAppId) {
    out.push(warn(G_ZALO, 'env.zalo.ids', idsTitle, 'chưa đặt ZALO_MINIAPP_ID nên không so được', 'Đặt ZALO_MINIAPP_ID là ID Mini App (apps/miniapp/app-config.json) để build web dựng được link zalo.me/s/<id> và để kiểm tra này chạy.'));
  } else if (miniAppId !== PRODUCTION_MINIAPP_ID) {
    out.push(warn(G_ZALO, 'env.zalo.ids', idsTitle, `ZALO_MINIAPP_ID (${miniAppId}) khác Mini App production (${PRODUCTION_MINIAPP_ID})`, 'Đúng nếu đây là môi trường thử dùng Mini App riêng; ở production phải là ID trong apps/miniapp/app-config.json.'));
  } else {
    out.push(pass(G_ZALO, 'env.zalo.ids', idsTitle, 'ZALO_APP_ID và ZALO_MINIAPP_ID là hai giá trị khác nhau'));
  }
  const oa = ['ZALO_OA_ACCESS_TOKEN', 'ZALO_OA_REFRESH_TOKEN', 'ZALO_OA_ID'].filter((k) => envValue(env, k));
  const zns = 'Zalo OA cho tin ZNS';
  if (oa.length === 0) {
    out.push(warn(G_ZALO, 'env.zalo.oa', zns, 'chưa đặt token và ID của OA', 'Chưa có thì ZNS không gửi được, khách chỉ nhận thông báo trong app.'));
  } else if (oa.length < 3) {
    const lack = ['ZALO_OA_ACCESS_TOKEN', 'ZALO_OA_REFRESH_TOKEN', 'ZALO_OA_ID'].filter((k) => !envValue(env, k));
    out.push(warn(G_ZALO, 'env.zalo.oa', zns, `thiếu ${lack.join(', ')}`, 'Token OA tự xoay mỗi 6 giờ nhờ refresh token; đặt đủ cả ba để lần khởi động đầu có token hợp lệ.'));
  } else {
    out.push(pass(G_ZALO, 'env.zalo.oa', zns, 'token truy cập, refresh và OA ID đã đặt'));
  }
  out.push(
    secretRow(G_ZALO, 'env.zalo.oa_webhook_secret', 'Token webhook OA Zalo (CSKH)', 'ZALO_OA_WEBHOOK_SECRET', env, {
      status: 'WARN',
      hint: 'Chỉ cần khi đã đăng ký webhook OA trên Zalo; để trống thì API từ chối mọi request tới webhook này ở production.',
    }),
  );
  return out;
}

function accesstradeChecks(env: Env): CheckResult[] {
  const out: CheckResult[] = [];
  out.push(
    secretRow(G_AT, 'env.accesstrade.webhook_secret', 'Token webhook Accesstrade', 'ACCESSTRADE_WEBHOOK_SECRET', env, {
      status: 'FAIL',
      hint: 'Production bắt buộc có token này để không ai tự duyệt cashback giả; đặt và đưa cho Accesstrade.',
    }),
  );
  const lack = ['ACCESSTRADE_TOKEN', 'ACCESSTRADE_PUBLISHER_ID'].filter((k) => !envValue(env, k));
  out.push(
    lack.length === 0
      ? pass(G_AT, 'env.accesstrade.api', 'Khoá API Accesstrade', 'token và publisher id đã đặt')
      : warn(G_AT, 'env.accesstrade.api', 'Khoá API Accesstrade', `thiếu ${lack.join(', ')}`, 'Thiếu thì không kéo được đơn cashback từ Accesstrade; bỏ qua nếu chưa chạy cashback.'),
  );
  return out;
}

function cloudinaryChecks(env: Env): CheckResult[] {
  const title = 'Cloudinary (ảnh tải lên)';
  const set = ['VITE_CLOUDINARY_CLOUD_NAME', 'VITE_CLOUDINARY_UPLOAD_PRESET'].filter((k) => envValue(env, k));
  if (set.length === 1) {
    return [fail(G_IMG, 'env.cloudinary', title, `chỉ đặt ${set[0]}`, 'Đặt cả VITE_CLOUDINARY_CLOUD_NAME và VITE_CLOUDINARY_UPLOAD_PRESET khi build Mini App.')];
  }
  if (set.length === 2) return [pass(G_IMG, 'env.cloudinary', title, 'cloud name và upload preset đã đặt')];
  return [
    warn(
      G_IMG,
      'env.cloudinary',
      title,
      'không kiểm được từ server: API không đọc khoá Cloudinary, ảnh được Mini App tải thẳng lên Cloudinary',
      'Mở file cấu hình build của Mini App và xác nhận có VITE_CLOUDINARY_CLOUD_NAME và VITE_CLOUDINARY_UPLOAD_PRESET (unsigned preset). Thiếu thì ảnh đánh giá và minh chứng rơi về ảnh nén base64.',
    ),
  ];
}

function aiChecks(env: Env): CheckResult[] {
  const title = 'AI tư vấn (Antigravity gateway)';
  const get = (k: string) => envValue(env, k);
  if (!isAdvisorEnabled(get)) {
    return [pass(G_AI, 'env.ai_advisor', title, 'AI_ADVISOR_ENABLED đang tắt: Mini App ẩn lối vào AI')];
  }
  const half = ['ANTIGRAVITY_GATEWAY_URL', 'ANTIGRAVITY_GATEWAY_KEY'].filter((k) => !get(k));
  if (half.length === 1) {
    return [warn(G_AI, 'env.ai_advisor', title, `thiếu ${half[0]}`, 'Đặt đủ ANTIGRAVITY_GATEWAY_URL và ANTIGRAVITY_GATEWAY_KEY hoặc xoá cả hai; thiếu một thì gateway không được dùng.')];
  }
  if (resolveProviderOrder(get).length === 0) {
    const picked = get('AI_ADVISOR_PROVIDER');
    const why = picked && !providerConfigured(get, picked as 'antigravity' | 'deepseek' | 'gemini') ? `AI_ADVISOR_PROVIDER=${picked} nhưng provider đó chưa đủ khoá` : 'chưa có provider nào';
    return [warn(G_AI, 'env.ai_advisor', title, `${why}: Mini App sẽ ẩn lối vào AI`, 'Chủ ý chưa bật AI thì bỏ qua. Muốn bật: đặt ANTIGRAVITY_GATEWAY_URL và ANTIGRAVITY_GATEWAY_KEY (runbook mục AI), chạy thử 20 câu hỏi thật rồi mới mở.')];
  }
  return [pass(G_AI, 'env.ai_advisor', title, `provider dùng: ${resolveProviderOrder(get).join(' > ')}`)];
}

function opsChecks(env: Env): CheckResult[] {
  const out: CheckResult[] = [];

  const hookRaw = envValue(env, 'OPS_ALERT_WEBHOOK_URL');
  let hookOn = false;
  if (!hookRaw) {
    out.push(warn(G_OPS, 'env.ops.webhook', 'Webhook báo động (Slack, Google Chat, n8n)', 'OPS_ALERT_WEBHOOK_URL chưa đặt', 'Chưa đặt thì báo động chỉ hiện trong màn Sức khoẻ hệ thống; xem docs/GO-LIVE-KEYS.md mục 8.'));
  } else {
    const u = parseUrl(hookRaw);
    if (!u) {
      out.push(fail(G_OPS, 'env.ops.webhook', 'Webhook báo động (Slack, Google Chat, n8n)', 'không phải URL hợp lệ (không in ra vì chứa token)', 'Dán lại URL webhook đầy đủ, bắt đầu bằng https://.'));
    } else if (u.protocol !== 'https:') {
      out.push(warn(G_OPS, 'env.ops.webhook', 'Webhook báo động (Slack, Google Chat, n8n)', `host ${u.hostname}, không dùng https`, 'Dùng URL https để token trong đường dẫn không đi trần trên mạng.'));
      hookOn = true;
    } else {
      out.push(pass(G_OPS, 'env.ops.webhook', 'Webhook báo động (Slack, Google Chat, n8n)', `host ${u.hostname}`));
      hookOn = true;
    }
  }

  const email = resolveOpsEmailConfig(env);
  const emailTitle = 'Email báo động (SMTP)';
  let emailOn = false;
  if (email.state === 'disabled') {
    out.push(warn(G_OPS, 'env.ops.email', emailTitle, 'cả bảy biến OPS_ALERT_EMAIL_TO và SMTP_* đều trống', 'Muốn nhận báo động qua email thì đặt OPS_ALERT_EMAIL_TO, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM (xem docs/GO-LIVE-KEYS.md mục 8).'));
  } else if (email.state === 'misconfigured') {
    out.push(fail(G_OPS, 'env.ops.email', emailTitle, email.issues.map((i) => i.message).join(' | '), 'Đặt đủ và đúng cả bảy biến hoặc để trống cả bảy; API không khởi động được khi đặt dở dang.'));
  } else {
    emailOn = true;
    out.push(
      pass(
        G_OPS,
        'env.ops.email',
        emailTitle,
        `${email.recipients.length} người nhận, gửi qua ${email.smtp.host}:${email.smtp.port}${email.smtp.secure ? ' (TLS)' : ''}, ${email.smtp.auth ? 'có tài khoản SMTP' : 'không đăng nhập SMTP'}`,
      ),
    );
  }

  if (!hookOn && !emailOn) {
    out.push(warn(G_OPS, 'env.ops.channels', 'Có ít nhất một kênh báo động ra ngoài', 'không có webhook lẫn email', 'Nên bật ít nhất một kênh để người trực biết ngay khi đơn kẹt; nếu không, phải có người mở màn Sức khoẻ hệ thống liên tục.'));
  } else {
    out.push(pass(G_OPS, 'env.ops.channels', 'Có ít nhất một kênh báo động ra ngoài', [hookOn ? 'webhook' : '', emailOn ? 'email' : ''].filter(Boolean).join(' và ')));
  }

  const label = envValue(env, 'OPS_ALERT_ENV_LABEL');
  if (hookOn || emailOn) {
    out.push(
      label
        ? pass(G_OPS, 'env.ops.label', 'Nhãn môi trường trong tiêu đề báo động', `"${label}"`)
        : warn(G_OPS, 'env.ops.label', 'Nhãn môi trường trong tiêu đề báo động', 'OPS_ALERT_ENV_LABEL chưa đặt', 'Đặt OPS_ALERT_ENV_LABEL=production (biến Repository variable trên GitHub) để email prod không lẫn với staging.'),
    );
  }
  return out;
}

function webhookSecretsDistinct(env: Env): CheckResult {
  const keys = ['PANCAKE_WEBHOOK_SECRET', 'GOMDON_WEBHOOK_SECRET', 'ACCESSTRADE_WEBHOOK_SECRET', 'ZALO_OA_WEBHOOK_SECRET'];
  const seen = new Map<string, string>();
  const dup: string[] = [];
  for (const k of keys) {
    const v = envValue(env, k);
    if (!v) continue;
    const other = seen.get(v);
    if (other) dup.push(`${other} và ${k}`);
    else seen.set(v, k);
  }
  return dup.length === 0
    ? pass(G_CORE, 'env.webhook_secrets_distinct', 'Các token webhook khác nhau', 'không có hai token trùng nhau')
    : warn(G_CORE, 'env.webhook_secrets_distinct', 'Các token webhook khác nhau', `trùng nhau: ${dup.join('; ')}`, 'Mỗi đối tác một token riêng, để lộ một cái không mở được cổng của cái khác.');
}

/** Kiểm biến môi trường theo từng tính năng. Chỉ nói đã đặt hay chưa, không bao giờ in giá trị bí mật. */
export function evaluateEnv(env: Env): CheckResult[] {
  return [
    ...coreChecks(env),
    ...zaloChecks(env),
    ...pancakeChecks(env),
    ...gomdonChecks(env),
    ...zalopayChecks(env),
    ...accesstradeChecks(env),
    ...cloudinaryChecks(env),
    ...aiChecks(env),
    ...opsChecks(env),
  ];
}
