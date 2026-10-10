import { readFileSync } from 'node:fs';
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
