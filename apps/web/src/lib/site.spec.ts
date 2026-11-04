import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Q-20 (C-095): tên miền chính của web là app.tubutree.com — host đang phục vụ web trên PROD, và
// middleware coi "shop" là subdomain gian hàng CTV nên không thể dùng shop.tubutree.com làm gốc.

const repoFile = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)), 'utf8');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadSite() {
  vi.resetModules();
  return import('./site');
}

describe('SITE_URL', () => {
  it('mặc định là https://app.tubutree.com khi không cấu hình', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined as unknown as string);
    const { SITE_URL } = await loadSite();
    expect(SITE_URL).toBe('https://app.tubutree.com');
  });

  // Dockerfile khai ARG rồi ENV nên build không truyền arg vẫn nhúng chuỗi rỗng vào bundle;
  // `new URL('')` trong layout.tsx sẽ ném lỗi nếu SITE_URL rỗng.
  it.each(['', '   '])('chuỗi rỗng %j cũng rơi về https://app.tubutree.com', async (raw) => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', raw);
    const { SITE_URL } = await loadSite();
    expect(SITE_URL).toBe('https://app.tubutree.com');
    expect(() => new URL(SITE_URL)).not.toThrow();
  });

  it('lấy từ NEXT_PUBLIC_SITE_URL và bỏ dấu / ở cuối', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.tubutree.com//');
    const { SITE_URL } = await loadSite();
    expect(SITE_URL).toBe('https://staging.tubutree.com');
  });

  it('robots.txt trỏ sitemap về cùng gốc', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined as unknown as string);
    vi.resetModules();
    const robots = (await import('../app/robots')).default;
    expect(robots().sitemap).toBe('https://app.tubutree.com/sitemap.xml');
  });
});

describe('NEXT_PUBLIC_SITE_URL lúc build', () => {
  // NEXT_PUBLIC_* bị nhúng vào bundle lúc `next build`, nên phải đi qua build arg của Dockerfile.
  it('docker-compose.vietnix.yml truyền NEXT_PUBLIC_SITE_URL cho web theo WEB_DOMAIN', () => {
    const compose = repoFile('docker-compose.vietnix.yml');
    const web = compose.slice(compose.indexOf('\n  web:'), compose.indexOf('\nvolumes:'));
    expect(web).toMatch(/args:[\s\S]*NEXT_PUBLIC_SITE_URL: https:\/\/app\.\$\{WEB_DOMAIN\}/);
  });

  it('Dockerfile của web khai báo ARG và ENV NEXT_PUBLIC_SITE_URL trước bước build', () => {
    const dockerfile = repoFile('apps/web/Dockerfile');
    const arg = dockerfile.indexOf('ARG NEXT_PUBLIC_SITE_URL');
    const env = dockerfile.indexOf('ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL');
    const build = dockerfile.indexOf('RUN pnpm --filter @tubutree/web build');
    expect(arg).toBeGreaterThan(-1);
    expect(env).toBeGreaterThan(arg);
    expect(build).toBeGreaterThan(env);
  });
});

describe('Dockerfile nhận tên miền gốc của gian hàng', () => {
  it('khai ARG/ENV NEXT_PUBLIC_TENANT_ROOT_DOMAIN trước bước build (middleware nhúng giá trị lúc build)', () => {
    const dockerfile = repoFile('apps/web/Dockerfile');
    const arg = dockerfile.indexOf('ARG NEXT_PUBLIC_TENANT_ROOT_DOMAIN');
    const env = dockerfile.indexOf('ENV NEXT_PUBLIC_TENANT_ROOT_DOMAIN=$NEXT_PUBLIC_TENANT_ROOT_DOMAIN');
    const build = dockerfile.indexOf('RUN pnpm --filter @tubutree/web build');
    expect(arg).toBeGreaterThan(-1);
    expect(env).toBeGreaterThan(arg);
    expect(build).toBeGreaterThan(env);
  });
});

describe('isPortalPath', () => {
  it('nhận /admin, /merchant và cây con; không nhận trang khách (kể cả /brand/[slug] công khai)', async () => {
    const { isPortalPath } = await loadSite();
    for (const p of ['/admin', '/admin/orders', '/merchant', '/merchant/x']) {
      expect(isPortalPath(p), p).toBe(true);
    }
    for (const p of ['/', '/san-pham/abc', '/brand/abc', '/administrator', '/s/abc', '/tai-khoan', null, undefined]) {
      expect(isPortalPath(p), String(p)).toBe(false);
    }
  });
});

describe('tenantSubdomainOf', () => {
  // Phải khớp middleware.ts: subdomain nào không thuộc hệ thống thì "/" được rewrite sang /s/{subdomain}.
  it('nhận subdomain gian hàng, bỏ qua host gốc, www/app/admin/api/mail và localhost', async () => {
    const { tenantSubdomainOf } = await loadSite();
    expect(tenantSubdomainOf('ctv-an.tubutree.com')).toBe('ctv-an');
    expect(tenantSubdomainOf('Ctv-An.tubutree.com:3000')).toBe('ctv-an');
    expect(tenantSubdomainOf('ctv-an.localhost:3000')).toBe('ctv-an');
    for (const h of ['tubutree.com', 'app.tubutree.com', 'www.tubutree.com', 'admin.tubutree.com', 'api.tubutree.com', 'mail.tubutree.com', 'localhost:3000', 'localhost', 'tubutree-web-git-main-x.vercel.app', 'ctv-an.example.com', '', null, undefined]) {
      expect(tenantSubdomainOf(h), String(h)).toBeNull();
    }
  });
});

// PC-7: trang dựng sẵn (ISR) có HTML giống nhau cho mọi host nên ô tìm kiếm luôn có trong HTML đầu tiên; ẩn nó bằng
// effect sau hydrate thì host gian hàng CTV thấy ô hiện lên rồi biến mất. Script nhỏ ở <head> đánh dấu host gian
// hàng trước khi vẽ để CSS ẩn ô ngay từ khung hình đầu. Quy tắc nhận host phải đúng như tenantSubdomainOf/middleware.
describe('tenantHostBootScript', () => {
  const HOSTS = [
    'ctv-an.tubutree.com', 'ctv-an.tubutree.com:3000', 'CTV-AN.Tubutree.Com', 'ctv-an.localhost:3112', 'a.b.tubutree.com',
    'tubutree.com', 'app.tubutree.com', 'www.tubutree.com', 'admin.tubutree.com', 'api.tubutree.com', 'mail.tubutree.com',
    'tubutree-web-git-main-x.vercel.app', 'ctv-an.example.com', 'ctv-an.nottubutree.com', 'app.localhost:3112', 'localhost:3112', 'localhost', '',
  ];
  const run = (script: string, host: string) => {
    const attrs: string[] = [];
    vm.runInNewContext(script, { location: { host }, document: { documentElement: { setAttribute: (k: string) => attrs.push(k) } } });
    return attrs;
  };

  it.each(HOSTS)('host %j: đặt data-tenant-host đúng khi và chỉ khi tenantSubdomainOf nhận ra gian hàng', async (host) => {
    const { tenantHostBootScript, tenantSubdomainOf } = await loadSite();
    const attrs = run(tenantHostBootScript(), host);
    expect(attrs.includes('data-tenant-host')).toBe(tenantSubdomainOf(host) !== null);
  });

  it('không ném lỗi khi môi trường thiếu location (script chạy trước mọi thứ, không được làm hỏng trang)', async () => {
    const { tenantHostBootScript } = await loadSite();
    expect(() => vm.runInNewContext(tenantHostBootScript(), {})).not.toThrow();
  });
});

describe('PRIVATE_PATHS và robots từ route map', () => {
  it('giữ danh sách cũ và thêm tiền tố riêng tư của route map', async () => {
    const { PRIVATE_PATHS } = await loadSite();
    expect(PRIVATE_PATHS).toEqual(
      expect.arrayContaining(['/admin', '/merchant', '/tai-khoan', '/gio-hang', '/thanh-toan', '/dang-nhap']),
    );
    expect(PRIVATE_PATHS).toEqual(expect.arrayContaining(['/doi-rac', '/kho-qua', '/dai-ly', '/ho-tro/chat']));
    expect(new Set(PRIVATE_PATHS).size).toBe(PRIVATE_PATHS.length);
    expect(PRIVATE_PATHS.some((p) => p.includes(':'))).toBe(false);
  });

  it('robots chặn tiền tố mới cả dạng trần lẫn cây con, và mở lại route công khai bên trong', async () => {
    const robots = (await import('../app/robots')).default;
    const rule = [robots().rules].flat()[0]!;
    expect(rule.disallow).toEqual(expect.arrayContaining(['/doi-rac', '/doi-rac/', '/ho-tro/chat', '/ho-tro/chat/']));
    expect(rule.allow).toEqual(expect.arrayContaining(['/', '/doi-rac/quy-dinh']));
    expect([rule.allow].flat().some((a) => a?.includes(':'))).toBe(false);
  });
});

describe('trang công khai nhưng noindex (/uu-dai, /ma-giam-gia)', () => {
  it('NOINDEX_PUBLIC_PATHS không nằm trong PRIVATE_PATHS (không bị chặn cào)', async () => {
    const { NOINDEX_PUBLIC_PATHS, PRIVATE_PATHS } = await loadSite();
    expect(NOINDEX_PUBLIC_PATHS).toEqual(['/uu-dai', '/ma-giam-gia']);
    for (const p of NOINDEX_PUBLIC_PATHS) expect(PRIVATE_PATHS).not.toContain(p);
    expect(new Set(PRIVATE_PATHS).size).toBe(PRIVATE_PATHS.length);
  });

  it('robots KHÔNG Disallow hai trang này (để Google đọc được meta noindex) và vẫn chặn khu riêng tư', async () => {
    const robots = (await import('../app/robots')).default;
    const rule = [robots().rules].flat()[0]!;
    const disallow = [rule.disallow].flat();
    for (const p of ['/uu-dai', '/uu-dai/', '/ma-giam-gia', '/ma-giam-gia/']) expect(disallow).not.toContain(p);
    expect(disallow).toEqual(expect.arrayContaining(['/admin', '/admin/', '/tai-khoan', '/tai-khoan/', '/gio-hang', '/thanh-toan']));
  });
});

describe('restoringBootScript', () => {
  const run = async (getItem: () => string | null) => {
    const { restoringBootScript } = await loadSite();
    const attrs: string[] = [];
    new Function('localStorage', 'document', restoringBootScript())(
      { getItem },
      { documentElement: { setAttribute: (k: string) => attrs.push(k) } },
    );
    return attrs;
  };
  it('có cờ phiên thì đặt data-restoring; không có cờ thì không', async () => {
    expect(await run(() => '1')).toEqual(['data-restoring']);
    expect(await run(() => null)).toEqual([]);
  });
  it('localStorage ném lỗi (chế độ riêng tư) thì nuốt lỗi, không đặt gì', async () => {
    expect(
      await run(() => {
        throw new Error('blocked');
      }),
    ).toEqual([]);
  });
});

describe('recentlyViewedBootScript', () => {
  const run = async (raw: string | null | 'throw') => {
    const { recentlyViewedBootScript } = await loadSite();
    const attrs: string[] = [];
    new Function('localStorage', 'document', recentlyViewedBootScript())(
      {
        getItem: (k: string) => {
          expect(k).toBe('tubu_recently_viewed');
          if (raw === 'throw') throw new Error('blocked');
          return raw;
        },
      },
      { documentElement: { setAttribute: (k: string) => attrs.push(k) } },
    );
    return attrs;
  };
  it('có ít nhất một mục hợp lệ thì đặt data-has-recent', async () => {
    expect(await run(JSON.stringify([{ slug: 'a', name: 'A', thumbnail: null, viewedAt: 1 }]))).toEqual(['data-has-recent']);
  });
  it('cùng luật với parseRecentlyViewed (isItem): mục thiếu thumbnail/viewedAt hay sai kiểu thì không đặt', async () => {
    const { parseRecentlyViewed } = await import('./recently-viewed');
    const ok = { slug: 'a', name: 'A', thumbnail: null, viewedAt: 1 };
    const cases: unknown[][] = [
      [ok],
      [{ ...ok, thumbnail: 'x.jpg' }],
      [{ slug: 'a', name: 'A' }],
      [{ ...ok, thumbnail: 5 }],
      [{ ...ok, thumbnail: undefined }],
      [{ ...ok, viewedAt: '1' }],
      [{ ...ok, viewedAt: null }],
      [{ ...ok, slug: '' }],
      [{ ...ok, name: 3 }],
      [null, 'x', 7],
      [{ slug: 'a', name: 'A', thumbnail: null }, ok],
      [],
    ];
    for (const c of cases) {
      const raw = JSON.stringify(c);
      expect(await run(raw), raw).toEqual(parseRecentlyViewed(raw).length > 0 ? ['data-has-recent'] : []);
    }
  });
  it('rỗng, hỏng, sai dạng hay storage ném lỗi thì không đặt gì', async () => {
    expect(await run(null)).toEqual([]);
    expect(await run('[]')).toEqual([]);
    expect(await run('{oops')).toEqual([]);
    expect(await run(JSON.stringify([{ slug: '', name: 'A' }]))).toEqual([]);
    expect(await run('throw')).toEqual([]);
  });
});

describe('fontScaleBootScript', () => {
  const run = async (raw: string | null | 'throw') => {
    const { fontScaleBootScript } = await loadSite();
    const attrs: Record<string, string> = {};
    const style = { fontSize: '' };
    new Function('localStorage', 'document', fontScaleBootScript())(
      {
        getItem: (k: string) => {
          expect(k).toBe('tubu_prefs');
          if (raw === 'throw') throw new Error('blocked');
          return raw;
        },
      },
      { documentElement: { style, setAttribute: (k: string, v: string) => (attrs[k] = v) } },
    );
    return { fontSize: style.fontSize, attrs };
  };
  it('đặt font-size gốc theo phần trăm và data-font-scale, khớp bảng của font-scale.ts', async () => {
    const { FONT_SIZE } = await import('../components/account/font-scale');
    for (const s of ['small', 'normal', 'large'] as const) {
      const out = await run(JSON.stringify({ fontScale: s }));
      expect(out.fontSize).toBe(FONT_SIZE[s]);
      expect(out.fontSize.endsWith('%')).toBe(true);
      expect(out.attrs).toEqual({ 'data-font-scale': s });
    }
  });
  it('chưa chọn, giá trị lạ, JSON hỏng hay storage ném lỗi thì không đụng gì', async () => {
    for (const raw of [null, JSON.stringify({}), JSON.stringify({ fontScale: 'huge' }), JSON.stringify({ fontScale: 'toString' }), '{oops', 'throw'] as const) {
      expect(await run(raw)).toEqual({ fontSize: '', attrs: {} });
    }
  });
});

describe('offersHintBootScript', () => {
  const run = async (raw: string | null | 'throw') => {
    const { offersHintBootScript } = await loadSite();
    const attrs: string[] = [];
    new Function('localStorage', 'document', offersHintBootScript())(
      {
        getItem: (k: string) => {
          expect(k).toBe('tubu_offers_hint');
          if (raw === 'throw') throw new Error('blocked');
          return raw;
        },
      },
      { documentElement: { setAttribute: (k: string) => attrs.push(k) } },
    );
    return attrs;
  };
  it("nhớ có mã ('1') thì đặt data-has-offers; còn lại thì không", async () => {
    expect(await run('1')).toEqual(['data-has-offers']);
    expect(await run('0')).toEqual([]);
    expect(await run(null)).toEqual([]);
    expect(await run('throw')).toEqual([]);
  });
});
