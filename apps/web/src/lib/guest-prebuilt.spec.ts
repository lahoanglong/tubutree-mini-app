// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GUEST_CART_COOKIE, GUEST_PREBUILT_ORIGINS, WEB_COOKIE_MAX_AGE_S, guestPrebuiltTarget } from './guest-prebuilt';
import { PUBLIC_CONFIG_STALE_MS, prebuiltConfigSeededAt, prebuiltMismatchScript } from './guest-prebuilt-script';
import { SESSION_COOKIE } from './home-restore-hint';

const jar = (c: Record<string, string>) => (name: string) => c[name];

describe('guestPrebuiltTarget', () => {
  it('chỉ hai trang có bản dựng sẵn; trang khác null', () => {
    expect(guestPrebuiltTarget('/gio-hang', jar({}))).toBe('/gio-hang/khach');
    expect(guestPrebuiltTarget('/vuon-xanh', jar({}))).toBe('/vuon-xanh/khach');
    for (const p of ['/', '/thanh-toan', '/gio-hang/khach', '/vuon-xanh/so-tay', '/tai-khoan']) expect(guestPrebuiltTarget(p, jar({})), p).toBeNull();
  });

  it('cookie phiên đúng "1" thì bản thường; giá trị khác không tính', () => {
    expect(guestPrebuiltTarget('/vuon-xanh', jar({ [SESSION_COOKIE]: '1' }))).toBeNull();
    expect(guestPrebuiltTarget('/vuon-xanh', jar({ [SESSION_COOKIE]: 'true' }))).toBe('/vuon-xanh/khach');
  });

  it('giỏ khách có món chỉ chặn bản dựng sẵn của Giỏ hàng', () => {
    expect(guestPrebuiltTarget('/gio-hang', jar({ [GUEST_CART_COOKIE]: '1' }))).toBeNull();
    expect(guestPrebuiltTarget('/vuon-xanh', jar({ [GUEST_CART_COOKIE]: '1' }))).toBe('/vuon-xanh/khach');
  });

  it('bảng ngược đủ hai chiều', () => {
    expect(GUEST_PREBUILT_ORIGINS).toEqual({ '/gio-hang/khach': '/gio-hang', '/vuon-xanh/khach': '/vuon-xanh' });
  });
});

type Run = { cookies: Map<string, string>; writes: string[]; replaced: string[]; guard: Map<string, string> };

/** Chạy script trong một trình duyệt giả: localStorage, sessionStorage, document.cookie, location đều là đồ giả ghi lại việc script làm. */
function runMismatch(
  kind: 'cart' | 'garden',
  opts: { local?: Record<string, string>; guard?: Record<string, string>; cookies?: Record<string, string>; blockCookies?: boolean; throwStorage?: boolean; protocol?: string } = {},
): Run {
  const cookies = new Map(Object.entries(opts.cookies ?? {}));
  const guard = new Map(Object.entries(opts.guard ?? {}));
  const writes: string[] = [];
  const replaced: string[] = [];
  const store = (m: Map<string, string>) => ({
    getItem: (k: string) => {
      if (opts.throwStorage) throw new Error('SecurityError');
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (opts.throwStorage) throw new Error('SecurityError');
      m.set(k, v);
    },
  });
  const document = {
    get cookie() {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(raw: string) {
      writes.push(raw);
      if (opts.blockCookies) return;
      const [pair = ''] = raw.split(';');
      const [k = '', v = ''] = pair.split('=');
      cookies.set(k.trim(), v.trim());
    },
  };
  const protocol = opts.protocol ?? 'https:';
  const href = `${protocol}//tubutree.com/${kind === 'cart' ? 'gio-hang' : 'vuon-xanh'}?utm_source=zalo#ke-goi-y`;
  // Ghi lại URL lúc tải lại; replace(href) với URL có `#` chỉ cuộn tới neo nên script không được dùng nó.
  const location = { protocol, pathname: kind === 'cart' ? '/gio-hang' : '/vuon-xanh', href, reload: () => replaced.push(href), replace: () => replaced.push('replace-chỉ-cuộn-tới-neo') };
  new Function('localStorage', 'sessionStorage', 'document', 'location', prebuiltMismatchScript(kind))(store(new Map(Object.entries(opts.local ?? {}))), store(guard), document, location);
  return { cookies, writes, replaced, guard };
}

const CART_LINE = JSON.stringify([{ variationId: 'v1', slug: 'nuoc-giat', quantity: 2, addedAt: 1 }]);

describe('prebuiltMismatchScript: bản khách dựng sẵn mà máy có phiên hoặc giỏ khách (w7-04 M3, M4)', () => {
  it('Vườn Xanh: còn dấu phiên mà mất cookie → ghi lại cookie như writeWebCookie rồi tải lại đúng một lần, giữ URL', () => {
    const run = runMismatch('garden', { local: { [SESSION_COOKIE]: '1' } });
    expect(run.writes).toEqual([`${SESSION_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax; Secure`]);
    expect(run.replaced).toEqual(['https://tubutree.com/vuon-xanh?utm_source=zalo#ke-goi-y']);
    expect(run.guard.size).toBe(1);
  });

  it('đã tải lại một lần trong tab này (cookie vẫn không tới máy chủ) thì không tải lại nữa: không vòng lặp', () => {
    const first = runMismatch('garden', { local: { [SESSION_COOKIE]: '1' } });
    const again = runMismatch('garden', { local: { [SESSION_COOKIE]: '1' }, guard: Object.fromEntries(first.guard) });
    expect(again.replaced).toEqual([]);
  });

  it('Giỏ hàng: khách chưa đăng nhập có giỏ cũ (tạo trước khi có cookie giỏ) → ghi cookie giỏ rồi tải lại sang bản thường', () => {
    const run = runMismatch('cart', { local: { 'tubu.guestCart.v1': CART_LINE } });
    expect(run.writes).toEqual([`${GUEST_CART_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax; Secure`]);
    expect(run.replaced).toEqual(['https://tubutree.com/gio-hang?utm_source=zalo#ke-goi-y']);
  });

  it('Giỏ hàng có cả dấu phiên: ghi cookie phiên (middleware xét cookie phiên trước)', () => {
    const run = runMismatch('cart', { local: { [SESSION_COOKIE]: '1', 'tubu.guestCart.v1': CART_LINE } });
    expect(run.writes).toEqual([`${SESSION_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax; Secure`]);
    expect(run.replaced).toHaveLength(1);
  });

  it('khách thật sự mới (không dấu phiên, giỏ trống), Vườn Xanh có giỏ: không ghi gì, không tải lại', () => {
    for (const run of [
      runMismatch('garden'),
      runMismatch('cart'),
      runMismatch('cart', { local: { [SESSION_COOKIE]: '0', 'tubu.guestCart.v1': '[]' } }),
      runMismatch('garden', { local: { 'tubu.guestCart.v1': CART_LINE } }),
    ]) {
      expect(run.writes).toEqual([]);
      expect(run.replaced).toEqual([]);
    }
  });

  it('luật "giỏ có món" trùng parseGuestCart: dòng sai dạng, JSON hỏng không tính là có món', async () => {
    const { parseGuestCart } = await import('./guest-cart/store');
    const raws = [
      CART_LINE,
      '[{"variationId":"v 1","slug":"a","quantity":1}]',
      '[{"variationId":"v1","slug":"a/b","quantity":1}]',
      '[{"variationId":"v1","slug":"a","quantity":0}]',
      '[{"variationId":"v1","slug":"a","quantity":"2"}]',
      '[{"variationId":"v1","slug":"a","quantity":1.5}]',
      `[{"variationId":"${'x'.repeat(65)}","slug":"a","quantity":1}]`,
      '[null,{"variationId":"v2","slug":"b","quantity":3}]',
      '{"variationId":"v1","slug":"a","quantity":1}',
      '{broken',
      '',
    ];
    for (const raw of raws) {
      const run = runMismatch('cart', { local: { 'tubu.guestCart.v1': raw } });
      expect(run.replaced.length === 1, raw).toBe(parseGuestCart(raw).length > 0);
    }
  });

  it('trình duyệt chặn cookie: không tải lại (tải lại cũng nhận đúng bản khách này)', () => {
    const run = runMismatch('garden', { local: { [SESSION_COOKIE]: '1' }, blockCookies: true });
    expect(run.replaced).toEqual([]);
    expect(run.guard.size).toBe(0);
  });

  it('trình duyệt chặn storage: script nuốt lỗi, trang chạy như cũ', () => {
    expect(runMismatch('cart', { throwStorage: true }).replaced).toEqual([]);
  });

  it('hạn cookie bằng writeWebCookie của client-api (30 ngày)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./client-api.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/const SESSION_COOKIE_MAX_AGE_S = 30 \* 24 \* 3600;/);
    expect(WEB_COOKIE_MAX_AGE_S).toBe(30 * 24 * 3600);
  });

  it('http (máy dev): cookie không gắn Secure', () => {
    expect(runMismatch('garden', { local: { [SESSION_COOKIE]: '1' }, protocol: 'http:' }).writes).toEqual([`${SESSION_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax`]);
  });

  it('chuỗi script không đóng được thẻ <script>', () => {
    for (const kind of ['cart', 'garden'] as const) expect(prebuiltMismatchScript(kind)).not.toMatch(/<\/script/i);
  });
});

describe('prebuiltConfigSeededAt: cấu hình nạp sẵn hết tươi cùng lúc bản ISR hết hạn (w7-04 M6)', () => {
  it('mốc lùi để cấu hình thôi tươi đúng `revalidate` giây sau lúc dựng: khách nhận HTML cũ hơn thì tải lại cấu hình ngay', () => {
    const renderedAt = 1_763_600_000_000;
    expect(prebuiltConfigSeededAt(renderedAt, 60) + PUBLIC_CONFIG_STALE_MS).toBe(renderedAt + 60_000);
  });

  it('revalidate dài hơn staleTime thì giữ nguyên mốc (không đẩy về tương lai)', () => {
    expect(prebuiltConfigSeededAt(1_000_000, 600)).toBe(1_000_000);
  });

  it('PUBLIC_CONFIG_STALE_MS bằng staleTime của usePublicConfig', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./use-public-config.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/staleTime: 5 \* 60_000/);
    expect(PUBLIC_CONFIG_STALE_MS).toBe(5 * 60_000);
  });
});
