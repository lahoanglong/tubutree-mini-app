#!/usr/bin/env node
/**
 * Kiểm hồ sơ gửi duyệt Zalo Mini App, chạy trước mỗi lần tải bản lên Testing hoặc gửi duyệt Live:
 *   node scripts/zalo-review/check-submission.mjs [--json]
 *
 * Bốn nhóm, đúng những lý do Zalo hay trả hồ sơ:
 * - Quyền: scope khai trong apps/miniapp/zalo-permissions.json khớp đúng các API zmp-sdk cần quyền mà mã nguồn gọi (không thiếu, không thừa),
 *   mọi API zmp-sdk khác có lý do, và API cần quyền chỉ được gọi trong services/zmp-bridge.ts.
 * - Pháp lý: mọi chính sách Mini App mở được là một slug của legal-core.ts, trang Về Tubu Tree mở đủ năm chính sách đúng tên, thanh toán có
 *   Điều khoản và Bảo mật, link chính sách điền trên console có trang web thật.
 * - Xoá tài khoản: đi được từ tab Cá nhân tới nút gửi yêu cầu xoá, và API có route nhận yêu cầu cùng webhook rút đồng ý của Zalo.
 * - Thanh toán: không có link cổng thanh toán ngoài, đường dẫn mở app ngoài, window.open hay đổi location ngoài zmp-bridge.ts; Mini App chỉ cho
 *   COD, chuyển khoản, Ví; cổng web không dẫn tới trang thanh toán web.
 *
 * Đọc mã nguồn bằng bộ phân tích của TypeScript nên chữ trong chú thích không tính. Không gọi mạng, không ghi tệp.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const MINI_SRC = 'apps/miniapp/src';

export const FILES = {
  appConfig: 'apps/miniapp/app-config.json',
  permissions: 'apps/miniapp/zalo-permissions.json',
  bridge: 'apps/miniapp/src/services/zmp-bridge.ts',
  legalCore: 'packages/app-core/src/legal-core.ts',
  webPolicy: 'apps/miniapp/src/utils/web-policy.ts',
  about: 'apps/miniapp/src/pages/about.tsx',
  checkout: 'apps/miniapp/src/pages/checkout.tsx',
  webLegalPage: 'apps/web/src/app/chinh-sach/[loai]/page.tsx',
  appRoutes: 'apps/miniapp/src/components/app.tsx',
  navConfig: 'apps/miniapp/src/components/nav-config.ts',
  profileMenu: 'packages/app-core/src/profile-menu.ts',
  settings: 'apps/miniapp/src/pages/settings.tsx',
  deletionSection: 'apps/miniapp/src/components/account-deletion-section.tsx',
  accountApiCore: 'packages/app-core/src/api/account.ts',
  usersController: 'apps/api/src/modules/users/users.controller.ts',
  consentWebhook: 'apps/api/src/modules/users/zalo-consent-webhook.controller.ts',
  checkoutRules: 'apps/miniapp/src/utils/checkout-rules.ts',
  webPortalScreens: 'apps/miniapp/src/pages/web-portal-screens.ts',
};

/** Bảng scope của `authorize` trong zmp-sdk 2.51.4 (apis/index.d.ts): gọi API nào thì Zalo hỏi khách scope nào. */
export const SCOPE_OF_API = {
  getPhoneNumber: 'scope.userPhonenumber',
  getLocation: 'scope.userLocation',
  getUserInfo: 'scope.userInfo',
  createCameraContext: 'scope.camera',
};
/** Hai API nhận danh sách scope dạng chuỗi: scope nào viết trong tệp gọi chúng thì tính là có dùng. */
const SCOPE_LIST_APIS = new Set(['authorize', 'getSetting']);

/** Tên miền được phép xuất hiện trong mã Mini App, kèm lý do. Tên miền mới phải thêm vào đây sau khi chắc nó không phải trang thanh toán. */
export const ALLOWED_HOSTS = {
  'zalo.me': 'chat và OA Zalo',
  'oa.zalo.me': 'trang OA Zalo',
  'tubutree.com': 'cổng web của shop cho quản trị, đối tác, nhân sự',
  'app.tubutree.com': 'link chia sẻ sản phẩm và link mời',
  'api.tubutree.com': 'API của shop',
  'api.cloudinary.com': 'tải ảnh khách chụp lên',
  'img.vietqr.io': 'ảnh mã VietQR của đơn, khách tự chuyển khoản bằng app ngân hàng của mình',
  'www.w3.org': 'namespace SVG',
  localhost: 'chạy thử trên máy dev',
  '127.0.0.1': 'chạy thử trên máy dev',
};

/** Cổng và ví thanh toán (khớp cả tên miền con). `dl.vietqr.io` là trang chọn app ngân hàng để trả tiền. */
export const PAYMENT_HOSTS = [
  'momo.vn',
  'vnpay.vn',
  'vnpayment.vn',
  'zalopay.vn',
  'zalopay.com.vn',
  'payos.vn',
  'onepay.vn',
  'nganluong.vn',
  'baokim.vn',
  'shopeepay.vn',
  'airpay.vn',
  'viettelmoney.vn',
  'viettelpay.vn',
  'vimo.vn',
  '9pay.vn',
  'appotapay.com',
  'payoo.vn',
  'paypal.com',
  'stripe.com',
  'dl.vietqr.io',
];

/** Cách thanh toán Mini App được cho chọn ngày mở bán: đều trả trong app hoặc khi nhận hàng, không chuyển sang trang ngoài. */
export const ALLOWED_PAYMENT_METHODS = ['COD', 'BANK_TRANSFER', 'WALLET'];
/** Trang mua hàng của web: cổng web trong Mini App không được dẫn khách tới đây. */
export const WEB_SHOPPING_PATHS = ['/thanh-toan', '/gio-hang'];
/** Host `openWebview` được gọi thẳng ngoài zmp-bridge.ts (link viết sẵn trong mã). */
const DIRECT_WEBVIEW_HOSTS = new Set(['zalo.me', 'oa.zalo.me']);
const short = (path) => path.replace(`${MINI_SRC}/`, '');

/** Tệp đi vào gói Mini App: bỏ spec, tệp hỗ trợ test, dữ liệu giả. */
export function isShippedSource(path) {
  if (!/\.(ts|tsx)$/.test(path) || /\.d\.ts$/.test(path)) return false;
  if (/\.(spec|test)\.tsx?$/.test(path)) return false;
  if (/(^|\/)(test|tests|test-support|__tests__|__mocks__)\//.test(path)) return false;
  if (/(^|\/)vitest[^/]*\.tsx?$/.test(path) || /fixtures?\.tsx?$/.test(path)) return false;
  return true;
}

function parse(path, source) {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const isZmpSdk = (spec) => /^zmp-sdk(\/|$)/.test(spec);

function unwrap(node) {
  let n = node;
  while (n && (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isParenthesizedExpression(n) || ts.isTypeAssertionExpression(n))) n = n.expression;
  return n;
}

function findConst(sf, name) {
  let found = null;
  walk(sf, (n) => {
    if (!found && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) found = unwrap(n.initializer);
  });
  return found;
}

const stringItems = (node) => (node && ts.isArrayLiteralExpression(node) ? node.elements.filter(ts.isStringLiteralLike).map((e) => e.text) : null);
const propName = (p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : null);

/** Mọi API zmp-sdk một tệp import (bỏ import kiểu), và các kiểu import không kiểm được (`* as`, mặc định, động, require). */
export function sdkImports(path, source) {
  const sf = parse(path, source);
  const named = [];
  const opaque = [];
  const addNamed = (elements) => {
    for (const el of elements) {
      if (el.isTypeOnly) continue;
      named.push({ api: (el.propertyName ?? el.name).text, line: lineOf(sf, el) });
    }
  };
  walk(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && isZmpSdk(n.moduleSpecifier.text)) {
      const clause = n.importClause;
      if (!clause || clause.isTypeOnly) return;
      if (clause.name) opaque.push({ kind: 'import mặc định', line: lineOf(sf, n) });
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) opaque.push({ kind: 'import * as', line: lineOf(sf, n) });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) addNamed(clause.namedBindings.elements);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && isZmpSdk(n.moduleSpecifier.text)) {
      if (n.isTypeOnly) return;
      if (!n.exportClause || ts.isNamespaceExport(n.exportClause)) opaque.push({ kind: 'export *', line: lineOf(sf, n) });
      else addNamed(n.exportClause.elements);
    } else if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0]) && isZmpSdk(n.arguments[0].text)) {
      const dynamic = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(n.expression) && n.expression.text === 'require';
      if (dynamic || required) opaque.push({ kind: dynamic ? 'import()' : 'require', line: lineOf(sf, n) });
    }
  });
  return { named, opaque, sf };
}

/** Chuỗi `scope.x` viết trong tệp (cho authorize/getSetting) và chỗ đọc `navigator.geolocation`. */
function scopeHints(sf) {
  const literals = [];
  let geolocation = null;
  walk(sf, (n) => {
    if (ts.isStringLiteralLike(n) && /^scope\.\w+$/.test(n.text)) literals.push(n.text);
    if (!geolocation && ts.isPropertyAccessExpression(n) && n.name.text === 'geolocation' && ts.isIdentifier(n.expression) && n.expression.text === 'navigator') {
      geolocation = lineOf(sf, n);
    }
  });
  return { literals, geolocation };
}

function hostIsPayment(host) {
  return PAYMENT_HOSTS.some((p) => host === p || host.endsWith(`.${p}`));
}

/** Đoạn chữ của mọi chuỗi và template trong tệp (chú thích, chữ JSX và regex không tính). */
function stringPieces(sf) {
  const out = [];
  walk(sf, (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      out.push({ text: n.text, line: lineOf(sf, n) });
    }
  });
  return out;
}

const URL_RE = /\b([a-z][a-z0-9+.-]*):\/\/([^\s'"`/?#:)\\]*)([^\s'"`?#)\\]*)/gi;

/** Link ngoài trong một tệp Mini App: cổng thanh toán, tên miền chưa duyệt, đường dẫn mở app ngoài, trang mua hàng của web. */
export function linkFindings(path, sf) {
  const found = [];
  for (const { text, line } of stringPieces(sf)) {
    for (const m of text.matchAll(URL_RE)) {
      const scheme = m[1].toLowerCase();
      const host = m[2].toLowerCase();
      const at = `${short(path)}:${line}`;
      if (scheme !== 'http' && scheme !== 'https') {
        found.push(`${at}: đường dẫn mở app ngoài "${scheme}://"`);
        continue;
      }
      if (!host) continue;
      if (hostIsPayment(host)) found.push(`${at}: link cổng thanh toán ngoài ${host}`);
      else if (!Object.hasOwn(ALLOWED_HOSTS, host)) found.push(`${at}: tên miền chưa duyệt ${host} (không phải trang thanh toán thì thêm vào ALLOWED_HOSTS kèm lý do)`);
      else if ((host === 'tubutree.com' || host === 'app.tubutree.com') && WEB_SHOPPING_PATHS.some((p) => m[3] === p || m[3].startsWith(`${p}/`))) {
        found.push(`${at}: link tới trang mua hàng của web ${host}${m[3]}`);
      }
    }
  }
  return found;
}

/** `window.open`, ghi `location`/`location.href`, và `openWebview` gọi thẳng với link không phải Zalo viết sẵn. */
export function navigationFindings(path, sf) {
  const found = [];
  const isBridge = path === FILES.bridge;
  walk(sf, (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'open' && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'window') {
      found.push(`${short(path)}:${lineOf(sf, n)}: window.open mở trang ngoài Mini App`);
    }
    if (!isBridge && ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = n.left.getText(sf).replace(/\s+/g, '');
      if (/(^|\.)location(\.href)?$/.test(left)) found.push(`${short(path)}:${lineOf(sf, n)}: ghi ${left} ngoài zmp-bridge.ts`);
    }
    if (!isBridge && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'openWebview') {
      const arg = n.arguments[0];
      const urlProp = arg && ts.isObjectLiteralExpression(arg) ? arg.properties.find((p) => ts.isPropertyAssignment(p) && propName(p) === 'url') : undefined;
      const value = urlProp ? urlProp.initializer : undefined;
      const literal = value && (ts.isStringLiteralLike(value) ? value.text : ts.isTemplateExpression(value) ? value.head.text : null);
      const m = literal ? /^https:\/\/([^/?#:]+)\//.exec(literal) : null;
      const host = m ? m[1].toLowerCase() : null;
      if (!host || !DIRECT_WEBVIEW_HOSTS.has(host)) {
        found.push(`${short(path)}:${lineOf(sf, n)}: openWebview ngoài zmp-bridge.ts phải là link https://zalo.me/ hoặc https://oa.zalo.me/ viết sẵn`);
      }
    }
  });
  return found;
}

/** Slug chính sách mở bằng chuỗi viết sẵn: `setPolicy('x')`, `setPolicySlug('x')`, `openPolicy('x')`, `<PolicySheet slug="x">`. */
export function policySlugCalls(sf) {
  const out = [];
  walk(sf, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^(set|open|onOpen)(Policy|Legal)\w*$/.test(n.expression.text)) {
      const arg = n.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) out.push({ slug: arg.text, line: lineOf(sf, n), node: n });
    }
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === 'slug' && n.initializer && ts.isStringLiteral(n.initializer)) {
      const tag = n.parent.parent;
      if ((ts.isJsxSelfClosingElement(tag) || ts.isJsxOpeningElement(tag)) && tag.tagName.getText(sf) === 'PolicySheet') {
        out.push({ slug: n.initializer.text, line: lineOf(sf, n), node: n });
      }
    }
  });
  return out;
}

/** Dòng mở chính sách của trang Về Tubu Tree: slug và chữ `label` cùng phần tử JSX (nếu có). */
function policyRows(sf) {
  return policySlugCalls(sf).map(({ slug, node }) => {
    let el = node.parent;
    while (el && !ts.isJsxSelfClosingElement(el) && !ts.isJsxOpeningElement(el)) el = el.parent;
    const label = el?.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'label');
    return { slug, label: label && label.initializer && ts.isStringLiteral(label.initializer) ? label.initializer.text : null };
  });
}

function legalCore(source) {
  const sf = parse(FILES.legalCore, source);
  const slugs = stringItems(findConst(sf, 'LEGAL_SLUGS')) ?? [];
  const titles = {};
  const pages = findConst(sf, 'LEGAL_PAGES');
  if (pages && ts.isObjectLiteralExpression(pages)) {
    for (const p of pages.properties) {
      if (!ts.isPropertyAssignment(p) || !ts.isObjectLiteralExpression(p.initializer)) continue;
      const title = p.initializer.properties.find((q) => ts.isPropertyAssignment(q) && propName(q) === 'title');
      if (title && ts.isStringLiteralLike(title.initializer)) titles[propName(p)] = title.initializer.text;
    }
  }
  return { slugs, titles };
}

function readJson(text) {
  try {
    return JSON.parse(text ?? 'null');
  } catch {
    return null;
  }
}

/**
 * Chạy mọi mục kiểm. `files.read(path)` trả nội dung hoặc null khi không có tệp; `files.list(dir)` trả mọi tệp dưới `dir` (đường dẫn tính từ gốc repo).
 * Trả danh sách mục, mỗi mục đạt hoặc không kèm lời giải thích; thiếu tệp là mục không đạt, không ném lỗi.
 */
export function checkSubmission(files) {
  const checks = [];
  const add = (group, id, ok, detail) => checks.push({ group, id, ok: Boolean(ok), detail });
  const read = (p) => files.read(p);
  const sources = files
    .list(MINI_SRC)
    .filter(isShippedSource)
    .sort()
    .map((path) => {
      const source = read(path) ?? '';
      return { path, source, sf: parse(path, source) };
    });

  // ---------- Quyền ----------
  const G1 = 'Quyền';
  const manifest = readJson(read(FILES.permissions));
  const declared = manifest && typeof manifest.scopes === 'object' && manifest.scopes ? manifest.scopes : null;
  const noScope = manifest && typeof manifest.noScopeApis === 'object' && manifest.noScopeApis ? manifest.noScopeApis : null;
  add(
    G1,
    'perm.manifest',
    declared && noScope,
    declared && noScope ? `${FILES.permissions}: ${Object.keys(declared).length} scope, ${Object.keys(noScope).length} API không cần quyền` : `${FILES.permissions} thiếu hoặc không có "scopes"/"noScopeApis"`,
  );

  const appConfig = readJson(read(FILES.appConfig));
  const app = appConfig?.app ?? {};
  const externalAssets = ['listCSS', 'listSyncCSS', 'listJS', 'listSyncJS', 'listAsyncJS']
    .flatMap((k) => (Array.isArray(appConfig?.[k]) ? appConfig[k] : []))
    .filter((v) => typeof v === 'string' && v.includes('://'));
  const configOk = typeof app.appId === 'string' && /^\d+$/.test(app.appId) && typeof app.title === 'string' && app.title.trim() !== '' && externalAssets.length === 0;
  add(
    G1,
    'perm.app-config',
    configOk,
    configOk
      ? `app-config.json: appId ${app.appId}, tiêu đề "${app.title}", không nạp CSS/JS từ ngoài`
      : `app-config.json thiếu appId số hoặc tiêu đề, hoặc nạp tài nguyên ngoài: ${externalAssets.join(', ') || '(không đọc được)'}`,
  );

  const usedScopes = new Map();
  const markScope = (scope, where) => {
    if (!usedScopes.has(scope)) usedScopes.set(scope, []);
    usedScopes.get(scope).push(where);
  };
  const imported = new Map();
  const opaque = [];
  const outsideBridge = [];
  for (const { path, source } of sources) {
    const { named, opaque: odd, sf } = sdkImports(path, source);
    for (const o of odd) opaque.push(`${short(path)}:${o.line}: ${o.kind} từ zmp-sdk`);
    let listsScopes = false;
    for (const { api, line } of named) {
      const where = `${short(path)}:${line}`;
      if (!imported.has(api)) imported.set(api, []);
      imported.get(api).push(where);
      const scope = SCOPE_OF_API[api];
      if (scope) markScope(scope, `${api} ở ${where}`);
      if (SCOPE_LIST_APIS.has(api)) listsScopes = true;
      if ((scope || SCOPE_LIST_APIS.has(api)) && path !== FILES.bridge) outsideBridge.push(`${where}: ${api}`);
    }
    const hints = scopeHints(sf);
    if (listsScopes) for (const s of hints.literals) markScope(s, `${s} ở ${short(path)}`);
    if (hints.geolocation) markScope('scope.userLocation', `navigator.geolocation ở ${short(path)}:${hints.geolocation}`);
  }
  add(G1, 'perm.import-form', opaque.length === 0, opaque.length === 0 ? 'zmp-sdk chỉ được import theo tên, nên đếm được từng API' : `import không kiểm được, đổi sang import theo tên: ${opaque.join('; ')}`);

  if (declared) {
    for (const [scope, where] of [...usedScopes.entries()].sort()) {
      const ok = Object.hasOwn(declared, scope);
      add(G1, `perm.declared:${scope}`, ok, ok ? `${scope} đã khai, dùng ở ${where.join(', ')}` : `${scope} được gọi (${where.join(', ')}) nhưng chưa khai trong ${FILES.permissions}`);
    }
    for (const scope of Object.keys(declared).sort()) {
      const entry = declared[scope] ?? {};
      const used = usedScopes.has(scope);
      add(G1, `perm.used:${scope}`, used, used ? `${scope} có lời gọi thật` : `${scope} khai nhưng không còn lời gọi nào: Zalo từ chối hồ sơ xin quyền không dùng, xoá khỏi ${FILES.permissions}`);
      const purpose = typeof entry.purpose === 'string' ? entry.purpose.trim() : '';
      const trigger = typeof entry.trigger === 'string' ? entry.trigger.trim() : '';
      const apisOk = Array.isArray(entry.apis) && entry.apis.length > 0 && entry.apis.every((a) => SCOPE_OF_API[a] === scope || SCOPE_LIST_APIS.has(a));
      const okEntry = purpose.length >= 30 && trigger.length >= 20 && apisOk;
      add(
        G1,
        `perm.purpose:${scope}`,
        okEntry,
        okEntry ? `${scope}: có mục đích và thời điểm xin để dán lên console` : `${scope}: cần "purpose" (≥ 30 ký tự), "trigger" (≥ 20 ký tự) và "apis" đúng bảng scope của zmp-sdk`,
      );
    }
  }

  if (declared && noScope) {
    const scoped = new Set(Object.values(declared).flatMap((e) => (Array.isArray(e?.apis) ? e.apis : [])));
    const unlisted = [...imported.keys()].filter((api) => !scoped.has(api) && !(Object.hasOwn(noScope, api) && String(noScope[api]).trim() !== '')).sort();
    const misfiled = Object.keys(noScope).filter((api) => SCOPE_OF_API[api] || SCOPE_LIST_APIS.has(api)).sort();
    const stale = Object.keys(noScope).filter((api) => !imported.has(api)).sort();
    const ok = unlisted.length === 0 && misfiled.length === 0 && stale.length === 0;
    const parts = [
      unlisted.length ? `API chưa có lý do: ${unlisted.map((a) => `${a} (${imported.get(a).join(', ')})`).join('; ')}` : '',
      misfiled.length ? `API cần quyền nằm nhầm ở noScopeApis: ${misfiled.join(', ')}` : '',
      stale.length ? `noScopeApis còn API không ai gọi: ${stale.join(', ')}` : '',
    ].filter(Boolean);
    add(G1, 'perm.api-listed', ok, ok ? `${imported.size} API zmp-sdk đang dùng đều có trong tệp khai` : parts.join('; '));
  }
  add(
    G1,
    'perm.gate',
    outsideBridge.length === 0,
    outsideBridge.length === 0 ? `API cần quyền chỉ gọi trong ${short(FILES.bridge)}` : `API cần quyền gọi ngoài ${short(FILES.bridge)}: ${outsideBridge.join('; ')}`,
  );

  // ---------- Pháp lý ----------
  const G2 = 'Pháp lý';
  const core = legalCore(read(FILES.legalCore) ?? '');
  const slugSet = new Set(core.slugs);
  const coreOk = core.slugs.length > 0 && core.slugs.every((s) => core.titles[s]);
  add(G2, 'legal.slugs', coreOk, coreOk ? `legal-core.ts: ${core.slugs.join(', ')}` : `không đọc được LEGAL_SLUGS/LEGAL_PAGES ở ${FILES.legalCore}`);

  const webPolicy = read(FILES.webPolicy);
  const derived = webPolicy !== null && /from\s+['"]@tubutree\/app-core\/legal(-core)?['"]/.test(webPolicy);
  add(G2, 'legal.web-policy', derived, derived ? `${short(FILES.webPolicy)} lấy kiểu slug từ legal-core` : `${short(FILES.webPolicy)} phải lấy kiểu slug từ @tubutree/app-core/legal-core, không tự liệt kê`);

  const unknown = [];
  for (const { path, sf } of sources) {
    for (const { slug, line } of policySlugCalls(sf)) if (!slugSet.has(slug)) unknown.push(`${short(path)}:${line}: "${slug}"`);
  }
  add(G2, 'legal.slug-literals', unknown.length === 0, unknown.length === 0 ? 'mọi chính sách Mini App mở đều là slug của legal-core' : `slug không có trong LEGAL_SLUGS: ${unknown.join('; ')}`);

  const aboutSrc = read(FILES.about);
  const rows = aboutSrc ? policyRows(parse(FILES.about, aboutSrc)) : [];
  const missing = core.slugs.filter((s) => !rows.some((r) => r.slug === s));
  const wrongLabel = rows.filter((r) => r.label !== null && core.titles[r.slug] && r.label !== core.titles[r.slug]).map((r) => `${r.slug}: "${r.label}" ≠ "${core.titles[r.slug]}"`);
  const hubOk = aboutSrc !== null && coreOk && missing.length === 0 && wrongLabel.length === 0;
  const hubProblems = [missing.length ? `trang Về Tubu Tree thiếu: ${missing.join(', ')}` : '', wrongLabel.length ? `tên dòng lệch LEGAL_PAGES: ${wrongLabel.join('; ')}` : ''].filter(Boolean);
  add(G2, 'legal.hub', hubOk, aboutSrc === null ? `không có ${FILES.about}` : hubOk ? `trang Về Tubu Tree mở đủ ${core.slugs.length} chính sách, đúng tên` : hubProblems.join('; ') || 'không đọc được legal-core');

  const checkoutSrc = read(FILES.checkout);
  const consent = new Set(checkoutSrc ? policySlugCalls(parse(FILES.checkout, checkoutSrc)).map((c) => c.slug) : []);
  const consentOk = consent.has('dieu-khoan') && consent.has('bao-mat');
  add(G2, 'legal.checkout-consent', consentOk, consentOk ? 'màn thanh toán có link Điều khoản và Chính sách bảo mật ở câu đồng ý' : 'màn thanh toán phải mở được cả "dieu-khoan" và "bao-mat"');

  const links = manifest && typeof manifest.consoleLinks === 'object' && manifest.consoleLinks ? manifest.consoleLinks : {};
  const webPage = read(FILES.webLegalPage);
  const webServes = webPage !== null && /\bLEGAL_SLUGS\b/.test(webPage) && /\bisLegalSlug\b/.test(webPage);
  const linkOk = links.privacyPolicy === 'bao-mat' && slugSet.has(links.privacyPolicy) && slugSet.has(links.terms) && webServes;
  add(
    G2,
    'legal.console-links',
    linkOk,
    linkOk
      ? `link điền trên console: /chinh-sach/${links.privacyPolicy} và /chinh-sach/${links.terms} của website (${FILES.webLegalPage} dựng đủ LEGAL_SLUGS)`
      : `"consoleLinks" cần privacyPolicy = "bao-mat" và terms là slug của legal-core, và ${FILES.webLegalPage} phải dựng trang theo LEGAL_SLUGS`,
  );

  // ---------- Xoá tài khoản ----------
  const G3 = 'Xoá tài khoản';
  const has = (path, re) => {
    const s = read(path);
    return s !== null && re.test(s);
  };
  const steps = [
    ['tab Cá nhân', has(FILES.navConfig, /profile:\s*\{\s*path:\s*'\/profile'/) && has(FILES.appRoutes, /<Route\s+path="\/profile"/)],
    ['dòng Cài đặt ở trang Cá nhân', has(FILES.profileMenu, /key:\s*'settings'[^}]*mini:\s*'\/settings'/) && has(FILES.appRoutes, /<Route\s+path="\/settings"/)],
    ['khối Xoá tài khoản ở Cài đặt', has(FILES.settings, /import\s*\{[^}]*\bAccountDeletionSection\b[^}]*\}/) && has(FILES.settings, /<AccountDeletionSection\b/)],
    ['nút gửi yêu cầu xoá', has(FILES.deletionSection, /\brequestAccountDeletion\(/) && has(FILES.accountApiCore, /'\/me\/deletion-request'/)],
    ['API nhận yêu cầu', has(FILES.usersController, /@Post\('me\/deletion-request'\)/)],
    ['webhook rút đồng ý của Zalo', has(FILES.consentWebhook, /'user\.revoke\.consent'/)],
  ];
  const broken = steps.filter(([, ok]) => !ok).map(([label]) => label);
  add(
    G3,
    'delete.reachable',
    broken.length === 0,
    broken.length === 0 ? 'Cá nhân › Cài đặt › Xoá tài khoản gửi POST /me/deletion-request; API có webhook user.revoke.consent' : `đứt ở: ${broken.join(', ')}`,
  );

  // ---------- Thanh toán ----------
  const G4 = 'Thanh toán';
  const linkHits = sources.flatMap(({ path, sf }) => linkFindings(path, sf));
  const navHits = sources.flatMap(({ path, sf }) => navigationFindings(path, sf));
  add(G4, 'pay.links', linkHits.length === 0, linkHits.length === 0 ? `${sources.length} tệp Mini App: không có link cổng thanh toán, đường dẫn mở app ngoài hay tên miền chưa duyệt` : linkHits.join('; '));
  add(G4, 'pay.navigation', navHits.length === 0, navHits.length === 0 ? 'không có window.open; chỉ zmp-bridge.ts đổi location; openWebview gọi thẳng chỉ tới link Zalo' : navHits.join('; '));

  const bridgeSrc = read(FILES.bridge);
  const hostsInit = bridgeSrc ? findConst(parse(FILES.bridge, bridgeSrc), 'ALLOWED_EXTERNAL_HOSTS') : null;
  const bridgeHosts = hostsInit && ts.isNewExpression(hostsInit) && hostsInit.arguments?.[0] ? stringItems(unwrap(hostsInit.arguments[0])) : null;
  const bridgeOk = Array.isArray(bridgeHosts) && bridgeHosts.length > 0 && bridgeHosts.every((h) => DIRECT_WEBVIEW_HOSTS.has(h));
  add(
    G4,
    'pay.bridge-hosts',
    bridgeOk,
    bridgeOk ? `openExternal chỉ mở ${bridgeHosts.join(', ')}` : `ALLOWED_EXTERNAL_HOSTS ở ${short(FILES.bridge)} chỉ được có zalo.me, oa.zalo.me (đang: ${bridgeHosts ? bridgeHosts.join(', ') : 'không đọc được'})`,
  );

  const rulesSrc = read(FILES.checkoutRules);
  const methods = rulesSrc ? stringItems(findConst(parse(FILES.checkoutRules, rulesSrc), 'CHECKOUT_PAYMENT_METHODS')) : null;
  const extra = methods ? methods.filter((m) => !ALLOWED_PAYMENT_METHODS.includes(m)) : null;
  const methodsOk = Array.isArray(methods) && methods.length > 0 && extra.length === 0;
  add(
    G4,
    'pay.methods',
    methodsOk,
    methodsOk ? `màn thanh toán Mini App cho chọn: ${methods.join(', ')}` : `CHECKOUT_PAYMENT_METHODS chỉ được gồm ${ALLOWED_PAYMENT_METHODS.join(', ')} (thừa: ${extra ? extra.join(', ') : 'không đọc được'})`,
  );

  const portalSrc = read(FILES.webPortalScreens);
  const portalPaths = [];
  if (portalSrc) {
    walk(parse(FILES.webPortalScreens, portalSrc), (n) => {
      if (ts.isPropertyAssignment(n) && propName(n) === 'webPath' && ts.isStringLiteralLike(n.initializer)) portalPaths.push(n.initializer.text);
    });
  }
  const shopping = portalPaths.filter((p) => WEB_SHOPPING_PATHS.some((s) => p === s || p.startsWith(`${s}/`) || p.startsWith(`${s}?`)));
  const portalOk = portalPaths.length > 0 && shopping.length === 0;
  add(
    G4,
    'pay.portal',
    portalOk,
    portalOk ? `cổng web mở ${portalPaths.length} màn quản trị, đối tác, nhân sự; không có trang mua hàng` : `cổng web không được dẫn tới ${WEB_SHOPPING_PATHS.join(', ')} (đang: ${shopping.join(', ') || 'không đọc được WEB_PORTAL_SCREENS'})`,
  );

  return { checks, failed: checks.filter((c) => !c.ok).length };
}

/** Đọc tệp thật dưới `root` (gốc repo). */
export function diskFiles(root) {
  return {
    read: (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null),
    list: (dir) => {
      const abs = join(root, dir);
      if (!existsSync(abs)) return [];
      return readdirSync(abs, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath ?? e.path, e.name).slice(root.length + 1).split('\\').join('/'))
        .filter((p) => !p.includes('/node_modules/'));
    },
  };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const { checks, failed } = checkSubmission(diskFiles(root));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ checks, failed }, null, 2));
  } else {
    console.log('Kiểm hồ sơ gửi duyệt Zalo Mini App');
    let group = '';
    for (const c of checks) {
      if (c.group !== group) {
        group = c.group;
        console.log(`\n[${group}]`);
      }
      console.log(`  ${c.ok ? 'ĐẠT' : 'LỖI'}  ${c.id}: ${c.detail}`);
    }
    console.log(failed === 0 ? `\ncheck-submission xanh: ${checks.length}/${checks.length} mục đạt` : `\ncheck-submission đỏ: ${failed}/${checks.length} mục lỗi`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
