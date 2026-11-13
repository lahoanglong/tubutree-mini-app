import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

/**
 * `.tubu-*` được viết hai lần: `mini.css` (web) và `apps/miniapp/src/css/*.css` (Mini App). Spec này đọc cả hai bằng postcss và báo đỏ khi một luật dùng chung
 * (cùng bộ chọn, cùng @media) có thuộc tính lệch giá trị sau khi quy token/rem về px. Lệch có chủ ý phải khai ở `ALLOWED` kèm lý do; mục khai mà không còn lệch cũng báo đỏ.
 *
 * Phạm vi: bộ chọn `.tubu-story*` (Story Split-Card của W133) nằm ngoài, đang do nhánh khác viết lại. Thuộc tính chỉ có ở một phía chỉ bị bắt với nhóm giao diện
 * (màu, nền, bo góc, đổ bóng, đậm nhạt chữ); khác biệt cách viết (shorthand/longhand, flex/grid) không được so.
 */
const root = join(__dirname, '../../../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const WEB_CSS = ['apps/web/src/components/mini/mini.css'];
const MINI_DIR = 'apps/miniapp/src/css';
const MINI_CSS = readdirSync(join(root, MINI_DIR)).filter((f) => f.endsWith('.css')).map((f) => `${MINI_DIR}/${f}`);

const EXCLUDED = /\.tubu-story/;
const VISUAL = new Set(['color', 'background', 'background-color', 'border-radius', 'box-shadow', 'border-color', 'opacity', 'font-weight']);

const vars = new Map<string, string>();
for (const f of ['packages/design-tokens/src/tokens.css', ...WEB_CSS, ...MINI_CSS]) {
  postcss.parse(read(f)).walkDecls(/^--(p-space|space-|p-radius|radius|tile-w|reel)/, (d) => {
    if (!vars.has(d.prop)) vars.set(d.prop, d.value.trim());
  });
}

function norm(prop: string, raw: string): string {
  let v = raw;
  for (let i = 0; i < 6; i++) v = v.replace(/var\((--[\w-]+)\)/g, (m, n: string) => vars.get(n) ?? m);
  v = v.replace(/(-?[\d.]+)rem/g, (_m, n: string) => `${+n * 16}px`).replace(/\b0px\b/g, '0');
  v = v.replace(/(\d+(?:\.\d+)?) \* (\d+(?:\.\d+)?)px/g, (_m, a: string, b: string) => `${+a * +b}px`).replace(/\s+/g, ' ').trim();
  if (/^border(-\w+)?$/.test(prop) && (v === 'none' || v === '0')) return '0';
  return v;
}

function expandBox(prop: 'margin' | 'padding', v: string): Record<string, string> {
  const [t, r = t, b = t, l = r] = v.split(' ') as [string, string?, string?, string?];
  return { [`${prop}-top`]: t, [`${prop}-right`]: r!, [`${prop}-bottom`]: b!, [`${prop}-left`]: l! };
}

type Rules = Map<string, Record<string, string>>;
function collect(files: string[]): Rules {
  const out: Rules = new Map();
  for (const f of files) {
    postcss.parse(read(f)).walkRules((rule) => {
      const ctx: string[] = [];
      for (let p = rule.parent; p && p.type === 'atrule'; p = p.parent) ctx.unshift(`@${(p as postcss.AtRule).name} ${(p as postcss.AtRule).params}`);
      for (const sel of rule.selectors) {
        if (!/\.tubu-/.test(sel) || EXCLUDED.test(sel)) continue;
        const key = `${ctx.length ? `${ctx.join(' | ')} :: ` : ''}${sel.replace(/\s+/g, ' ').trim()}`;
        const d = out.get(key) ?? {};
        rule.each((n) => {
          if (n.type !== 'decl' || n.prop.startsWith('--')) return;
          const value = norm(n.prop, n.value) + (n.important ? ' !important' : '');
          if (n.prop === 'margin' || n.prop === 'padding') Object.assign(d, expandBox(n.prop, value));
          else d[n.prop] = value;
        });
        out.set(key, d);
      }
    });
  }
  return out;
}

function drift(): { found: Map<string, string>; shared: number } {
  const web = collect(WEB_CSS);
  const mini = collect(MINI_CSS);
  const found = new Map<string, string>();
  let shared = 0;
  for (const [key, a] of web) {
    const b = mini.get(key);
    if (!b) continue;
    shared++;
    for (const prop of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const both = prop in a && prop in b;
      if (!both && !VISUAL.has(prop)) continue;
      if (a[prop] !== b[prop]) found.set(`${key} | ${prop}`, `web=${a[prop] ?? '(không)'} mini=${b[prop] ?? '(không)'}`);
    }
  }
  return { found, shared };
}

/** Mỗi mục: `<bộ chọn> | <thuộc tính>` → vì sao web được khác Mini. Thêm mục mới cần lý do thật, không phải "cho qua". */
const ALLOWED: Record<string, string> = {
  // Dải Story ở Trang chủ: cùng kích thước ra, khác cách viết (web dựa biến --reel-ring/--reel-label-h và ô lồng nhau, Mini ghi số cứng).
  '.tubu-reel-head | margin-bottom': 'Web 4px + hàng 116px, Mini 8px + hàng 112px: cả hai ra khối 144px (chú thích W42A ở mini.css).',
  '.tubu-reel-item | flex': 'Web `0 0 auto` + width 72px (--reel-ring) tương đương Mini `0 0 72px`.',
  '.tubu-reel-item | color': 'Mini kế thừa --color-text-primary từ body (tokens.css), web đặt rõ vì <button> không kế thừa màu.',
  '.tubu-reel-item | border-radius': 'Web đặt bo góc ở :focus-visible (hình vòng viền focus), Mini đặt trên ô: cùng 12px.',
  '.tubu-reel-item:focus-visible | outline-offset': 'Hàng web có đệm nên viền focus nằm ngoài ô; hàng Mini cao cố định 112px có cắt tràn nên viền lùi vào 2px.',
  '.tubu-reel-item:focus-visible | border-radius': 'Xem .tubu-reel-item | border-radius: cùng 12px, đặt ở chỗ khác.',
  '.tubu-reel-ring | border-radius': 'Vòng vuông 72x72: 9999px và 50% ra cùng hình tròn.',
  '.tubu-reel-photo | width': 'Web 100% của vòng (72 trừ đệm 4+4, box-sizing border-box) = 64px của Mini.',
  '.tubu-reel-photo | height': 'Xem .tubu-reel-photo | width.',
  '.tubu-reel-photo | border-radius': 'Ảnh vuông: 9999px và 50% ra cùng hình tròn.',
  '.tubu-reel-badge | border-radius': 'Web dùng <Badge> đã tự bo pill (badge.tsx), Mini dùng <span> nên CSS phải bo.',
  '.tubu-reel-label | line-height': 'Web --type-label-lh (1.33 × 12px = 16px) bằng 16px của Mini.',
  '.tubu-reel-label | color': 'Web kế thừa màu chữ chính từ .tubu-reel-item, Mini đặt rõ trên nhãn: cùng --color-text-primary.',
  '.tubu-reel-skel-ring | border-radius': 'Khung chờ vuông 72x72: 9999px và 50% ra cùng hình tròn.',
  '.tubu-reel-skel-label | width': 'Web: ô nhãn rộng bằng vòng, thanh chờ bên trong 75% x 12px căn giữa; Mini vẽ thanh chờ 56px trực tiếp.',
  '.tubu-reel-skel-label | height': 'Xem .tubu-reel-skel-label | width: web giữ ô 32px bằng nhãn thật cho khỏi nhảy.',
  // Thanh Miễn phí giao hàng.
  '.tubu-freeship | min-height': 'Web chừa chỗ hai dòng chữ + thanh (chú thích mini.css), Mini chừa một dòng + thanh (56px). Chủ chưa quyết giữ bên nào: nêu ở báo cáo W142C.',
  // Dải gợi ý mua thêm: thẻ web nằm ngang rộng 272px, thẻ Mini là ô dọc 128px (thiết kế riêng từng nền tảng, chú thích W42A ở mini.css).
  '.tubu-addon-card | flex': 'Thẻ web ngang cố định 272px, Mini ô dọc --tile-w-sm (128px): thiết kế riêng từng nền tảng (W42A).',
  '.tubu-addon-card | width': 'Xem .tubu-addon-card | flex.',
  '.tubu-addon-card | gap': 'Thẻ web xếp ngang (ảnh + chữ) cần khe 8px, Mini xếp dọc khe 4px.',
  '.tubu-addon-card | box-shadow': 'Thẻ web viền 1px --color-border-subtle thay cho đổ bóng của ô dọc Mini (thiết kế riêng, W42A).',
  '.tubu-addon-name | font-size': 'Thẻ web rộng 272px dùng chữ caption 13px, ô dọc 128px của Mini dùng label 12px.',
  '.tubu-addon-name | line-height': 'Đi theo cỡ chữ ở .tubu-addon-name | font-size.',
  '.tubu-addon-name | font-weight': 'Mini in đậm tên (label 600) trong ô hẹp, web để chữ thường trong thẻ rộng.',
  // Gợi ý mua kèm.
  '.tubu-fbt-name | color': 'Mini kế thừa --color-text-primary từ body (tokens.css), web đặt rõ.',
};

describe('tubu-css-parity: .tubu-* dùng chung giữa web và Mini App', () => {
  const { found, shared } = drift();

  it('có luật dùng chung để so (phòng parser đọc hụt)', () => {
    expect(shared).toBeGreaterThan(80);
  });

  it('mọi thuộc tính lệch đều có lý do trong ALLOWED', () => {
    const unexplained = [...found].filter(([k]) => !(k in ALLOWED)).map(([k, v]) => `${k}  ${v}`);
    expect(unexplained).toEqual([]);
  });

  it('ALLOWED không giữ mục đã hết lệch', () => {
    expect(Object.keys(ALLOWED).filter((k) => !found.has(k))).toEqual([]);
  });

  it('mọi mục ALLOWED có lý do không rỗng', () => {
    expect(Object.entries(ALLOWED).filter(([, why]) => why.trim().length < 12).map(([k]) => k)).toEqual([]);
  });
});
