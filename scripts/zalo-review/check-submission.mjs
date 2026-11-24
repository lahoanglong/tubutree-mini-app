#!/usr/bin/env node
/**
 * Kiểm hồ sơ gửi duyệt Zalo Mini App, chạy trước mỗi lần tải bản lên Testing hoặc gửi duyệt Live:
 *   node scripts/zalo-review/check-submission.mjs [--json]
 *
 * Bốn nhóm, đúng những lý do Zalo hay trả hồ sơ:
 * - Quyền: scope khai trong apps/miniapp/zalo-permissions.json khớp đúng các API zmp-sdk cần quyền mà mã nguồn gọi thật (không thiếu, không
 *   thừa), mọi API zmp-sdk khác có lý do, API cần quyền chỉ được gọi trong services/zmp-bridge.ts.
 * - Pháp lý: mọi chính sách Mini App mở được là một slug của legal-core.ts, trang Về Tubu Tree mở đủ năm chính sách đúng tên, thanh toán có
 *   Điều khoản và Bảo mật, link chính sách điền trên console có trang web thật.
 * - Xoá tài khoản: đi được từ tab Cá nhân tới nút gửi yêu cầu xoá, và API có route nhận yêu cầu cùng webhook rút đồng ý của Zalo.
 * - Thanh toán: không có tên miền cổng thanh toán, đường dẫn mở app ngoài, link dựng tên miền lúc chạy, window.open hay đổi location ngoài
 *   zmp-bridge.ts, API zmp-sdk mở sang app khác; Mini App chỉ cho COD, chuyển khoản, Ví; cổng web không trỏ thẳng tới trang thanh toán web;
 *   trang web có thanh toán đơn đại lý (BROWSER_ONLY_WEB_PATHS) chỉ chép link sang trình duyệt, không mở trong webview Zalo.
 *
 * Quét mọi tệp của apps/miniapp/src cùng các tệp packages/app-core/src mà Mini App nạp (lần theo import). Đọc bằng bộ phân tích của
 * TypeScript nên chữ trong chú thích không tính. Không gọi mạng, không ghi tệp.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const MINI_SRC = 'apps/miniapp/src';
export const APP_CORE_SRC = 'packages/app-core/src';
const APP_CORE_PKG = '@tubutree/app-core';

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
  webPortalRedirect: 'apps/miniapp/src/pages/web-portal-redirect.tsx',
};

/** Bảng scope trong zmp-sdk 2.51.4 (apis/index.d.ts, bảng Scopes của authorize/getSetting): gọi API nào thì Zalo hỏi khách scope nào. */
export const SCOPES_OF_API = {
  getPhoneNumber: ['scope.userPhonenumber'],
  getLocation: ['scope.userLocation'],
  getUserInfo: ['scope.userInfo'],
  createCameraContext: ['scope.camera', 'scope.micro'],
  requestCameraPermission: ['scope.camera'],
};
/** Hai API nhận danh sách scope dạng chuỗi: có import một trong hai thì mọi chuỗi `scope.x` trong mã được quét đều tính là có dùng. */
const SCOPE_LIST_APIS = new Set(['authorize', 'getSetting']);
/** API zmp-sdk chuyển khách sang app hoặc Mini App khác: không được dùng dù có ghi lý do (có thể dẫn tới trang trả tiền ngoài). */
export const FORBIDDEN_SDK_APIS = ['openMiniApp', 'openOutApp'];

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
/** Trang mua hàng của web: cổng web trong Mini App không được trỏ thẳng tới đây. */
export const WEB_SHOPPING_PATHS = ['/thanh-toan', '/gio-hang'];
/** Trang web có thanh toán đơn sỉ đại lý (PO A3): Mini App chỉ cho chép link sang trình duyệt, không mở trong webview Zalo. */
export const BROWSER_ONLY_WEB_PATHS = ['/dai-ly'];
/** Host `openWebview` được gọi thẳng ngoài zmp-bridge.ts (link viết sẵn trong mã). */
const DIRECT_WEBVIEW_HOSTS = new Set(['zalo.me', 'oa.zalo.me']);
const short = (path) => path.replace(`${MINI_SRC}/`, '').replace(`${APP_CORE_SRC}/`, 'app-core/');

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
/** `window['location'].href` → `window.location.href`, bỏ khoảng trắng: so tên theo một dạng. */
const normalizeAccess = (text) => text.replace(/\s+/g, '').replace(/\[(['"`])([\w$]+)\1\]/g, '.$2');

/** Mã nguồn bỏ chú thích (máy in của TypeScript), cho các mục so bằng biểu thức chính quy. */
function codeOnly(path, source) {
  if (source === null) return null;
  return ts.createPrinter({ removeComments: true }).printFile(parse(path, source));
}

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

/** Module một tệp nạp khi chạy: import (bỏ import kiểu), export ... from, import() với chuỗi viết sẵn. */
export function moduleRefs(sf) {
  const refs = [];
  walk(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && !n.importClause?.isTypeOnly) refs.push(n.moduleSpecifier.text);
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.isTypeOnly) refs.push(n.moduleSpecifier.text);
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) refs.push(n.arguments[0].text);
  });
  return refs;
}

/** Tệp app-core ứng với một module (`@tubutree/app-core/x` theo exports `./*` → `./src/*.ts`, hoặc đường dẫn tương đối từ một tệp app-core). */
function resolveAppCore(spec, fromPath, exists) {
  let base = null;
  if (spec.startsWith(`${APP_CORE_PKG}/`)) base = `${APP_CORE_SRC}/${spec.slice(APP_CORE_PKG.length + 1)}`;
  else if (spec.startsWith('.') && fromPath.startsWith(`${APP_CORE_SRC}/`)) base = posix.normalize(posix.join(posix.dirname(fromPath), spec));
  if (!base || !base.startsWith(`${APP_CORE_SRC}/`)) return null;
  const stem = base.replace(/\.(js|ts|tsx)$/, '');
  return [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`].find(exists) ?? null;
}

/** Mọi API zmp-sdk một tệp import (bỏ import kiểu), có được dùng tới không, và các kiểu import không kiểm được (`* as`, mặc định, động, require). */
export function sdkImports(path, source) {
  const sf = parse(path, source);
  const named = [];
  const opaque = [];
  const specifierNames = new Set();
  const addNamed = (elements, reexport) => {
    for (const el of elements) {
      if (el.isTypeOnly) continue;
      specifierNames.add(el.name);
      named.push({ api: (el.propertyName ?? el.name).text, local: el.name.text, line: lineOf(sf, el), used: reexport });
    }
  };
  walk(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && isZmpSdk(n.moduleSpecifier.text)) {
      const clause = n.importClause;
      if (!clause || clause.isTypeOnly) return;
      if (clause.name) opaque.push({ kind: 'import mặc định', line: lineOf(sf, n) });
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) opaque.push({ kind: 'import * as', line: lineOf(sf, n) });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) addNamed(clause.namedBindings.elements, false);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && isZmpSdk(n.moduleSpecifier.text)) {
      if (n.isTypeOnly) return;
      if (!n.exportClause || ts.isNamespaceExport(n.exportClause)) opaque.push({ kind: 'export *', line: lineOf(sf, n) });
      else addNamed(n.exportClause.elements, true);
    } else if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0]) && isZmpSdk(n.arguments[0].text)) {
      const dynamic = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(n.expression) && n.expression.text === 'require';
      if (dynamic || required) opaque.push({ kind: dynamic ? 'import()' : 'require', line: lineOf(sf, n) });
    }
  });
  const referenced = new Set();
  walk(sf, (n) => {
    if (ts.isIdentifier(n) && !specifierNames.has(n) && !(n.parent && ts.isImportSpecifier(n.parent))) referenced.add(n.text);
  });
  for (const imp of named) if (referenced.has(imp.local)) imp.used = true;
  return { named, opaque, sf };
}

/** Chuỗi `scope.x` viết trong tệp và chỗ đọc `navigator.geolocation`. */
function scopeHints(sf) {
  const literals = [];
  let geolocation = null;
  walk(sf, (n) => {
    if (ts.isStringLiteralLike(n) && /^scope\.\w+$/.test(n.text)) literals.push(n.text);
    if (!geolocation && ts.isPropertyAccessExpression(n) && n.name.text === 'geolocation' && normalizeAccess(n.expression.getText(sf)).match(/(^|\.)navigator$/)) {
      geolocation = lineOf(sf, n);
    }
  });
  return { literals, geolocation };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PAYMENT_RE = new RegExp(`(?:^|[^a-z0-9.-])((?:[a-z0-9-]+\\.)*(?:${PAYMENT_HOSTS.map(escapeRe).join('|')}))(?![a-z0-9-])`, 'gi');

/** Chuỗi nằm trong đối số của `new URL(...)`: dựng URL để đọc tham số, không phải để mở. */
function insideUrlParse(node) {
  let n = node;
  while (n.parent && (ts.isTemplateExpression(n.parent) || ts.isTemplateSpan(n.parent) || ts.isConditionalExpression(n.parent) || ts.isParenthesizedExpression(n.parent) || ts.isBinaryExpression(n.parent))) {
    n = n.parent;
  }
  return Boolean(n.parent && ts.isNewExpression(n.parent) && ts.isIdentifier(n.parent.expression) && n.parent.expression.text === 'URL' && n.parent.arguments?.[0] === n);
}

/** Đoạn chữ của mọi chuỗi và template trong tệp (chú thích, chữ JSX và regex không tính). */
function stringPieces(sf) {
  const out = [];
  walk(sf, (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      out.push({ text: n.text, line: lineOf(sf, n), parseOnly: insideUrlParse(ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) ? n.parent : n) });
    }
  });
  return out;
}

const URL_RE = /\b([a-z][a-z0-9+.-]*):\/\/([^\s'"`/?#:)\\]*)([^\s'"`?#)\\]*)/gi;
const PROTOCOL_RELATIVE_RE = /(?:^|[\s'"`(=])\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?![a-z0-9-])/gi;

/**
 * Link ngoài trong một tệp: tên miền cổng thanh toán (ở bất cứ đâu trong chuỗi), đường dẫn mở app ngoài, tên miền chưa duyệt (kể cả `//host`),
 * link dựng tên miền lúc chạy ngoài zmp-bridge.ts, trang mua hàng của web.
 */
export function linkFindings(path, sf) {
  const found = [];
  const isBridge = path === FILES.bridge;
  const checkHost = (at, host, rest) => {
    if (!Object.hasOwn(ALLOWED_HOSTS, host)) found.push(`${at}: tên miền chưa duyệt ${host} (không phải trang thanh toán thì thêm vào ALLOWED_HOSTS kèm lý do)`);
    else if ((host === 'tubutree.com' || host === 'app.tubutree.com') && WEB_SHOPPING_PATHS.some((p) => rest === p || rest.startsWith(`${p}/`))) {
      found.push(`${at}: link tới trang mua hàng của web ${host}${rest}`);
    }
  };
  for (const { text, line, parseOnly } of stringPieces(sf)) {
    const at = `${short(path)}:${line}`;
    for (const m of text.matchAll(PAYMENT_RE)) found.push(`${at}: link cổng thanh toán ngoài ${m[1].toLowerCase()}`);
    for (const m of text.matchAll(URL_RE)) {
      const scheme = m[1].toLowerCase();
      const host = m[2].toLowerCase();
      if (scheme !== 'http' && scheme !== 'https') {
        found.push(`${at}: đường dẫn mở app ngoài "${scheme}://"`);
        continue;
      }
      if (!host) {
        if (!isBridge && !parseOnly) found.push(`${at}: link dựng tên miền lúc chạy, không kiểm được (mở link ngoài qua zmp-bridge.ts)`);
        continue;
      }
      if (hostIsPayment(host)) continue;
      checkHost(at, host, m[3]);
    }
    for (const m of text.matchAll(PROTOCOL_RELATIVE_RE)) {
      const host = m[1].toLowerCase();
      if (!hostIsPayment(host)) checkHost(at, host, '');
    }
  }
  return found;
}

function hostIsPayment(host) {
  return PAYMENT_HOSTS.some((p) => host === p || host.endsWith(`.${p}`));
}

/**
 * Điều hướng ra ngoài: `window.open` (cả `globalThis`, `self`, `top`, `window['open']`), ghi hoặc gọi `location.assign/replace` ngoài
 * zmp-bridge.ts, và `openWebview` (kể cả tên đặt lại hay gán sang biến khác) gọi ngoài zmp-bridge.ts với link không phải Zalo viết sẵn.
 */
export function navigationFindings(path, sf, webviewNames = new Set(['openWebview'])) {
  const found = [];
  const isBridge = path === FILES.bridge;
  const names = new Set(webviewNames);
  let grew = true;
  while (grew) {
    grew = false;
    walk(sf, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isIdentifier(unwrap(n.initializer)) && names.has(unwrap(n.initializer).text) && !names.has(n.name.text)) {
        names.add(n.name.text);
        grew = true;
      }
    });
  }
  walk(sf, (n) => {
    if (ts.isCallExpression(n) && (ts.isPropertyAccessExpression(n.expression) || ts.isElementAccessExpression(n.expression))) {
      const callee = normalizeAccess(n.expression.getText(sf));
      if (/(^|\.)(window|globalThis|self|top|parent)\.open$/.test(callee)) found.push(`${short(path)}:${lineOf(sf, n)}: ${callee} mở trang ngoài Mini App`);
      else if (!isBridge && /(^|\.)location\.(assign|replace)$/.test(callee)) found.push(`${short(path)}:${lineOf(sf, n)}: gọi ${callee} ngoài zmp-bridge.ts`);
    }
    if (!isBridge && ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = normalizeAccess(n.left.getText(sf));
      if (/(^|\.)location(\.href)?$/.test(left)) found.push(`${short(path)}:${lineOf(sf, n)}: ghi ${left} ngoài zmp-bridge.ts`);
    }
    if (!isBridge && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text)) {
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

const coversPath = (paths, webPath) => {
  const path = webPath.split('?')[0].replace(/\/+$/, '').toLowerCase();
  return paths.some((p) => path === p || path.startsWith(`${p}/`));
};

const mentions = (node, names) => {
  let hit = false;
  walk(node, (n) => {
    if (ts.isIdentifier(n) && names.has(n.text)) hit = true;
  });
  return hit;
};

/** Mọi chỗ khai tên `browserOnly` trong tệp: hợp lệ khi chỉ có một, là phần tử destructuring từ `WEB_PORTAL_SCREENS[...]`. */
function browserOnlyFromTable(sf) {
  const decls = [];
  walk(sf, (n) => {
    if ((ts.isBindingElement(n) || ts.isVariableDeclaration(n) || ts.isParameter(n)) && ts.isIdentifier(n.name) && n.name.text === 'browserOnly') decls.push(n);
  });
  if (decls.length !== 1 || !ts.isBindingElement(decls[0])) return false;
  const decl = decls[0].parent.parent;
  return ts.isVariableDeclaration(decl) && Boolean(decl.initializer) && mentions(decl.initializer, new Set(['WEB_PORTAL_SCREENS']));
}

/**
 * Điều kiện là cờ của bảng màn: `browserOnly` (khi `fromTable`), `WEB_PORTAL_SCREENS[x].browserOnly`, có thể kèm `!` (bỏ ngoặc, `as`...).
 * Trả có phủ định hay không, null khi điều kiện là thứ khác.
 */
function browserOnlyTest(node, fromTable) {
  const n = unwrap(node);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = browserOnlyTest(n.operand, fromTable);
    return inner === null ? null : !inner;
  }
  if (ts.isIdentifier(n) && n.text === 'browserOnly' && fromTable) return false;
  if (ts.isPropertyAccessExpression(n) && n.name.text === 'browserOnly' && mentions(n.expression, new Set(['WEB_PORTAL_SCREENS']))) return false;
  return null;
}

/** Câu lệnh chỉ là một `return` (hoặc `{ return ...; }`); `value` = 'false' thì phải là `return false`. */
function isBareReturn(st, value) {
  const ret = ts.isReturnStatement(st) ? st : ts.isBlock(st) && st.statements.length === 1 && ts.isReturnStatement(st.statements[0]) ? st.statements[0] : null;
  if (!ret) return false;
  return value !== 'false' || (ret.expression !== undefined && ret.expression.kind === ts.SyntaxKind.FalseKeyword);
}

/**
 * `node` chỉ chạy khi cờ `browserOnly` tắt: có một tổ tiên là nhánh `!browserOnly` của if, `&&`, `? :`, hoặc có `if (browserOnly) return`
 * đứng trước nó trong một khối bao ngoài. Hàm định nghĩa ngoài nhánh đó (vd `open` chỉ được nút trong `!browserOnly && ...` gọi) không tính:
 * chặn phải nằm quanh chính lời gọi.
 */
function gatedOffBrowserOnly(node, fromTable) {
  const test = (expr) => browserOnlyTest(expr, fromTable);
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent) && child !== parent.expression) {
      const neg = test(parent.expression);
      if (neg === true && child === parent.thenStatement) return true;
      if (neg === false && child === parent.elseStatement) return true;
    }
    if (ts.isConditionalExpression(parent) && child !== parent.condition) {
      const neg = test(parent.condition);
      if (neg === true && child === parent.whenTrue) return true;
      if (neg === false && child === parent.whenFalse) return true;
    }
    if (ts.isBinaryExpression(parent) && child === parent.right) {
      const neg = test(parent.left);
      if (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && neg === true) return true;
      if (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken && neg === false) return true;
    }
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      const before = parent.statements.slice(0, parent.statements.indexOf(child));
      if (before.some((st) => ts.isIfStatement(st) && !st.elseStatement && test(st.expression) === false && isBareReturn(st.thenStatement))) return true;
    }
  }
  return false;
}

/** Mọi chỗ dùng `openWebPortal` trong một tệp: tên import (kể cả đổi tên), `ns.openWebPortal`, re-export. Import kiểu không tính. */
function portalOpenUses(sf) {
  const locals = new Set();
  const uses = [];
  const use = (n, at) => {
    const called = ts.isCallExpression(n.parent) && n.parent.expression === n;
    uses.push({ node: called ? n.parent : n, called, line: lineOf(sf, at), pos: at.getStart(sf) });
  };
  walk(sf, (n) => {
    if (ts.isImportSpecifier(n) && !n.isTypeOnly && !n.parent.parent.isTypeOnly && (n.propertyName ?? n.name).text === 'openWebPortal') locals.add(n.name.text);
    if (ts.isExportSpecifier(n) && !n.isTypeOnly && n.parent.parent.moduleSpecifier && (n.propertyName ?? n.name).text === 'openWebPortal') use(n, n);
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'openWebPortal') use(n, n.name);
  });
  walk(sf, (n) => {
    if (ts.isIdentifier(n) && locals.has(n.text) && !(n.parent && (ts.isImportSpecifier(n.parent) || (ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)))) use(n, n);
  });
  return uses.sort((a, b) => a.pos - b.pos);
}

/**
 * Trang web có thanh toán (BROWSER_ONLY_WEB_PATHS) không mở được trong webview Zalo, ba lớp (chú thích không tính):
 * màn cổng web trỏ tới đó có `browserOnly: true`; `openWebPortal` chỉ gọi ở web-portal-redirect.tsx và chỉ khi cờ tắt;
 * `openWebPortal` của zmp-bridge.ts trả về trước `openWebview` khi link thuộc BROWSER_ONLY_WEB_PATHS của chính nó.
 */
function browserOnlyFindings(read, sources) {
  const found = [];
  const screensSrc = read(FILES.webPortalScreens);
  const screens = screensSrc ? findConst(parse(FILES.webPortalScreens, screensSrc), 'WEB_PORTAL_SCREENS') : null;
  let guarded = 0;
  if (!screens || !ts.isObjectLiteralExpression(screens)) found.push(`không đọc được WEB_PORTAL_SCREENS ở ${short(FILES.webPortalScreens)}`);
  else {
    for (const p of screens.properties) {
      if (!ts.isPropertyAssignment(p) || !ts.isObjectLiteralExpression(unwrap(p.initializer))) continue;
      const props = unwrap(p.initializer).properties.filter(ts.isPropertyAssignment);
      const webPath = props.find((q) => propName(q) === 'webPath');
      if (!webPath || !ts.isStringLiteralLike(webPath.initializer) || !coversPath(BROWSER_ONLY_WEB_PATHS, webPath.initializer.text)) continue;
      const flag = props.find((q) => propName(q) === 'browserOnly');
      if (flag && flag.initializer.kind === ts.SyntaxKind.TrueKeyword) guarded += 1;
      else found.push(`${short(FILES.webPortalScreens)}: màn ${propName(p)} trỏ tới ${webPath.initializer.text} (trang có thanh toán) phải có browserOnly: true`);
    }
  }

  let redirectCalls = 0;
  for (const { path, sf } of sources) {
    if (path === FILES.bridge) continue;
    const fromTable = path === FILES.webPortalRedirect && browserOnlyFromTable(sf);
    for (const use of portalOpenUses(sf)) {
      const at = `${short(path)}:${use.line}`;
      if (path !== FILES.webPortalRedirect) found.push(`${at}: openWebPortal chỉ được gọi ở ${short(FILES.webPortalRedirect)} (nơi có cờ browserOnly)`);
      else if (!use.called) found.push(`${at}: openWebPortal phải được gọi thẳng, không truyền đi như giá trị`);
      else if (!gatedOffBrowserOnly(use.node, fromTable)) {
        found.push(`${at}: openWebPortal(...) phải nằm sau if (browserOnly) return hoặc trong nhánh !browserOnly, với browserOnly lấy từ WEB_PORTAL_SCREENS`);
      } else redirectCalls += 1;
    }
  }

  const bridgeSrc = read(FILES.bridge);
  const bridgeSf = bridgeSrc ? parse(FILES.bridge, bridgeSrc) : null;
  const blocked = bridgeSf ? stringItems(findConst(bridgeSf, 'BROWSER_ONLY_WEB_PATHS')) : null;
  const missing = blocked ? BROWSER_ONLY_WEB_PATHS.filter((p) => !blocked.includes(p)) : BROWSER_ONLY_WEB_PATHS;
  if (missing.length > 0) found.push(`${short(FILES.bridge)}: BROWSER_ONLY_WEB_PATHS phải có ${missing.join(', ')}`);
  let bridgeGate = false;
  if (bridgeSf) {
    const helpers = new Set(['BROWSER_ONLY_WEB_PATHS']);
    const mentionsList = (node) => mentions(node, helpers);
    const fns = [];
    walk(bridgeSf, (n) => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body) fns.push({ name: n.name.text, body: n.body });
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(unwrap(n.initializer)) || ts.isFunctionExpression(unwrap(n.initializer)))) {
        fns.push({ name: n.name.text, body: unwrap(n.initializer).body });
      }
    });
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of fns) if (f.name !== 'openWebPortal' && !helpers.has(f.name) && mentionsList(f.body)) {
        helpers.add(f.name);
        grew = true;
      }
    }
    const portal = fns.find((f) => f.name === 'openWebPortal');
    if (portal && ts.isBlock(portal.body)) {
      const statements = portal.body.statements;
      const callsWebview = (st) => {
        let hit = false;
        walk(st, (n) => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'openWebview') hit = true;
        });
        return hit;
      };
      const firstOpen = statements.findIndex(callsWebview);
      const guards = statements.slice(0, firstOpen === -1 ? statements.length : firstOpen);
      bridgeGate = guards.some((st) => ts.isIfStatement(st) && !st.elseStatement && isBareReturn(st.thenStatement, 'false') && mentionsList(st.expression));
    }
  }
  if (!bridgeGate) found.push(`${short(FILES.bridge)}: openWebPortal phải trả false trước openWebview khi link thuộc BROWSER_ONLY_WEB_PATHS`);
  return { found, guarded, redirectCalls };
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

/** `WebPolicySlug` phải là `LegalSlug` của legal-core: re-export, hoặc bí danh kiểu trỏ tới tên import từ legal-core. Chú thích không tính. */
function webPolicyDerived(source) {
  if (source === null) return false;
  const sf = parse(FILES.webPolicy, source);
  const fromLegal = (spec) => ts.isStringLiteral(spec) && /^@tubutree\/app-core\/legal(-core)?$/.test(spec.text);
  const imported = new Set();
  let ok = false;
  walk(sf, (n) => {
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && fromLegal(n.moduleSpecifier) && n.exportClause && ts.isNamedExports(n.exportClause)) {
      if (n.exportClause.elements.some((e) => e.name.text === 'WebPolicySlug' && (e.propertyName ?? e.name).text === 'LegalSlug')) ok = true;
    }
    if (ts.isImportDeclaration(n) && fromLegal(n.moduleSpecifier) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
      for (const e of n.importClause.namedBindings.elements) if ((e.propertyName ?? e.name).text === 'LegalSlug') imported.add(e.name.text);
    }
  });
  walk(sf, (n) => {
    if (ts.isTypeAliasDeclaration(n) && n.name.text === 'WebPolicySlug' && ts.isTypeReferenceNode(n.type) && ts.isIdentifier(n.type.typeName) && imported.has(n.type.typeName.text)) ok = true;
  });
  return ok;
}

function readJson(text) {
  try {
    return JSON.parse(text ?? 'null');
  } catch {
    return null;
  }
}

/** Tệp Mini App cùng các tệp app-core mà chúng nạp (lần theo import, bỏ spec và dữ liệu giả). */
function collectSources(files) {
  const exists = (p) => files.read(p) !== null;
  const out = new Map();
  const queue = files.list(MINI_SRC).filter(isShippedSource).sort();
  while (queue.length > 0) {
    const path = queue.shift();
    if (out.has(path)) continue;
    const source = files.read(path) ?? '';
    const sf = parse(path, source);
    out.set(path, { path, source, sf });
    for (const spec of moduleRefs(sf)) {
      const target = resolveAppCore(spec, path, exists);
      if (target && isShippedSource(target) && !out.has(target)) queue.push(target);
    }
  }
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Chạy mọi mục kiểm. `files.read(path)` trả nội dung hoặc null khi không có tệp; `files.list(dir)` trả mọi tệp dưới `dir` (đường dẫn tính từ gốc repo).
 * Trả danh sách mục, mỗi mục đạt hoặc không kèm lời giải thích; thiếu tệp là mục không đạt, không ném lỗi.
 */
export function checkSubmission(files) {
  const checks = [];
  const add = (group, id, ok, detail) => checks.push({ group, id, ok: Boolean(ok), detail });
  const read = (p) => files.read(p);
  const sources = collectSources(files);
  const coreCount = sources.filter((s) => s.path.startsWith(`${APP_CORE_SRC}/`)).length;

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
  const forbidden = [];
  const webviewNames = new Map();
  let listsScopes = false;
  const scopeLiterals = [];
  for (const { path, source } of sources) {
    const { named, opaque: odd, sf } = sdkImports(path, source);
    for (const o of odd) opaque.push(`${short(path)}:${o.line}: ${o.kind} từ zmp-sdk`);
    const localWebview = new Set();
    for (const { api, local, line, used } of named) {
      const where = `${short(path)}:${line}`;
      if (!imported.has(api)) imported.set(api, []);
      imported.get(api).push(where);
      const scopes = SCOPES_OF_API[api];
      if (scopes && used) for (const s of scopes) markScope(s, `${api} ở ${where}`);
      if (SCOPE_LIST_APIS.has(api)) listsScopes = true;
      if ((scopes || SCOPE_LIST_APIS.has(api)) && path !== FILES.bridge) outsideBridge.push(`${where}: ${api}`);
      if (FORBIDDEN_SDK_APIS.includes(api)) forbidden.push(`${where}: ${api}`);
      if (api === 'openWebview') localWebview.add(local);
    }
    webviewNames.set(path, localWebview);
    const hints = scopeHints(sf);
    for (const s of hints.literals) scopeLiterals.push(`${s} ở ${short(path)}`);
    if (hints.geolocation) markScope('scope.userLocation', `navigator.geolocation ở ${short(path)}:${hints.geolocation}`);
  }
  if (listsScopes) for (const hit of scopeLiterals) markScope(hit.split(' ')[0], hit);
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
      const apisOk = Array.isArray(entry.apis) && entry.apis.length > 0 && entry.apis.every((a) => SCOPES_OF_API[a]?.includes(scope) || SCOPE_LIST_APIS.has(a));
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
    const misfiled = Object.keys(noScope).filter((api) => SCOPES_OF_API[api] || SCOPE_LIST_APIS.has(api)).sort();
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

  const derived = webPolicyDerived(read(FILES.webPolicy));
  add(G2, 'legal.web-policy', derived, derived ? `${short(FILES.webPolicy)} lấy kiểu slug từ legal-core` : `${short(FILES.webPolicy)}: WebPolicySlug phải là LegalSlug của @tubutree/app-core/legal-core, không tự liệt kê`);

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
  const webPage = codeOnly(FILES.webLegalPage, read(FILES.webLegalPage));
  const webServes = webPage !== null && /\bLEGAL_SLUGS\b/.test(webPage) && /\bisLegalSlug\b/.test(webPage);
  const linkOk = links.privacyPolicy === 'bao-mat' && links.terms === 'dieu-khoan' && slugSet.has(links.privacyPolicy) && slugSet.has(links.terms) && webServes;
  add(
    G2,
    'legal.console-links',
    linkOk,
    linkOk
      ? `link điền trên console: /chinh-sach/${links.privacyPolicy} và /chinh-sach/${links.terms} của website (${FILES.webLegalPage} dựng đủ LEGAL_SLUGS)`
      : `"consoleLinks" cần privacyPolicy = "bao-mat", terms = "dieu-khoan" (đều có trong legal-core), và ${FILES.webLegalPage} phải dựng trang theo LEGAL_SLUGS`,
  );

  // ---------- Xoá tài khoản ----------
  const G3 = 'Xoá tài khoản';
  const has = (path, re) => {
    const s = codeOnly(path, read(path));
    return s !== null && re.test(s);
  };
  const steps = [
    ['tab Cá nhân', has(FILES.navConfig, /profile:\s*\{\s*path:\s*['"]\/profile['"]/) && has(FILES.appRoutes, /<Route\s+path="\/profile"/)],
    ['dòng Cài đặt ở trang Cá nhân', has(FILES.profileMenu, /key:\s*['"]settings['"][^}]*mini:\s*['"]\/settings['"]/) && has(FILES.appRoutes, /<Route\s+path="\/settings"/)],
    ['khối Xoá tài khoản ở Cài đặt', has(FILES.settings, /import\s*\{[^}]*\bAccountDeletionSection\b[^}]*\}/) && has(FILES.settings, /<AccountDeletionSection\b/)],
    ['nút gửi yêu cầu xoá', has(FILES.deletionSection, /\brequestAccountDeletion\(/) && has(FILES.accountApiCore, /['"]\/me\/deletion-request['"]/)],
    ['API nhận yêu cầu', has(FILES.usersController, /@Post\(['"]me\/deletion-request['"]\)/)],
    ['webhook rút đồng ý của Zalo', has(FILES.consentWebhook, /['"]user\.revoke\.consent['"]/)],
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
  const navHits = [
    ...forbidden.map((f) => `${f}: API mở sang app hoặc Mini App khác, không dùng trong Mini App bán hàng`),
    ...sources.flatMap(({ path, sf }) => navigationFindings(path, sf, new Set(['openWebview', ...(webviewNames.get(path) ?? [])]))),
  ];
  add(
    G4,
    'pay.links',
    linkHits.length === 0,
    linkHits.length === 0
      ? `${sources.length} tệp (${sources.length - coreCount} của Mini App, ${coreCount} app-core Mini App nạp): không có tên miền cổng thanh toán, đường dẫn mở app ngoài, tên miền chưa duyệt hay link dựng tên miền lúc chạy`
      : linkHits.join('; '),
  );
  add(
    G4,
    'pay.navigation',
    navHits.length === 0,
    navHits.length === 0 ? 'không có window.open hay API mở app khác; chỉ zmp-bridge.ts đổi location; openWebview gọi thẳng chỉ tới link Zalo' : navHits.join('; '),
  );

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
    portalOk
      ? `cổng web mở ${portalPaths.length} màn quản trị, đối tác, nhân sự (${portalPaths.join(', ')}); không màn nào trỏ thẳng tới ${WEB_SHOPPING_PATHS.join(', ')}`
      : `cổng web không được trỏ thẳng tới ${WEB_SHOPPING_PATHS.join(', ')} (đang: ${shopping.join(', ') || 'không đọc được WEB_PORTAL_SCREENS'})`,
  );

  const browserOnly = browserOnlyFindings(read, sources);
  add(
    G4,
    'pay.portal-browser-only',
    browserOnly.found.length === 0,
    browserOnly.found.length === 0
      ? `${BROWSER_ONLY_WEB_PATHS.join(', ')} chỉ mở bằng trình duyệt: ${browserOnly.guarded} màn cổng web có browserOnly: true, ${browserOnly.redirectCalls} lời gọi openWebPortal ở ${short(FILES.webPortalRedirect)} đều nằm sau cờ, zmp-bridge.ts chặn trước openWebview`
      : browserOnly.found.join('; '),
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
