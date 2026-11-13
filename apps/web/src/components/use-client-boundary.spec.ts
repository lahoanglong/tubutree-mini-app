import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * W139 thêm `'use client'` cho 6 file để gắn `onError={hideBrokenImage}` (hàm không đi qua biên Server → Client). Biên đó chỉ nguy hiểm khi một Server
 * Component import file này và truyền prop: prop là hàm/class/Symbol thì `next build` hỏng ở lúc chạy. Spec quét nguồn: importer nào không phải client
 * phải khai ở `SERVER_IMPORTERS` cùng danh sách prop được phép (kiểu JSON thuần), và chỗ dùng không được truyền hàm hay bộ xử lý sự kiện.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));

const CLIENT_FILES = [
  'components/account/profile-avatar.tsx',
  'components/catalog/suggest-list.tsx',
  'components/community/post-card.tsx',
  'components/community/public-preview-list.tsx',
  'components/mini/story-sprite.tsx',
  'components/support-chat/message-list.tsx',
] as const;

/** Server Component được phép import file client, kèm prop nó truyền (đều là mảng/chuỗi/số JSON từ API). */
const SERVER_IMPORTERS: Record<string, Record<string, readonly string[]>> = {
  'components/community/public-preview-list.tsx': { 'app/cong-dong/page.tsx': ['posts'] },
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(spec|test)\.|\.d\.ts$/.test(name) ? [path] : [];
  });
}
const FILES = sources(SRC).map((path) => ({ rel: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));
const isClient = (text: string) => /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*['"]use client['"]/.test(text);
const stem = (rel: string) => basename(rel).replace(/\.tsx?$/, '');
const importersOf = (rel: string) => {
  const re = new RegExp(`from\\s+['"][^'"]*/${stem(rel)}['"]|import\\(\\s*['"][^'"]*/${stem(rel)}['"]\\s*\\)`);
  return FILES.filter((f) => f.rel !== rel && re.test(f.text));
};
const componentName = (rel: string) => FILES.find((f) => f.rel === rel)!.text.match(/export (?:default )?function (\w+)/)![1]!;

describe('biên Server → Client của 6 file W139 thêm use client', () => {
  it.each(CLIENT_FILES)('%s có use client và có importer (phòng đổi tên làm spec mù)', (rel) => {
    const file = FILES.find((f) => f.rel === rel);
    expect(file, rel).toBeDefined();
    expect(isClient(file!.text), `${rel} thiếu 'use client'`).toBe(true);
    expect(importersOf(rel).length, `${rel} không còn importer nào`).toBeGreaterThan(0);
  });

  it.each(CLIENT_FILES)('%s: importer không phải client đều được khai trong SERVER_IMPORTERS', (rel) => {
    const serverSide = importersOf(rel).filter((f) => !isClient(f.text)).map((f) => f.rel).sort();
    expect(serverSide).toEqual(Object.keys(SERVER_IMPORTERS[rel] ?? {}).sort());
  });

  it.each(Object.entries(SERVER_IMPORTERS).flatMap(([rel, importers]) => Object.entries(importers).map(([importer, props]) => [rel, importer, props] as const)))(
    '%s dùng ở %s chỉ truyền prop JSON thuần %j',
    (rel, importer, allowed) => {
      const text = FILES.find((f) => f.rel === importer)!.text;
      const tag = componentName(rel);
      const uses = [...text.matchAll(new RegExp(`<${tag}\\b([^>]*?)/?>`, 'g'))];
      expect(uses.length, `${importer} không còn dùng <${tag}>`).toBeGreaterThan(0);
      for (const use of uses) {
        const attrs = use[1]!;
        const names = [...attrs.matchAll(/(?:^|\s)([\w-]+)=/g)].map((m) => m[1]!);
        expect(names.filter((n) => !allowed.includes(n)), `prop ngoài danh sách ở ${importer}`).toEqual([]);
        expect(attrs, 'không truyền spread (không kiểm được kiểu)').not.toMatch(/\{\s*\.\.\./);
        expect(attrs, 'không truyền hàm hay bộ xử lý sự kiện').not.toMatch(/=>|\bfunction\b|\bon[A-Z]\w*=/);
      }
    },
  );

  it('FeedPreviewItem (dữ liệu của PublicPreviewList) chỉ gồm kiểu JSON thuần', () => {
    const feed = readFileSync(join(SRC, '../../../packages/app-core/src/api/feed.ts'), 'utf8');
    const body = feed.match(/export interface FeedPreviewItem \{([\s\S]*?)\n\}/)![1]!;
    expect(body).not.toMatch(/=>|\bFunction\b|\bDate\b|\bMap\b|\bSet\b|\bsymbol\b|\bbigint\b|\bunknown\b|\bany\b/);
  });
});
