import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DsMap } from '../../../scripts/check-ds-parity.mjs';
import { FORBIDDEN_TERMS } from './shop-copy';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');
const dsMap = JSON.parse(read('docs/design/ds-map.json')) as DsMap;

/** Nội dung của mục `## <title>` (gồm các mục `###` con) tới mục `##` kế tiếp; null nếu không có mục. */
function section(md: string, title: string): string | null {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** Mọi đoạn viết trong dấu huyền (`...`). */
const codeSpans = (md: string) => [...md.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);
const walkSrc = (dir: string): string[] =>
  readdirSync(join(REPO, dir)).flatMap((n) => (statSync(join(REPO, dir, n)).isDirectory() ? walkSrc(`${dir}/${n}`) : [`${dir}/${n}`]));
/** Tên có `export function|const|class <Tên>` ở file .tsx không phải spec trong thư mục của một app. */
const exportedIn = (dir: string, name: string) =>
  walkSrc(dir).some((f) => /\.tsx$/.test(f) && !/\.spec\./.test(f) && new RegExp(`export (?:function|const|class) ${name}\\b`).test(read(f)));
const REPO_PATH = /^(apps|packages|docs|scripts|\.claude|\.github)\//;
const isCheckablePath = (s: string) => REPO_PATH.test(s) && !/[*<>{}\s]/.test(s);

describe('DESIGN.md', () => {
  const md = read('DESIGN.md');
  const SECTIONS = [
    'Nguyên tắc',
    'Token',
    'Thành phần',
    'Sắp có (đợt 4b/4c)',
    'Luật kệ',
    'Luật nhãn và giá',
    'Chữ chuẩn và thuật ngữ cấm',
    'Khuôn trang web máy tính',
    'Thêm màn mới',
    'Kiểm tự động',
    'Nhật ký quyết định',
  ];

  it.each(SECTIONS)('có mục "%s" và mục không rỗng', (title) => {
    const body = section(md, title);
    expect(body, `thiếu mục ## ${title}`).not.toBeNull();
    expect(body!.trim().length).toBeGreaterThan(40);
  });

  it('mọi thành phần của ds-map.json (components, webOnly) có tên trong dấu huyền ở mục Thành phần', () => {
    const spans = new Set(codeSpans(section(md, 'Thành phần') ?? ''));
    const missing = [...dsMap.components, ...dsMap.webOnly].map((c) => c.name).filter((n) => !spans.has(n));
    expect(missing).toEqual([]);
  });

  it('mọi thành phần sắp có nằm ở mục Sắp có và chưa lẫn vào mục Thành phần', () => {
    const soon = new Set(codeSpans(section(md, 'Sắp có (đợt 4b/4c)') ?? ''));
    const built = new Set(codeSpans(section(md, 'Thành phần') ?? ''));
    expect(dsMap.upcoming.map((u) => u.name).filter((n) => !soon.has(n))).toEqual([]);
    expect(dsMap.upcoming.map((u) => u.name).filter((n) => built.has(n))).toEqual([]);
  });

  it('mục sắp có không giữ thành phần đã có ở cả hai app (gói xong phải chuyển dòng sang components)', () => {
    const stale = dsMap.upcoming
      .map((u) => u.name)
      .filter((n) => /^[A-Z]\w*$/.test(n) && exportedIn('apps/miniapp/src/components', n) && exportedIn('apps/web/src/components', n));
    expect(stale).toEqual([]);
  });

  it('mục Kiểm tự động nêu bánh cóc px/max-md, ds-parity, axe, ds-shop-guard của P17b và lệnh tái tạo baseline', () => {
    const body = section(md, 'Kiểm tự động') ?? '';
    for (const s of [
      'scripts/uiux/ds-ratchet.mjs',
      'scripts/uiux/ds-baseline.json',
      'node scripts/uiux/ds-ratchet.mjs --write',
      'apps/e2e/tests/ds-parity.shop.spec.ts',
      'apps/e2e/tests/a11y-shop.miniapp.spec.ts',
      'apps/e2e/tests/a11y-shop.web.spec.ts',
      'apps/e2e/tests/support/a11y-baseline.ts',
    ]) {
      expect(body, s).toContain(`\`${s}\``);
    }
    expect(body).not.toContain('Do gói P17b thêm sau');
  });

  it('bảng thuật ngữ cấm nêu đủ chữ thay thế của FORBIDDEN_TERMS', () => {
    const body = section(md, 'Chữ chuẩn và thuật ngữ cấm') ?? '';
    expect(FORBIDDEN_TERMS.map((t) => t.use).filter((use) => !body.includes(use))).toEqual([]);
  });

  it('bề rộng thẻ kệ ngang ghi ở mục Thành phần khớp bảng WIDTH của ProductRail ở cả hai app', () => {
    const line = (section(md, 'Thành phần') ?? '').split('\n').find((l) => l.startsWith('Kệ ngang chỉ dùng')) ?? '';
    const documented: Record<string, string> = {};
    for (const part of line.split(';')[0]!.split(' hoặc ')) {
      const spans = codeSpans(part);
      const token = spans.find((x) => x.startsWith('--tile-w-'));
      for (const v of spans.filter((x) => !x.startsWith('--'))) documented[v] = `var(${token})`;
    }
    expect(Object.keys(documented).sort()).toEqual(['flash', 'rail-md', 'rail-sm', 'rank']);
    for (const file of ['apps/miniapp/src/components/ui/product-rail.tsx', 'apps/web/src/components/mini/product-rail.tsx']) {
      const actual = Object.fromEntries([...read(file).matchAll(/^\s*'?(rail-sm|rail-md|rank|flash)'?:\s*'(var\(--tile-w-[a-z]+\))'/gm)].map((m) => [m[1]!, m[2]!]));
      expect(actual, file).toEqual(documented);
    }
  });

  it('nhắc các nguồn sự thật và lệnh kiểm', () => {
    for (const s of ['docs/design/ds-map.json', 'packages/app-core/src/merch/shelves.ts', 'packages/app-core/src/shop-copy.ts', 'pnpm lint:parity']) {
      expect(md, s).toContain(`\`${s}\``);
    }
  });

  it('mọi đường dẫn viết trong dấu huyền có thật trong repo, mọi token --xxx có trong tokens.css', () => {
    const tokens = read('packages/design-tokens/src/tokens.css');
    const spans = codeSpans(md);
    expect(spans.filter((s) => isCheckablePath(s) && !existsSync(join(REPO, s)))).toEqual([]);
    expect(spans.filter((s) => /^--[a-z0-9-]+$/.test(s) && !tokens.includes(`${s}:`))).toEqual([]);
  });
});

describe('cơ chế cho agent và người làm', () => {
  const ignored = (p: string) => spawnSync('git', ['check-ignore', '-q', p], { cwd: REPO }).status === 0;
  const rootScripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
  /** Đường dẫn repo có thật và lệnh `pnpm <script gốc>` có trong package.json: lệnh ghi trong tài liệu phải chạy được. */
  const brokenRefs = (md: string) =>
    codeSpans(md).filter((s) => {
      const script = /^pnpm (lint:[a-z]+)$/.exec(s)?.[1];
      return (isCheckablePath(s) && !existsSync(join(REPO, s))) || (script !== undefined && !(script in rootScripts));
    });

  it('.gitignore: .claude/worktrees và cấu hình cục bộ vẫn bị bỏ qua, skill thì không', () => {
    expect(ignored('.claude/worktrees/x/y.ts')).toBe(true);
    expect(ignored('.claude/settings.local.json')).toBe(true);
    expect(ignored('.claude/skills/tubu-ui/SKILL.md')).toBe(false);
  });

  describe('skill tubu-ui', () => {
    const md = read('.claude/skills/tubu-ui/SKILL.md');

    it('có front matter name và description nói khi nào dùng', () => {
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1] ?? '';
      expect(fm).toMatch(/^name: tubu-ui$/m);
      expect(fm).toMatch(/^description: .*(before|Use when).*$/m);
    });

    it('nhắc DESIGN.md, ds-map.json, shop-copy.ts, lệnh kiểm và chụp 375px', () => {
      for (const s of ['DESIGN.md', 'docs/design/ds-map.json', 'packages/app-core/src/shop-copy.ts', 'pnpm lint:parity', 'visual-pairs.mjs']) {
        expect(md, s).toContain(s);
      }
    });

    it('đường dẫn và lệnh pnpm viết trong skill đều có thật', () => {
      expect(brokenRefs(md)).toEqual([]);
    });
  });

  it('AGENTS.md có mục Giao diện trỏ skill, DESIGN.md và quy tắc chữ gian hàng', () => {
    const agents = read('AGENTS.md');
    const body = section(agents, 'Giao diện') ?? '';
    expect(body).toContain('.claude/skills/tubu-ui/SKILL.md');
    expect(body).toContain('DESIGN.md');
    expect(body).toContain('shop-copy.ts');
    expect(brokenRefs(body)).toEqual([]);
  });

  it('mẫu PR có mục Giao diện với các bài kiểm đã có', () => {
    const tpl = read('.github/pull_request_template.md');
    const body = section(tpl, 'Giao diện') ?? '';
    for (const s of ['docs/design/ds-map.json', 'pnpm lint:parity', 'DESIGN.md']) expect(body, s).toContain(s);
    expect(body).toMatch(/^- \[ \] /m);
    expect(brokenRefs(body)).toEqual([]);
  });
});
