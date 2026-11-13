import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

const mini = read('./tokens.css');
const web = read('../../../web/src/app/globals.css');
const appTsx = readFileSync(new URL('../app.tsx', import.meta.url), 'utf-8');

/** Khai báo của khối `@font-face { font-family: 'Inter Fallback'; ... }` thành bảng tên → giá trị. */
function fallbackFace(css: string): Record<string, string> {
  const block = /@font-face\s*\{([^}]*font-family:\s*'Inter Fallback'[^}]*)\}/.exec(css);
  if (!block) throw new Error("không thấy @font-face 'Inter Fallback'");
  const out: Record<string, string> = {};
  for (const m of block[1]!.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim().replace(/\s+/g, ' ');
  return out;
}

const fontUi = (css: string) => /--font-ui\s*:\s*([^;]+);/.exec(css)?.[1]?.trim().replace(/\s+/g, ' ');

describe("'Inter Fallback' của Mini App khớp web (chống nhảy chữ khi Inter tải xong)", () => {
  it('@font-face có đủ 4 số chỉnh cỡ và trùng từng giá trị với apps/web/src/app/globals.css', () => {
    const m = fallbackFace(mini);
    const w = fallbackFace(web);
    for (const key of ['size-adjust', 'ascent-override', 'descent-override', 'line-gap-override', 'src']) {
      expect(m[key], `${key} thiếu ở Mini`).toBeDefined();
      expect(m[key], key).toBe(w[key]);
    }
  });

  it("--font-ui xếp 'Inter Fallback' ngay sau 'Inter' và đúng chuỗi như web", () => {
    expect(fontUi(mini)).toMatch(/^'Inter',\s*'Inter Fallback',/);
    expect(fontUi(mini)).toBe(fontUi(web));
  });

  it('app.tsx nạp design-tokens trước css/tokens.css để --font-ui của Mini thắng theo thứ tự nguồn', () => {
    const designTokens = appTsx.indexOf("'@tubutree/design-tokens/src/tokens.css'");
    const miniTokens = appTsx.indexOf("'./css/tokens.css'");
    expect(designTokens).toBeGreaterThan(-1);
    expect(miniTokens).toBeGreaterThan(designTokens);
  });
});
