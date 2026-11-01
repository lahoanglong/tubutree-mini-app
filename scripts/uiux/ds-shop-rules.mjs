// Luật của ds-shop-guard dùng chung cho hai app (P17b): thẻ sản phẩm tự chế, giá gạch ngoài PriceTag, primitive màu ngoài css/ và thành phần nền,
// `Text` của zmp-ui trong trang mua sắm, gọi thẳng openSnackbar. Mã cũ đang vi phạm nằm trong scripts/uiux/ds-baseline.json (mục `guards`, số chỗ theo luật
// và file, đường dẫn tính từ `src/` của app); baseline chỉ được giảm. Spec của từng app (ds-shop-guard.spec.ts) và packages/app-core/src/ds-ratchet.spec.ts gọi hàm ở đây.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

// Phạm vi "trang mua sắm" (đường dẫn tính từ src/): các màn khách mua hàng và thư mục thành phần riêng của chúng.
const MINI_SHOP = [
  /^pages\/(home|browse|product-detail|cart|checkout|offers|vouchers|flash-sale|best-sellers|campaign|brand-view|storefront-view|storefront-builder|wishlist|group-buy)\.tsx$/,
  /^components\/(home|catalog|flash|campaign|offers|shop-page|reorder|checkout|storefront-builder|product)\//,
  /^components\/(flash-sale|storefront-[^/]+|store-page-shell|variation-sheet|catalog-grid)\.tsx$/,
];
const WEB_SHOP = [
  /^app\/page\.tsx$/,
  /^app\/(san-pham|ban-chay|gio-vang|gio-hang|thanh-toan|uu-dai|ma-giam-gia|chien-dich|brand|s|mua-chung)\//,
  /^app\/tai-khoan\/yeu-thich\//,
  /^components\/(home|catalog|flash|campaign|offers|shop-page|reorder|checkout|product)\//,
  /^components\/(flash-price|add-to-cart|variation-sheet)\.tsx$/,
];
const inAny = (res) => (rel) => res.some((re) => re.test(rel));
const miniShop = inAny(MINI_SHOP);
const webShop = inAny(WEB_SHOP);
const everywhere = () => true;

// `<s` phải theo sau bởi khoảng trắng, `>` hoặc `/`: `\b` thôi chưa đủ vì bắt nhầm `<s.icon />` (biến tên s) và chữ "<số ngày>" trong chuỗi.
const STRIKE_TAG = /<(?:del|s)(?=[\s>/])/;

const MINI_PRIMITIVE = /var\(--(?:forest|sage|stone|clay|honey|terracotta|orange|red|amber|blue|navy|tubu-orange)(?:-\d+)?\)/;
const WEB_PRIMITIVE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration|placeholder)-(?:stone|forest|sage|clay|honey|terracotta|orange)-\d+\b|var\(--(?:forest|sage|stone|clay|honey|terracotta|orange|tubu-orange)(?:-\d+)?\)/;

export const GUARD_RULES = [
  {
    id: 'tile-custom',
    platform: 'miniapp',
    scope: (rel) => !rel.startsWith('components/ui/'),
    pattern: /<ProductImage\b|<ProductThumb\b|aspectRatio:\s*['"]1\s*\/\s*1['"]/,
    why: 'thẻ sản phẩm chỉ vẽ bằng ProductCard/ProductTile (components/ui); ảnh vuông tự dựng là thẻ tự chế',
  },
  {
    id: 'strike-element',
    platform: 'miniapp',
    scope: (rel) => rel !== 'components/ui/price-tag.tsx',
    pattern: STRIKE_TAG,
    why: 'giá gạch chỉ do PriceTag vẽ (đã có chữ đọc "giá gốc" cho trình đọc màn hình)',
  },
  {
    id: 'primitive-color',
    platform: 'miniapp',
    scope: (rel) => miniShop(rel) && !rel.startsWith('css/') && !rel.startsWith('components/ui/'),
    pattern: MINI_PRIMITIVE,
    why: 'trang mua sắm dùng token ngữ nghĩa (--color-*), không trỏ bậc primitive của tokens.css',
  },
  {
    id: 'zmp-text',
    platform: 'miniapp',
    scope: miniShop,
    pattern: /import\s*\{[^}]*\bText\b[^}]*\}\s*from\s*['"]zmp-ui['"]/,
    why: 'trang mua sắm dùng Text của design system (components/ui/text), không dùng Text của zmp-ui nằm ngoài thang chữ',
  },
  {
    id: 'open-snackbar',
    platform: 'miniapp',
    scope: (rel) => miniShop(rel) && rel !== 'hooks/use-notify.ts',
    pattern: /\bopenSnackbar\b|\buseSnackbar\b/,
    why: 'thông báo đi qua useNotify (vùng aria-live), không gọi thẳng openSnackbar của zmp-ui',
  },
  {
    id: 'tile-custom',
    platform: 'web',
    scope: (rel) => !rel.startsWith('components/mini/'),
    pattern: /<ProductImage\b|<ProductThumb\b/,
    why: 'thẻ sản phẩm chỉ vẽ bằng ProductCard/ProductTile (components/mini); ảnh sản phẩm tự dựng là thẻ tự chế',
  },
  {
    id: 'strike-element',
    platform: 'web',
    scope: (rel) => rel !== 'components/mini/price-tag.tsx',
    pattern: STRIKE_TAG,
    why: 'giá gạch chỉ do PriceTag vẽ (đã có chữ đọc "giá gốc" cho trình đọc màn hình)',
  },
  {
    id: 'primitive-color',
    platform: 'web',
    scope: (rel) => webShop(rel) && !rel.startsWith('components/mini/'),
    pattern: WEB_PRIMITIVE,
    why: 'trang mua sắm dùng lớp ngữ nghĩa hoặc [var(--color-*)], không dùng bậc primitive (bg-stone-100, text-forest-700)',
  },
  {
    id: 'shadow-var-color',
    platform: 'web',
    scope: everywhere,
    pattern: /(?<![\w-])shadow-\[var\(--[\w-]+\)\]/,
    why: 'Tailwind đọc shadow-[var(--x)] là MÀU bóng nên phần tử không có bóng nào (đo ds-parity ở thẻ sản phẩm): dùng [box-shadow:var(--x)]',
  },
  {
    id: 'zmp-ui-import',
    platform: 'web',
    scope: everywhere,
    pattern: /from\s*['"]zmp-ui['"]/,
    why: 'web không có zmp-ui; thành phần dùng chung nằm ở components/mini',
  },
  {
    id: 'open-snackbar',
    platform: 'web',
    scope: everywhere,
    pattern: /\bopenSnackbar\b/,
    why: 'web không có snackbar của zmp-ui; mã chép nguyên từ Mini phải đổi sang cách báo của web',
  },
];

// Xoá comment bằng cây cú pháp (không phải regex dòng) để `// <ProductImage />` hay `/* bg-stone-100 */` không bị tính.
function stripComments(text, rel) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ranges = [];
  const visit = (node) => {
    for (const r of ts.getLeadingCommentRanges(text, node.pos) ?? []) ranges.push(r);
    for (const r of ts.getTrailingCommentRanges(text, node.end) ?? []) ranges.push(r);
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  const chars = text.split('');
  for (const { pos, end } of ranges) for (let i = pos; i < end; i += 1) if (chars[i] !== '\n') chars[i] = ' ';
  return chars.join('');
}

const countMatches = (text, pattern) => (text.match(new RegExp(pattern.source, 'g')) ?? []).length;

/** ruleId → file → số chỗ khớp (chỉ file có vi phạm). `rel` tính từ `src/` của app. */
export function ruleCounts({ platform, files }) {
  const rules = GUARD_RULES.filter((r) => r.platform === platform);
  const out = Object.fromEntries(rules.map((r) => [r.id, {}]));
  for (const { rel, text } of files) {
    for (const rule of rules) {
      if (!rule.scope(rel) || !rule.pattern.test(text)) continue;
      const n = countMatches(stripComments(text, rel), rule.pattern);
      if (n > 0) out[rule.id][rel] = n;
    }
  }
  return out;
}

const WRITE_CMD = 'node scripts/uiux/ds-ratchet.mjs --write';

export function guardViolations({ platform, files, baseline }) {
  const counts = ruleCounts({ platform, files });
  const errors = [];
  const notices = [];
  for (const rule of GUARD_RULES.filter((r) => r.platform === platform)) {
    const now = counts[rule.id];
    const was = baseline[rule.id] ?? {};
    for (const [file, n] of Object.entries(now)) {
      const b = was[file] ?? 0;
      if (n > b) errors.push(`${rule.id}: ${file}: ${n} chỗ, baseline ${b}. ${rule.why}`);
      else if (n < b) notices.push(`${rule.id}: ${file}: giảm ${b} → ${n}, chạy ${WRITE_CMD} để hạ baseline`);
    }
    for (const [file, b] of Object.entries(was)) {
      if (now[file] === undefined) notices.push(`${rule.id}: ${file}: baseline còn ${b} nhưng file đã sạch hoặc đã xoá, chạy ${WRITE_CMD} để xoá dòng`);
    }
  }
  return { errors, notices };
}

const walkDir = (dir) =>
  readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walkDir(p) : [p];
  });

/** Nguồn của một app (bỏ spec, test, .d.ts) dạng { rel (từ src/), text }: cùng bộ lọc với `sources()` của hai ds-shop-guard.spec. */
export function loadPlatformFiles(root, platform) {
  const src = join(root, 'apps', platform, 'src');
  return walkDir(src)
    .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.(spec|test)\.|\.d\.ts$/.test(p))
    .map((p) => ({ rel: relative(src, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }));
}
