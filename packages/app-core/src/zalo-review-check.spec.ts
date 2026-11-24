import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BROWSER_ONLY_WEB_PATHS, FILES, MINI_SRC, checkSubmission, diskFiles, isShippedSource, type SubmissionCheck } from '../../../scripts/zalo-review/check-submission.mjs';

const MANIFEST = {
  scopes: {
    'scope.userPhonenumber': {
      apis: ['getPhoneNumber'],
      purpose: 'Điền sẵn số điện thoại nhận hàng cho đơn của khách.',
      trigger: 'Chỉ khi khách bấm Điền nhanh từ Zalo.',
    },
  },
  noScopeApis: { login: 'Đăng nhập ngầm.' },
  consoleLinks: { privacyPolicy: 'bao-mat', terms: 'dieu-khoan' },
};

/** Màn chuyển web: nút mở chỉ hiện khi cờ tắt, và chính lời gọi openWebPortal nằm sau `if (browserOnly) return`. */
const PORTAL_REDIRECT = [
  "import { openWebPortal } from '../services/zmp-bridge';",
  "import { WEB_PORTAL_SCREENS, type WebPortalScreen } from './web-portal-screens';",
  'export function Portal({ screen, url }: { screen: keyof typeof WEB_PORTAL_SCREENS; url: string }) {',
  '  const { browserOnly }: WebPortalScreen = WEB_PORTAL_SCREENS[screen];',
  '  const open = async () => {',
  '    if (browserOnly) return;',
  '    await openWebPortal(url);',
  '  };',
  '  return <>{!browserOnly && <Button onPress={open}>Mở trên website</Button>}</>;',
  '}',
].join('\n');

/** Một repo nhỏ đạt mọi mục; từng ca sửa đúng một tệp để chỉ một mục đỏ. */
function goodRepo(): Record<string, string> {
  return {
    [FILES.appConfig]: JSON.stringify({ app: { appId: '123', title: 'Tubu Tree' }, listCSS: [], listSyncJS: [] }),
    [FILES.permissions]: JSON.stringify(MANIFEST),
    [FILES.bridge]: [
      "import { getPhoneNumber, login } from 'zmp-sdk/apis';",
      "const ALLOWED_EXTERNAL_HOSTS = new Set(['zalo.me', 'oa.zalo.me']);",
      'export async function phone() { await login({}); return getPhoneNumber({}); }',
      'export function fallback(url: string) { window.location.href = url; }',
      "const BROWSER_ONLY_WEB_PATHS = ['/dai-ly'];",
      'const isBrowserOnly = (url: string) => BROWSER_ONLY_WEB_PATHS.some((p) => new URL(url).pathname.startsWith(p));',
      'export async function openWebPortal(url: string) {',
      '  if (isBrowserOnly(url)) return false;',
      '  return fallback(url);',
      '}',
    ].join('\n'),
    [FILES.legalCore]: [
      "export const LEGAL_SLUGS = ['dieu-khoan', 'bao-mat'] as const;",
      "export const LEGAL_PAGES = { 'dieu-khoan': { title: 'Điều khoản sử dụng' }, 'bao-mat': { title: 'Chính sách bảo mật' } };",
    ].join('\n'),
    [FILES.webPolicy]: "export type { LegalSlug as WebPolicySlug } from '@tubutree/app-core/legal-core';",
    [FILES.about]: [
      'export const About = () => (',
      '  <>',
      '    <LinkRow label="Điều khoản sử dụng" onClick={() => setPolicy(\'dieu-khoan\')} />',
      '    <LinkRow label="Chính sách bảo mật" onClick={() => setPolicy(\'bao-mat\')} />',
      '  </>',
      ');',
    ].join('\n'),
    [FILES.checkout]: "export const C = () => <p><ConsentLink onPress={() => setPolicy('dieu-khoan')}>Điều khoản</ConsentLink> <ConsentLink onPress={() => setPolicy('bao-mat')}>Bảo mật</ConsentLink></p>;",
    [FILES.webLegalPage]: "import { LEGAL_SLUGS, isLegalSlug } from '@/lib/legal';",
    [FILES.appRoutes]: 'export const R = () => <><Route path="/profile" element={<P />} /><Route path="/settings" element={<S />} /></>;',
    [FILES.navConfig]: "const NAV = { profile: { path: '/profile', Icon: User } };",
    [FILES.profileMenu]: "rows.push({ kind: 'link', key: 'settings', label: t.settings, mini: '/settings', web: '/tai-khoan/cai-dat' });",
    [FILES.settings]: "import { AccountDeletionSection } from '../components/account-deletion-section';\nexport const S = () => <AccountDeletionSection />;",
    [FILES.deletionSection]: 'export const go = () => requestAccountDeletion(undefined, consent);',
    [FILES.accountApiCore]: "export const r = (http) => http.post('/me/deletion-request', {});",
    [FILES.usersController]: "export class UsersController { @Post('me/deletion-request') request() {} }",
    [FILES.consentWebhook]: "export const ZALO_REVOKE_CONSENT_EVENT = 'user.revoke.consent';",
    [FILES.checkoutRules]: "export const CHECKOUT_PAYMENT_METHODS = ['COD', 'BANK_TRANSFER', 'WALLET'] as const;",
    [FILES.webPortalScreens]: [
      'export const WEB_PORTAL_SCREENS = {',
      "  '/admin': { title: 'Q', audience: 'A', webPath: '/admin' },",
      "  '/dealer': { title: 'D', audience: 'A', webPath: '/dai-ly', browserOnly: true },",
      '} as const;',
    ].join('\n'),
    [FILES.webPortalRedirect]: PORTAL_REDIRECT,
    [`${MINI_SRC}/components/checkout/transfer-preview.tsx`]: "export function warm() { const link = document.createElement('link'); link.href = 'https://img.vietqr.io'; }",
  };
}

function run(repo: Record<string, string>) {
  return checkSubmission({
    read: (p) => (Object.hasOwn(repo, p) ? repo[p]! : null),
    list: (dir) => Object.keys(repo).filter((p) => p.startsWith(`${dir}/`)),
  });
}

const failing = (checks: SubmissionCheck[]) => checks.filter((c) => !c.ok).map((c) => c.id);
const detail = (checks: SubmissionCheck[], id: string) => checks.find((c) => c.id === id)?.detail ?? '';

function withRepo(edit: (repo: Record<string, string>) => void) {
  const repo = goodRepo();
  edit(repo);
  return run(repo).checks;
}

describe('scripts/zalo-review/check-submission: hồ sơ gửi duyệt Zalo Mini App', () => {
  it('repo đủ điều kiện: mọi mục đạt, đủ bốn nhóm', () => {
    const { checks, failed } = run(goodRepo());
    expect(failing(checks)).toEqual([]);
    expect(failed).toBe(0);
    expect([...new Set(checks.map((c) => c.group))]).toEqual(['Quyền', 'Pháp lý', 'Xoá tài khoản', 'Thanh toán']);
  });

  describe('Quyền', () => {
    it('gọi API cần quyền chưa khai: đỏ, nói rõ API và chỗ gọi', () => {
      const checks = withRepo((r) => {
        r[FILES.bridge] = `${r[FILES.bridge]!.replace('getPhoneNumber, login', 'getPhoneNumber, getLocation, login')}\nexport const loc = () => getLocation({});`;
      });
      expect(failing(checks)).toContain('perm.declared:scope.userLocation');
      expect(detail(checks, 'perm.declared:scope.userLocation')).toContain('getLocation ở services/zmp-bridge.ts:1');
      expect(detail(checks, 'perm.api-listed')).toContain('getLocation');
    });

    it('import API cần quyền mà không dùng tới: không tính là xin quyền, chỉ đỏ ở mục API chưa có lý do', () => {
      const checks = withRepo((r) => {
        r[FILES.bridge] = r[FILES.bridge]!.replace('getPhoneNumber, login', 'getPhoneNumber, getLocation, login');
      });
      expect(failing(checks)).toEqual(['perm.api-listed']);
      expect(checks.some((c) => c.id === 'perm.declared:scope.userLocation')).toBe(false);
    });

    it('createCameraContext cần cả camera lẫn micro; authorize thì mọi chuỗi scope.x trong mã Mini App đều tính', () => {
      const camera = withRepo((r) => {
        r[FILES.bridge] = `${r[FILES.bridge]!.replace('getPhoneNumber, login', 'createCameraContext, getPhoneNumber, login')}\nexport const cam = () => createCameraContext({});`;
      });
      expect(failing(camera)).toEqual(['perm.declared:scope.camera', 'perm.declared:scope.micro', 'perm.api-listed']);
      const listed = withRepo((r) => {
        const m = structuredClone(MANIFEST);
        m.scopes['scope.userPhonenumber'].apis = ['getPhoneNumber', 'authorize'];
        r[FILES.permissions] = JSON.stringify(m);
        r[FILES.bridge] = `${r[FILES.bridge]!.replace('getPhoneNumber, login', 'authorize, getPhoneNumber, login')}\nexport const ask = (scopes: string[]) => authorize({ scopes });`;
        r[`${MINI_SRC}/utils/scopes.ts`] = "export const SCOPES = ['scope.userPhonenumber', 'scope.camera'];";
      });
      expect(failing(listed)).toEqual(['perm.declared:scope.camera']);
      expect(detail(listed, 'perm.declared:scope.camera')).toBe(
        'scope.camera được gọi (scope.camera ở utils/scopes.ts) nhưng chưa khai trong apps/miniapp/zalo-permissions.json',
      );
    });

    it('khai scope không còn lời gọi: đỏ (Zalo trả hồ sơ xin quyền không dùng)', () => {
      const checks = withRepo((r) => {
        const m = structuredClone(MANIFEST) as typeof MANIFEST & { scopes: Record<string, unknown> };
        m.scopes['scope.userInfo'] = { apis: ['getUserInfo'], purpose: 'Điền sẵn tên người nhận ở sổ địa chỉ.', trigger: 'Khi khách bấm Điền nhanh từ Zalo.' };
        r[FILES.permissions] = JSON.stringify(m);
      });
      expect(failing(checks)).toEqual(['perm.used:scope.userInfo']);
    });

    it('navigator.geolocation cũng tính là dùng vị trí', () => {
      const checks = withRepo((r) => {
        r[`${MINI_SRC}/services/attendance.ts`] = 'export const p = () => navigator.geolocation.getCurrentPosition(() => {});';
      });
      expect(failing(checks)).toEqual(['perm.declared:scope.userLocation']);
    });

    it('API cần quyền import ngoài zmp-bridge.ts: đỏ', () => {
      const checks = withRepo((r) => {
        r[`${MINI_SRC}/pages/x.tsx`] = "import { getPhoneNumber } from 'zmp-sdk/apis';\nexport const x = () => getPhoneNumber({});";
      });
      expect(failing(checks)).toEqual(['perm.gate']);
      expect(detail(checks, 'perm.gate')).toContain('pages/x.tsx:1: getPhoneNumber');
    });

    it('import * as, import mặc định, import() từ zmp-sdk: đỏ vì không đếm được API; import kiểu và tệp spec không tính', () => {
      const checks = withRepo((r) => {
        r[`${MINI_SRC}/a.ts`] = "import * as zmp from 'zmp-sdk/apis';\nimport sdk from 'zmp-sdk';\nexport const l = () => import('zmp-sdk/apis');";
        r[`${MINI_SRC}/b.ts`] = "import type { UserInfo } from 'zmp-sdk/apis';\nimport { type AppInfo } from 'zmp-sdk';";
        r[`${MINI_SRC}/c.spec.ts`] = "import { openChat, getLocation } from 'zmp-sdk/apis';";
      });
      expect(failing(checks)).toEqual(['perm.import-form']);
      expect(detail(checks, 'perm.import-form')).toBe(
        'import không kiểm được, đổi sang import theo tên: a.ts:1: import * as từ zmp-sdk; a.ts:2: import mặc định từ zmp-sdk; a.ts:3: import() từ zmp-sdk',
      );
    });

    it('API zmp-sdk mới chưa có lý do, lý do của API không ai gọi, API cần quyền nằm nhầm noScopeApis: đỏ', () => {
      const added = withRepo((r) => {
        r[`${MINI_SRC}/chat.ts`] = "import { openChat } from 'zmp-sdk/apis';\nexport const c = () => openChat({ type: 'oa', id: '1' });";
      });
      expect(failing(added)).toEqual(['perm.api-listed']);
      expect(detail(added, 'perm.api-listed')).toBe('API chưa có lý do: openChat (chat.ts:1)');
      const stale = withRepo((r) => {
        r[FILES.permissions] = JSON.stringify({ ...MANIFEST, noScopeApis: { login: 'Đăng nhập ngầm.', vibrate: 'Rung.', getPhoneNumber: 'nhầm' } });
      });
      expect(detail(stale, 'perm.api-listed')).toBe('API cần quyền nằm nhầm ở noScopeApis: getPhoneNumber; noScopeApis còn API không ai gọi: vibrate');
    });

    it('mục đích quá ngắn hoặc apis sai bảng scope: đỏ', () => {
      const checks = withRepo((r) => {
        r[FILES.permissions] = JSON.stringify({ ...MANIFEST, scopes: { 'scope.userPhonenumber': { apis: ['getLocation'], purpose: 'SĐT', trigger: '' } } });
      });
      expect(failing(checks)).toContain('perm.purpose:scope.userPhonenumber');
    });

    it('thiếu tệp khai, app-config nạp JS ngoài: đỏ', () => {
      const checks = withRepo((r) => {
        delete r[FILES.permissions];
        r[FILES.appConfig] = JSON.stringify({ app: { appId: '123', title: 'Tubu Tree' }, listJS: ['https://cdn.example.com/a.js'] });
      });
      expect(failing(checks)).toEqual(expect.arrayContaining(['perm.manifest', 'perm.app-config', 'legal.console-links']));
    });
  });

  describe('Pháp lý', () => {
    it('trang Về Tubu Tree thiếu Chính sách bảo mật hoặc gọi sai tên: đỏ', () => {
      const missing = withRepo((r) => {
        r[FILES.about] = r[FILES.about]!.replace(/.*bao-mat.*\n/, '');
      });
      expect(failing(missing)).toEqual(['legal.hub']);
      expect(detail(missing, 'legal.hub')).toBe('trang Về Tubu Tree thiếu: bao-mat');
      const renamed = withRepo((r) => {
        r[FILES.about] = r[FILES.about]!.replace('label="Chính sách bảo mật"', 'label="Quyền riêng tư"');
      });
      expect(detail(renamed, 'legal.hub')).toBe('tên dòng lệch LEGAL_PAGES: bao-mat: "Quyền riêng tư" ≠ "Chính sách bảo mật"');
    });

    it('mở chính sách không có trong LEGAL_SLUGS (kể cả setPolicySlug, <PolicySheet slug>): đỏ', () => {
      const checks = withRepo((r) => {
        r[`${MINI_SRC}/pages/pdp.tsx`] = "export const P = () => <><Button onPress={() => setPolicySlug('van-chuyen')} /><PolicySheet slug=\"hoan-tien\" onClose={f} /></>;";
      });
      expect(failing(checks)).toEqual(['legal.slug-literals']);
      expect(detail(checks, 'legal.slug-literals')).toBe('slug không có trong LEGAL_SLUGS: pages/pdp.tsx:1: "van-chuyen"; pages/pdp.tsx:1: "hoan-tien"');
    });

    it('thanh toán thiếu link Bảo mật, web-policy tự liệt kê slug, link console không phải bao-mat: đỏ', () => {
      const checks = withRepo((r) => {
        r[FILES.checkout] = "export const C = () => <ConsentLink onPress={() => setPolicy('dieu-khoan')}>Điều khoản</ConsentLink>;";
        r[FILES.webPolicy] = "export type WebPolicySlug = 'dieu-khoan' | 'bao-mat';";
        r[FILES.permissions] = JSON.stringify({ ...MANIFEST, consoleLinks: { privacyPolicy: 'dieu-khoan', terms: 'dieu-khoan' } });
      });
      expect(failing(checks)).toEqual(['legal.web-policy', 'legal.checkout-consent', 'legal.console-links']);
    });

    it('web-policy: re-export nằm trong chú thích thì đỏ; bí danh kiểu trỏ tới LegalSlug import từ legal-core thì đạt', () => {
      const commented = withRepo((r) => {
        r[FILES.webPolicy] = "// export type { LegalSlug as WebPolicySlug } from '@tubutree/app-core/legal-core';\nexport type WebPolicySlug = 'dieu-khoan';";
      });
      expect(failing(commented)).toEqual(['legal.web-policy']);
      const alias = withRepo((r) => {
        r[FILES.webPolicy] = "import type { LegalSlug } from '@tubutree/app-core/legal-core';\nexport type WebPolicySlug = LegalSlug;";
      });
      expect(failing(alias)).toEqual([]);
    });

    it('link Điều khoản trên console không phải dieu-khoan: đỏ', () => {
      const checks = withRepo((r) => {
        r[FILES.permissions] = JSON.stringify({ ...MANIFEST, consoleLinks: { privacyPolicy: 'bao-mat', terms: 'bao-mat' } });
      });
      expect(failing(checks)).toEqual(['legal.console-links']);
    });
  });

  it('Xoá tài khoản: Cài đặt không còn khối xoá hoặc API mất route: đỏ, nói chỗ đứt', () => {
    const checks = withRepo((r) => {
      r[FILES.settings] = 'export const S = () => <div />;';
      delete r[FILES.usersController];
    });
    expect(failing(checks)).toEqual(['delete.reachable']);
    expect(detail(checks, 'delete.reachable')).toBe('đứt ở: khối Xoá tài khoản ở Cài đặt, API nhận yêu cầu');
  });

  it('Xoá tài khoản: khối xoá chỉ còn trong chú thích: đỏ', () => {
    const checks = withRepo((r) => {
      r[FILES.settings] = "// import { AccountDeletionSection } from '../components/account-deletion-section';\nexport const S = () => <div>{/* <AccountDeletionSection /> */}</div>;";
    });
    expect(detail(checks, 'delete.reachable')).toBe('đứt ở: khối Xoá tài khoản ở Cài đặt');
  });

  describe('Thanh toán', () => {
    it('link cổng thanh toán (cả trong tham số), mở app ví, tên miền lạ (cả //host), trang thanh toán web, host dựng động: đỏ kèm tệp:dòng; chú thích và new URL(...) không tính', () => {
      const checks = withRepo((r) => {
        r[`${MINI_SRC}/pages/pay.tsx`] = [
          '// xem https://payment.momo.vn/docs (chỉ là chú thích)',
          "export const a = 'https://payment.momo.vn/pay?x=1';",
          "export const b = 'momo://app?action=pay';",
          'export const c = `https://example.com/landing`;',
          "export const d = 'https://tubutree.com/thanh-toan/chuyen-khoan/X';",
          'export const e = (host: string) => `https://${host}/x`;',
          "export const f = 'https://dl.vietqr.io/pay?app=vcb';",
          'export const g = (h: string) => new URL(`https://${h}/x`).searchParams;',
          "export const h = '//evil.example.com/x';",
          "export const i = 'https://zalo.me/r?u=pay.zalopay.vn';",
        ].join('\n');
      });
      expect(failing(checks)).toEqual(['pay.links']);
      expect(detail(checks, 'pay.links').split('; ')).toEqual([
        'pages/pay.tsx:2: link cổng thanh toán ngoài payment.momo.vn',
        'pages/pay.tsx:3: đường dẫn mở app ngoài "momo://"',
        'pages/pay.tsx:4: tên miền chưa duyệt example.com (không phải trang thanh toán thì thêm vào ALLOWED_HOSTS kèm lý do)',
        'pages/pay.tsx:5: link tới trang mua hàng của web tubutree.com/thanh-toan/chuyen-khoan/X',
        'pages/pay.tsx:6: link dựng tên miền lúc chạy, không kiểm được (mở link ngoài qua zmp-bridge.ts)',
        'pages/pay.tsx:7: link cổng thanh toán ngoài dl.vietqr.io',
        'pages/pay.tsx:9: tên miền chưa duyệt evil.example.com (không phải trang thanh toán thì thêm vào ALLOWED_HOSTS kèm lý do)',
        'pages/pay.tsx:10: link cổng thanh toán ngoài pay.zalopay.vn',
      ]);
    });

    it('quét cả tệp app-core mà Mini App nạp (lần theo import, bỏ import kiểu và tệp không ai nạp)', () => {
      const checks = withRepo((r) => {
        r[`${MINI_SRC}/pages/p.tsx`] = "import { PAY } from '@tubutree/app-core/pay-links';\nimport type { T } from '@tubutree/app-core/types-only';\nexport const p: T = PAY;";
        r['packages/app-core/src/pay-links.ts'] = "export { DEEP } from './deep';\nexport const PAY = 'https://pay.vnpay.vn/x';";
        r['packages/app-core/src/deep/index.ts'] = "export const DEEP = 'momo://pay';";
        r['packages/app-core/src/types-only.ts'] = "export type T = string;\nexport const X = 'https://evil.example.com';";
        r['packages/app-core/src/unused.ts'] = "export const U = 'https://evil.example.com';";
      });
      expect(failing(checks)).toEqual(['pay.links']);
      expect(detail(checks, 'pay.links').split('; ')).toEqual([
        'app-core/deep/index.ts:1: đường dẫn mở app ngoài "momo://"',
        'app-core/pay-links.ts:2: link cổng thanh toán ngoài pay.vnpay.vn',
      ]);
    });

    it('window.open, ghi location ngoài zmp-bridge.ts, openWebview link không phải Zalo: đỏ; openWebview tới zalo.me viết sẵn thì đạt', () => {
      const checks = withRepo((r) => {
        r[`${MINI_SRC}/components/order-zalo.tsx`] = "export const z = (p: string) => openWebview({ url: `https://zalo.me/${p}` });";
        r[`${MINI_SRC}/pages/bad.tsx`] = [
          "export const a = () => window.open('/x');",
          'export const b = (u: string) => { window.location.href = u; };',
          'export const c = (url: string) => openWebview({ url });',
          "export const d = () => globalThis.open('/y');",
          "export const e = () => window['open']('/z');",
          'export const f = (u: string) => location.assign(u);',
        ].join('\n');
      });
      expect(failing(checks)).toEqual(['pay.navigation']);
      expect(detail(checks, 'pay.navigation').split('; ')).toEqual([
        'pages/bad.tsx:1: window.open mở trang ngoài Mini App',
        'pages/bad.tsx:2: ghi window.location.href ngoài zmp-bridge.ts',
        'pages/bad.tsx:3: openWebview ngoài zmp-bridge.ts phải là link https://zalo.me/ hoặc https://oa.zalo.me/ viết sẵn',
        'pages/bad.tsx:4: globalThis.open mở trang ngoài Mini App',
        'pages/bad.tsx:5: window.open mở trang ngoài Mini App',
        'pages/bad.tsx:6: gọi location.assign ngoài zmp-bridge.ts',
      ]);
    });

    it('openWebview gán sang tên khác vẫn bị kiểm; openMiniApp đỏ dù đã ghi lý do', () => {
      const checks = withRepo((r) => {
        r[FILES.permissions] = JSON.stringify({ ...MANIFEST, noScopeApis: { ...MANIFEST.noScopeApis, openWebview: 'Mở OA.', openMiniApp: 'Mở app khác.' } });
        r[`${MINI_SRC}/pages/alias.ts`] = [
          "import { openWebview, openMiniApp } from 'zmp-sdk/apis';",
          'const go = openWebview;',
          'export const a = (url: string) => go({ url });',
          "export const b = () => openMiniApp({ appId: '1' });",
        ].join('\n');
      });
      expect(failing(checks)).toEqual(['pay.navigation']);
      expect(detail(checks, 'pay.navigation').split('; ')).toEqual([
        'pages/alias.ts:1: openMiniApp: API mở sang app hoặc Mini App khác, không dùng trong Mini App bán hàng',
        'pages/alias.ts:3: openWebview ngoài zmp-bridge.ts phải là link https://zalo.me/ hoặc https://oa.zalo.me/ viết sẵn',
      ]);
    });

    it('mở ZaloPay ở màn thanh toán, cho openExternal mở host khác, cổng web dẫn tới /thanh-toan: đỏ', () => {
      const checks = withRepo((r) => {
        r[FILES.checkoutRules] = "export const CHECKOUT_PAYMENT_METHODS = ['COD', 'BANK_TRANSFER', 'ZALOPAY'] as const;";
        r[FILES.bridge] = r[FILES.bridge]!.replace("'oa.zalo.me'", "'oa.zalo.me', 'shopee.vn'");
        r[FILES.webPortalScreens] = "export const WEB_PORTAL_SCREENS = { '/pay': { title: 'T', audience: 'A', webPath: '/thanh-toan' } } as const;";
      });
      expect(failing(checks)).toEqual(['pay.bridge-hosts', 'pay.methods', 'pay.portal']);
      expect(detail(checks, 'pay.methods')).toBe('CHECKOUT_PAYMENT_METHODS chỉ được gồm COD, BANK_TRANSFER, WALLET (thừa: ZALOPAY)');
    });
  });

  describe('Thanh toán: /dai-ly chỉ mở bằng trình duyệt (PO A3)', () => {
    it('BROWSER_ONLY_WEB_PATHS là trang đại lý của web', () => {
      expect(BROWSER_ONLY_WEB_PATHS).toEqual(['/dai-ly']);
    });

    it('màn cổng web trỏ tới /dai-ly (kể cả trang con, query) thiếu browserOnly: true, hoặc cờ chỉ nằm trong chú thích: đỏ', () => {
      const checks = withRepo((r) => {
        r[FILES.webPortalScreens] = [
          'export const WEB_PORTAL_SCREENS = {',
          "  '/dealer': { title: 'D', audience: 'A', webPath: '/dai-ly' /* browserOnly: true */ },",
          "  '/dealer/orders': { title: 'O', audience: 'A', webPath: '/dai-ly/don?tab=1', browserOnly: false },",
          "  '/admin': { title: 'Q', audience: 'A', webPath: '/admin' },",
          '} as const;',
        ].join('\n');
      });
      expect(failing(checks)).toEqual(['pay.portal-browser-only']);
      expect(detail(checks, 'pay.portal-browser-only').split('; ')).toEqual([
        'pages/web-portal-screens.ts: màn /dealer trỏ tới /dai-ly (trang có thanh toán) phải có browserOnly: true',
        'pages/web-portal-screens.ts: màn /dealer/orders trỏ tới /dai-ly/don?tab=1 (trang có thanh toán) phải có browserOnly: true',
      ]);
    });

    it('openWebPortal gọi không qua cờ (chặn chỉ ở nút, chặn trong chú thích, cờ tự đặt), gọi ở tệp khác hoặc truyền đi như giá trị: đỏ', () => {
      const ungated = withRepo((r) => {
        r[FILES.webPortalRedirect] = PORTAL_REDIRECT.replace('    if (browserOnly) return;\n', '    // if (browserOnly) return;\n');
      });
      expect(failing(ungated)).toEqual(['pay.portal-browser-only']);
      expect(detail(ungated, 'pay.portal-browser-only')).toBe(
        'pages/web-portal-redirect.tsx:7: openWebPortal(...) phải nằm sau if (browserOnly) return hoặc trong nhánh !browserOnly, với browserOnly lấy từ WEB_PORTAL_SCREENS',
      );

      const localFlag = withRepo((r) => {
        r[FILES.webPortalRedirect] = PORTAL_REDIRECT.replace('const { browserOnly }: WebPortalScreen = WEB_PORTAL_SCREENS[screen];', 'const browserOnly = false;');
      });
      expect(failing(localFlag)).toEqual(['pay.portal-browser-only']);

      const elsewhere = withRepo((r) => {
        r[`${MINI_SRC}/pages/dealer-hint.tsx`] = [
          "import { openWebPortal as go } from '../services/zmp-bridge';",
          "import * as bridge from '../services/zmp-bridge';",
          "export const a = () => go('https://tubutree.com/dai-ly');",
          "export const b = () => bridge.openWebPortal('https://tubutree.com/dai-ly');",
        ].join('\n');
        r[FILES.webPortalRedirect] = PORTAL_REDIRECT.replace('<Button onPress={open}>', '<Button onPress={openWebPortal}>');
      });
      expect(failing(elsewhere)).toEqual(['pay.portal-browser-only']);
      expect(detail(elsewhere, 'pay.portal-browser-only').split('; ')).toEqual([
        'pages/dealer-hint.tsx:3: openWebPortal chỉ được gọi ở pages/web-portal-redirect.tsx (nơi có cờ browserOnly)',
        'pages/dealer-hint.tsx:4: openWebPortal chỉ được gọi ở pages/web-portal-redirect.tsx (nơi có cờ browserOnly)',
        'pages/web-portal-redirect.tsx:9: openWebPortal phải được gọi thẳng, không truyền đi như giá trị',
      ]);
    });

    it('cách chặn khác ở màn chuyển web vẫn đạt: if (!cờ) { ... }, cờ && gọi, cờ ? null : gọi, đọc thẳng WEB_PORTAL_SCREENS[x].browserOnly', () => {
      const variants = [
        PORTAL_REDIRECT.replace('    if (browserOnly) return;\n    await openWebPortal(url);', '    if (!browserOnly) { await openWebPortal(url); }'),
        PORTAL_REDIRECT.replace('    if (browserOnly) return;\n    await openWebPortal(url);', '    return !browserOnly && openWebPortal(url);'),
        PORTAL_REDIRECT.replace('    if (browserOnly) return;\n    await openWebPortal(url);', '    return browserOnly ? null : openWebPortal(url);'),
        PORTAL_REDIRECT.replace('    if (browserOnly) return;\n', '    if (WEB_PORTAL_SCREENS[screen].browserOnly) return;\n'),
      ];
      for (const source of variants) {
        expect(source).not.toBe(PORTAL_REDIRECT);
        expect(failing(withRepo((r) => (r[FILES.webPortalRedirect] = source)))).toEqual([]);
      }
    });

    it('zmp-bridge.ts không chặn /dai-ly (thiếu trong BROWSER_ONLY_WEB_PATHS, chặn sau openWebview, chặn trả true, chặn trong chú thích): đỏ', () => {
      const notListed = withRepo((r) => {
        r[FILES.bridge] = r[FILES.bridge]!.replace("const BROWSER_ONLY_WEB_PATHS = ['/dai-ly'];", "const BROWSER_ONLY_WEB_PATHS = ['/ctv'];");
      });
      expect(failing(notListed)).toEqual(['pay.portal-browser-only']);
      expect(detail(notListed, 'pay.portal-browser-only')).toBe('services/zmp-bridge.ts: BROWSER_ONLY_WEB_PATHS phải có /dai-ly');

      const broken = [
        (b: string) => b.replace('  if (isBrowserOnly(url)) return false;\n  return fallback(url);', '  await openWebview({ url });\n  if (isBrowserOnly(url)) return false;\n  return true;'),
        (b: string) => b.replace('if (isBrowserOnly(url)) return false;', 'if (isBrowserOnly(url)) return true;'),
        (b: string) => b.replace('if (isBrowserOnly(url)) return false;', '// if (isBrowserOnly(url)) return false;'),
      ];
      for (const edit of broken) {
        const checks = withRepo((r) => {
          r[FILES.bridge] = edit(r[FILES.bridge]!);
        });
        expect(failing(checks)).toEqual(['pay.portal-browser-only']);
        expect(detail(checks, 'pay.portal-browser-only')).toBe('services/zmp-bridge.ts: openWebPortal phải trả false trước openWebview khi link thuộc BROWSER_ONLY_WEB_PATHS');
      }
    });
  });

  it('isShippedSource: chỉ mã đi vào gói, bỏ spec, tệp hỗ trợ test, dữ liệu giả', () => {
    const shipped = ['src/a.ts', 'src/pages/b.tsx'];
    const notShipped = ['src/a.spec.ts', 'src/a.test.tsx', 'src/test/fetch-stub.ts', 'src/test-support/contrast.ts', 'src/vitest-setup.ts', 'src/services/waste-test-fixtures.ts', 'src/types.d.ts', 'src/a.css'];
    expect(shipped.filter(isShippedSource)).toEqual(shipped);
    expect(notShipped.filter(isShippedSource)).toEqual([]);
  });

  it('repo thật: Mini App hiện tại đạt mọi mục gửi duyệt', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const { checks } = checkSubmission(diskFiles(root));
    expect(checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(27);
    expect(checks.find((c) => c.id === 'pay.portal-browser-only')?.detail).toMatch(/^\/dai-ly chỉ mở bằng trình duyệt: 1 màn cổng web có browserOnly: true, 1 lời gọi openWebPortal/);
  });
});
