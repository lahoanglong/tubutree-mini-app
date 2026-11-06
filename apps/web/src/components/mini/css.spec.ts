import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = __dirname;
const read = (p: string) => readFileSync(p, 'utf8');
const sources = readdirSync(dir).filter((f) => /\.(tsx|ts)$/.test(f) && !/\.spec\./.test(f) && f !== 'harness.ts');
const css = read(join(dir, 'mini.css'));
const tokens = read(join(dir, '../../../../../packages/design-tokens/src/tokens.css'));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const defined = new Set([...strip(css + tokens).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

describe('mini.css', () => {
  it('mọi var(--x) dùng trong components/mini đều có định nghĩa (tokens.css hoặc mini.css)', () => {
    const missing: string[] = [];
    for (const f of sources) {
      for (const m of strip(read(join(dir, f))).matchAll(/var\((--[\w-]+)/g)) {
        // Tên dựng lúc chạy (var(--type-${v}-size), var(--color-brand-${id})) chỉ còn tiền tố cụt; bậc type-* kiểm riêng bên dưới.
        if (m[1]!.endsWith('-')) continue;
        if (!defined.has(m[1]!)) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('biến type-* dựng từ template (--type-${variant}-size) có đủ bậc trong tokens.css', () => {
    for (const v of ['body-lg', 'body-md', 'body-sm', 'caption', 'label', 'price-xl', 'price-lg', 'price-md', 'price-sm', 'display-lg', 'display-md', 'title-lg', 'title-md', 'title-sm']) {
      for (const k of ['size', 'lh', 'weight']) expect(defined.has(`--type-${v}-${k}`), `--type-${v}-${k}`).toBe(true);
    }
  });

  it('mọi class tubu-*/zaui-*/mini-*/scroll-x mà component gắn đều có luật CSS', () => {
    const used = new Set<string>();
    for (const f of sources) {
      for (const m of read(join(dir, f)).matchAll(/['"`]((?:tubu|zaui|mini)-[\w-]+|scroll-x)['"`]/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    // Lớp trạng thái/biến thể của zmp: chỉ cần luật cho lớp thật sự được tạo ở button.tsx; các lớp ghép tiền tố được kiểm riêng.
    expect(missing.filter((c) => !c.startsWith('zaui-btn-'))).toEqual([]);
  });

  it('các lớp zaui-btn-* mà Button có thể sinh đều có luật', () => {
    for (const c of ['primary', 'secondary', 'tertiary', 'disabled', 'loading', 'prefix-icon', 'full-width', 'loading-container', 'loading-icon', 'icon', 'container']) {
      expect(new RegExp(`\\.zaui-btn-${c}(?![\\w-])`).test(css), c).toBe(true);
    }
  });
});

describe('mini.css: thanh Đã bán của Giờ vàng', () => {
  it('.tubu-flash-fill mang transition transform 600ms và bị prefers-reduced-motion rút còn 0,01ms như Mini (luật * toàn cục của Mini)', () => {
    expect(css).toMatch(/\.tubu-flash-fill\s*\{[^}]*transition-property:\s*transform[^}]*transition-duration:\s*600ms/);
    const reduce = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(reduce).toMatch(/\.tubu-flash-fill[^{]*\{[^}]*transition-duration:\s*0\.01ms\s*!important/);
  });
});

describe('mini.css không đổi giao diện máy tính', () => {
  it('ẩn nút xoá native của ô tìm chỉ trong SearchField, không phải mọi [role=search]', () => {
    expect(css).not.toMatch(/\[role=['"]search['"]\][^{]*cancel-button/);
    expect(css).toMatch(/\.tubu-search-field input\[type='search'\]::-webkit-search-cancel-button/);
  });

  it('hàng tab cuộn ngang ẩn thanh cuộn chỉ dưới md (bản Mini không vẽ nó; thanh 6px của globals.css chồng lên chân tab)', () => {
    const rules = strip(css);
    const phone = [...rules.matchAll(/@media not all and \(min-width: 768px\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(phone).toMatch(/\.scroll-x\[role='tablist'\]\s*\{[^}]*scrollbar-width:\s*none/);
    expect(phone).toMatch(/\.scroll-x\[role='tablist'\]::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
    const outside = rules.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
    expect(outside).not.toMatch(/\[role='tablist'\]/);
  });

  it('điện thoại: body cắt tràn ngang vì dải PageHeader tràn bằng 100vw (gồm cả thanh cuộn của trình duyệt máy tính thu hẹp)', () => {
    const globals = strip(read(join(dir, '../../app/globals.css')));
    const phone = [...globals.matchAll(/@media \(max-width: 767px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(phone).toMatch(/body\s*\{[^}]*overflow-x:\s*clip/);
  });
});

describe('mini.css: phản hồi nhấn (polish PL-11) khớp Mini App', () => {
  it('có .tubu-press-card (co 0,985) và .tubu-btn:active (co 0,97); không luật :active nào đổi opacity', () => {
    expect(css).toMatch(/\.tubu-press:active\s*\{[^}]*scale\(0\.97\)/);
    expect(css).toMatch(/\.tubu-press-card:active\s*\{[^}]*scale\(0\.985\)/);
    expect(css).toMatch(/\.tubu-btn:active\s*\{[^}]*scale\(0\.97\)/);
    const activeBlocks = [...strip(css).matchAll(/[^{}]*:active[^{}]*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(activeBlocks.filter((b) => /opacity/.test(b))).toEqual([]);
  });

  it('giảm chuyển động: nhấn nút/thẻ không còn chuyển động dài', () => {
    const reduced = [...strip(css).matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(reduced).toMatch(/\.tubu-press-card/);
    expect(reduced).toMatch(/\.tubu-btn/);
  });
});

describe('mini.css: icon nảy khi chọn tab (polish PL-10)', () => {
  it('có @keyframes tubu-tab-pop (.88 → 1) và .tubu-tab-pop 220ms easing spring; giảm chuyển động đưa về tức thì', () => {
    expect(css).toMatch(/@keyframes tubu-tab-pop\s*\{[^}]*0%\s*\{[^}]*scale\(0\.88\)[^}]*\}[^}]*100%\s*\{[^}]*scale\(1\)/);
    expect(css).toMatch(/\.tubu-tab-pop\s*\{[^}]*animation:[^;}]*tubu-tab-pop 220ms var\(--p-ease-spring\)/);
    const reduced = [...strip(css).matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(reduced).toMatch(/\.tubu-tab-pop/);
  });
});


describe('mini.css: tràn mép dùng chung (.tubu-bleed, .tubu-bleed-rail)', () => {
  const plain = strip(css);
  /** Phần thân của các `@media <điều kiện> { ... }` cấp một có điều kiện đúng bằng `cond`. */
  const mediaBodies = (cond: string) => [...plain.matchAll(new RegExp(`@media ${cond.replace(/[().]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\}`, 'g'))].map((m) => m[1]).join('\n');
  const outsideMedia = plain.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');

  it('.tubu-bleed chỉ có luật dưới md: lề âm -1rem (đúng px-4 của PAGE_WIDE) và bỏ max-width để .scroll-x không cắt lại', () => {
    const phone = mediaBodies('not all and (min-width: 768px)');
    expect(phone).toMatch(/\.tubu-bleed\s*\{[^}]*margin-inline:\s*-1rem[^}]*max-width:\s*none/);
    expect(outsideMedia).not.toMatch(/\.tubu-bleed(?![\w-])/);
    expect(mediaBodies('(min-width: 768px)')).not.toMatch(/\.tubu-bleed(?![\w-])/);
  });

  it('.tubu-bleed-rail lùi --bleed-inset (mặc định 1rem) ở mọi khổ và đúng đệm 12px của kệ (--p-space-4) từ md', () => {
    expect(outsideMedia).toMatch(/\.tubu-bleed-rail\s*\{[^}]*margin-inline:\s*calc\(var\(--bleed-inset,\s*1rem\)\s*\*\s*-1\)[^}]*max-width:\s*none/);
    expect(mediaBodies('(min-width: 768px)')).toMatch(/\.tubu-bleed-rail\s*\{[^}]*margin-inline:\s*calc\(var\(--p-space-4\)\s*\*\s*-1\)/);
  });

  it('cả hai lớp đứng SAU .scroll-x (cùng độ đặc hiệu: luật sau thắng, max-width:100% không cắt hàng đã nới)', () => {
    const scrollX = plain.indexOf('.scroll-x {');
    expect(scrollX).toBeGreaterThan(-1);
    expect(plain.indexOf('.tubu-bleed {')).toBeGreaterThan(scrollX);
    expect(plain.indexOf('.tubu-bleed-rail {')).toBeGreaterThan(scrollX);
  });
});

describe('mini.css: sheet từ md là hộp thoại giữa màn (K7)', () => {
  const plain = strip(css);
  const mediaBodies = (cond: string) => [...plain.matchAll(new RegExp(`@media ${cond.replace(/[().]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\}`, 'g'))].map((m) => m[1]).join('\n');
  const md = mediaBodies('(min-width: 768px)');
  const outsideMedia = plain.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
  const reduced = mediaBodies('(prefers-reduced-motion: reduce)');

  it('từ md ẩn tay nắm kéo (hộp thoại không kéo xuống để đóng)', () => {
    expect(md).toMatch(/\.mini-sheet-handler\s*\{[^}]*display:\s*none/);
  });

  it('từ md hộp nằm giữa màn: gốc căn flex, rộng tối đa --dialog-w và còn lề 16px mỗi bên, bo đủ góc, cao tối đa 85vh, ôm nội dung', () => {
    expect(md).toMatch(/\.mini-sheet-root\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/);
    const panel = /\.mini-sheet-panel\s*\{([^}]*)\}/.exec(md)?.[1] ?? '';
    expect(panel).toMatch(/position:\s*relative/);
    expect(panel).toMatch(/width:\s*min\(calc\(100% - 32px\),\s*var\(--dialog-w\)\)/);
    expect(panel).toMatch(/min-height:\s*0/);
    expect(panel).toMatch(/max-height:\s*85vh/);
    expect(panel).toMatch(/border-radius:\s*var\(--radius-sheet\)/);
    expect(panel).toMatch(/box-shadow:\s*var\(--elevation-4\)/);
    expect(panel).not.toMatch(/translateX/);
  });

  it('nền mờ của sheet lấy token chung --color-bg-sheet-scrim (cùng token với ui/sheet), không hex riêng, ở mọi khổ', () => {
    expect(plain).toMatch(/--zaui-mask-overlay-color:\s*var\(--color-bg-sheet-scrim\)\s*;/);
    expect(plain).not.toMatch(/--zaui-mask-overlay-color:\s*#/);
    expect(/\.mini-sheet-mask\s*\{([^}]*)\}/.exec(outsideMedia)?.[1]).toMatch(/background:\s*var\(--zaui-mask-overlay-color\)/);
    expect(md).not.toMatch(/\.mini-sheet-mask\s*\{[^}]*background/);
  });

  it('từ md mở bằng fade/scale (không trượt), giảm chuyển động thì tắt cả hộp lẫn nền', () => {
    expect(md).toMatch(/\.mini-sheet-panel\s*\{[^}]*animation:\s*tubu-dialog-pop/);
    expect(plain).toMatch(/@keyframes tubu-dialog-pop\s*\{[^}]*0%\s*\{[^}]*opacity:\s*0[^}]*scale\(0\.97\)[^}]*\}[^}]*100%\s*\{[^}]*opacity:\s*1/);
    expect(reduced).toMatch(/\.mini-sheet-panel[^{]*\{[^}]*animation:\s*none/);
    expect(reduced).toMatch(/\.mini-sheet-mask[^{]*\{[^}]*animation:\s*none/);
  });

  it('dưới md không đổi: bottom sheet bo 16px hai góc trên, trượt lên từ đáy, rộng hết khung', () => {
    const panel = /\.mini-sheet-panel\s*\{([^}]*)\}/.exec(outsideMedia)?.[1] ?? '';
    expect(panel).toMatch(/border-radius:\s*16px 16px 0 0/);
    expect(panel).toMatch(/animation:\s*slideUp/);
    expect(panel).toMatch(/bottom:\s*0/);
    expect(panel).toMatch(/width:\s*100%/);
  });

  it('--dialog-w là 480px trong tokens.css', () => {
    expect(tokens).toMatch(/--dialog-w:\s*480px/);
  });
});
