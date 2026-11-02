import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { countdownText } from './commerce/countdown';
import { FORBIDDEN_TERMS } from './shop-copy';

/**
 * Thuật ngữ cấm (`FORBIDDEN_TERMS`, nguồn review/ux-copy.md mục D2 và thiết kế §4 Q5) quét trên chữ hiển thị của Mini App và web khách.
 * Quét cây cú pháp, không quét chữ thô: tên biến `voucherList`, `className="tubu-voucher-card"`, đường dẫn import và comment đều chứa chữ cấm
 * mà khách không đọc. Mã cũ đang vi phạm thì vào `EXEMPT` kèm lý do và trần `max`: file đã miễn không được thêm vi phạm mới.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const ROOTS = ['apps/miniapp/src', 'apps/web/src', 'packages/app-core/src'];
// API: chỉ file nào chắc chắn chỉ chứa chữ trả cho khách (`*-notice.ts`, `*-notice.service.ts`, `*-price.ts`, `*-price.service.ts`) và danh sách tên file ghi sẵn (`cart/cart.batch-error.ts`);
// service lớn lẫn log, quản trị và lỗi nội bộ nên không quét cả cây (vd `flash-sale.service.ts` có cả lỗi của Giờ vàng cho khách lẫn chữ quản trị "đợt flash sale").
const API_ROOT = 'apps/api/src/modules';
const API_COPY_FILE = /-(notice|price)(\.service)?\.ts$/;
const API_COPY_EXTRA = new Set([`${API_ROOT}/cart/cart.batch-error.ts`]);
const isApiCopyFile = (file: string) => file.startsWith(`${API_ROOT}/`) && (API_COPY_FILE.test(file) || API_COPY_EXTRA.has(file));
// Quản trị có bảng chữ riêng (Q16, admin/terminology.spec.ts), spec và dữ liệu giả không tới tay khách.
const NOT_SCANNED = [/\.(spec|test)\.tsx?$/, /(^|\/)admin\//, /(^|\/)components\/admin\//, /(^|\/)test-utils\//, /(^|\/)lib\/admin-/];

// Chữ cái tiếng Việt có dấu: dấu hiệu chắc chắn của chữ khách đọc, vì tên mã, className, đường dẫn và id đều là ASCII.
const VI_LETTER = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
// Chữ ASCII đọc như câu: chữ hoa đầu rồi chữ thường ("Freeship", "Flash sale"), hai từ cách nhau bằng dấu cách ("HSD 12/2026", "2h 05m"), có "...", hoặc chữ hoa viết tắt rồi dấu cách / hai chấm
// (đầu chuỗi template `HSD ${d}` chỉ còn "HSD ": phần số nằm ở biểu thức nên không có "từ sau dấu cách").
// Mã định danh như 'FREESHIP', 'FREESHIP-${id}', 'voucher', 'flash-sale' không dính các dạng này nên không bị coi là chữ khách đọc; 'HSD', 'HOT' đứng một mình trong chuỗi thường chỉ bắt được khi nằm ở chữ JSX, thuộc tính chữ hoặc con trực tiếp của thẻ.
// Các mẫu này neo ở ĐẦU chuỗi nên chỉ đúng với chuỗi thường và đầu template; đoạn template ở vị trí khác còn được xét thêm bằng `TEMPLATE_WORD_PROSE` bên dưới.
const ASCII_PROSE = /^[A-Z][a-z]|^[A-Z]{2,}[ :]|\w \w|\.{3}/;
// Mọi đoạn của template có biểu thức (đầu, giữa, cuối): `(HSD ${d})` cho đầu "(HSD ", `${code} · HSD ${d}` cho giữa " · HSD ", `${n} HOT!` cho cuối " HOT!". Đầu đoạn không phải đầu chuỗi
// (đứng sau một biểu thức, hoặc bắt đầu bằng dấu câu) nên `ASCII_PROSE` neo ở đầu chuỗi bỏ sót. Từ ASCII đứng riêng: chữ hoa đầu từ ("Top", "Freeship") hoặc chữ hoa viết tắt từ hai chữ ("HSD", "HOT")
// mà trước đó không phải ký tự mã (chữ/số, `_`, `-`, `/`, `.`) và, với chữ viết tắt, sau đó cũng không phải chữ/số, `_`, `-`, `/`; mọi ký tự khác (cách, dấu câu, ngoặc, `·`, hết đoạn) là ranh giới.
// Nhờ vậy `FREESHIP-${id}`, `${a}-FREESHIP`, `${base}/HOT/${id}`, `HOT_${x}`, `${a}.HOT` vẫn là mã định danh, còn `${n} HOT!`, `(HSD ${d})`, `${n}, HSD.` là chữ khách đọc.
const TEMPLATE_WORD_PROSE = /(?<![A-Za-z0-9_\-/.])(?:[A-Z][a-z]|[A-Z]{2,}(?![A-Za-z0-9_\-/]))/;
// Thuộc tính mang chữ cho người đọc màn hình, đọc cả khi chữ không có dấu ("Voucher", "Freeship").
const TEXT_ATTRS = new Set(['aria-label', 'title', 'alt', 'placeholder', 'label']);
const CODE_ATTRS = new Set(['className', 'id', 'key', 'href']);

// Biểu thức chỉ chuyển tiếp giá trị: `title={a ? 'x' : 'y'}` vẫn là chữ của thuộc tính, còn `title={fillCopy('khoá.chữ')}` thì chuỗi là khoá, không phải chữ.
const isPassThrough = (n: ts.Node) => ts.isJsxExpression(n) || ts.isParenthesizedExpression(n) || ts.isConditionalExpression(n) || (ts.isBinaryExpression(n) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind));

/** Chỗ chuỗi nằm: giá trị thuộc tính JSX (`attr`), con của thẻ `<A>{'x'}</A>` (`child`), hoặc nơi khác. `direct` = chỉ qua biểu thức chuyển tiếp, chưa qua lời gọi hàm hay phép so sánh. */
function enclosingSlot(node: ts.Node): { kind: 'attr'; name: string; direct: boolean } | { kind: 'child'; direct: boolean } | null {
  let direct = true;
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p)) return { kind: 'attr', name: ts.isIdentifier(p.name) ? p.name.text : p.name.getText(), direct };
    if (ts.isJsxElement(p) || ts.isJsxFragment(p)) return { kind: 'child', direct };
    if (ts.isJsxSelfClosingElement(p) || ts.isSourceFile(p)) return null;
    if (!isPassThrough(p)) direct = false;
  }
  return null;
}

function displayStrings(source: string, fileName: string): { line: number; text: string }[] {
  // .ts đọc theo kiểu TS: `<T>(x) => x` ở .ts là hàm generic, đọc như TSX sẽ thành thẻ JSX và sinh chữ giả.
  const kind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out: { line: number; text: string }[] = [];
  // Trình duyệt gộp xuống dòng và thụt lề thành một dấu cách: "Vui\n   lòng" khách đọc là "Vui lòng", nên mẫu phải chạy trên chữ đã gộp.
  const push = (n: ts.Node, text: string) => out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: text.replace(/\s+/g, ' ') });
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return;
    if (ts.isJsxText(n)) {
      if (n.text.trim() !== '') push(n, n.text);
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      const slot = enclosingSlot(n);
      const attr = slot?.kind === 'attr' ? slot : null;
      const isCode = attr !== null && (CODE_ATTRS.has(attr.name) || attr.name.startsWith('data-'));
      const isTextAttr = attr !== null && attr.direct && TEXT_ATTRS.has(attr.name);
      const isChild = slot?.kind === 'child' && slot.direct;
      const isTemplatePart = ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n);
      if (!isCode && (VI_LETTER.test(n.text) || ASCII_PROSE.test(n.text) || (isTemplatePart && TEMPLATE_WORD_PROSE.test(n.text)) || isTextAttr || isChild)) push(n, n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

interface TermHit {
  file: string;
  line: number;
  use: string;
  text: string;
}

function findHits(sources: { file: string; text: string }[]): TermHit[] {
  const hits: TermHit[] = [];
  for (const { file, text } of sources) {
    if (NOT_SCANNED.some((re) => re.test(file))) continue;
    for (const s of displayStrings(text, file)) {
      for (const term of FORBIDDEN_TERMS) if (term.pattern.test(s.text)) hits.push({ file, line: s.line, use: term.use, text: s.text.trim() });
    }
  }
  return hits;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function loadSources(): { file: string; text: string }[] {
  return [...ROOTS.flatMap((root) => walk(join(REPO, root))), ...walk(join(REPO, API_ROOT))]
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: relative(REPO, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }))
    .filter((s) => (s.file.startsWith('apps/api/') ? isApiCopyFile(s.file) : true) && !NOT_SCANNED.some((re) => re.test(s.file)));
}

interface Exemption {
  file: string;
  use: string;
  /** Trần số chỗ vi phạm của file với chữ này: vượt thì đỏ (không thêm vi phạm mới vào file đã miễn). */
  max: number;
  reason: string;
}
const USE = {
  voice: 'Bạn hoặc Tubu',
  ellipsis: '… (một ký tự)',
  brand: 'Thương hiệu',
  store: 'Gian hàng',
  stock: 'Còn {n} sản phẩm',
  flash: 'Giờ vàng (hoa chữ G)',
  expiry: 'Hạn dùng hoặc Dùng đến',
} as const;

// Mỗi lý do nêu vì sao chữ cũ còn đó và ai sẽ đổi: không có dòng nào là "đã chấp nhận vĩnh viễn".
const REASON = {
  VOICE: 'câu lỗi, nhắc nhập liệu và giới thiệu viết trước đợt này dùng "Vui lòng"/"chúng tôi"; ux-copy D2 cấm trong chữ khách xem, đổi hàng loạt sang "bạn/Tubu" thuộc gói chữ riêng, không sửa trong P17a',
  ELLIPSIS: 'chữ trạng thái "Đang ..." và chữ giữ chỗ (kể cả "https://...") viết ba dấu chấm thay vì "…" (ux-copy D2 dấu câu); đổi hàng loạt thuộc gói chữ riêng',
  BRAND: 'màn chủ thương hiệu còn "Nhãn hàng"; ux-copy UC-01 đổi sang "Thương hiệu", thuộc gói chữ riêng (dải "Cùng nhà" ở PDP đã đổi ở G3)',
  STORE_PHYSICAL: '"cửa hàng" ở đây là điểm bán/điểm nhận vật lý của đối tác hoặc của khách (Đổi rác, đại lý, sổ điểm), không phải Gian hàng CTV; D2 chưa tách hai nghĩa nên chưa quyết đổi chữ',
  STORE_CTV: 'chữ cũ của màn Gian hàng CTV ("Đang xem cửa hàng") chưa đổi sang "Gian hàng" (ux-copy D2); đổi thuộc gói chữ riêng',
  STOCK: '"Chỉ còn n" viết trước đợt này; D2 chốt "Còn {n} sản phẩm" (brief §3.2), đổi thuộc gói chữ riêng',
  FLASH: '"giờ vàng" viết thường hoặc "Ưu đãi giờ vàng" (D2: luôn hoa chữ G, bỏ "Ưu đãi giờ vàng"); đổi thuộc gói chữ riêng',
  EXPIRY: '"HSD" viết tắt (D2: "Hạn dùng" hoặc "Dùng đến"); đổi thuộc gói chữ riêng, `/uu-dai` còn do P14 dựng lại',
  LEGAL: 'văn bản pháp lý (điều khoản, bảo mật, đổi trả, vận chuyển): "chúng tôi" là chủ thể ký trong văn bản, đổi chữ cần chủ duyệt nội dung, không phải chữ giao diện',
} as const;

const EXEMPT: Exemption[] = [
  { file: 'apps/miniapp/src/components/error-boundary.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/miniapp/src/components/storefront-pickers.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/miniapp/src/i18n/vi.ts', use: USE.voice, max: 4, reason: REASON.VOICE },
  { file: 'apps/miniapp/src/pages/about.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/miniapp/src/pages/bank-payment.tsx', use: USE.voice, max: 4, reason: REASON.VOICE },
  { file: 'apps/miniapp/src/pages/dealer.tsx', use: USE.voice, max: 2, reason: REASON.VOICE },
  { file: 'apps/miniapp/src/pages/edit-profile.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/miniapp/src/pages/notifications.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/miniapp/src/pages/order-detail.tsx', use: USE.voice, max: 2, reason: REASON.VOICE },
  { file: 'apps/miniapp/src/utils/refund-rules.ts', use: USE.voice, max: 2, reason: REASON.VOICE },
  { file: 'apps/web/src/app/dang-nhap/callback/page.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/error.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/gioi-thieu/about-view.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/global-error.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/hoan-tien/page.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/merchant/page.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/tai-khoan/don-hang/[code]/order-actions.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/tai-khoan/don-hang/[code]/order-extras.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/tai-khoan/don-hang/page.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/tai-khoan/ho-so/page.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/tai-khoan/orders-section.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/tai-khoan/thong-bao/page.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/tai-khoan/vi-tubu/page.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/app/thanh-toan/bank-transfer-panel.tsx', use: USE.voice, max: 2, reason: REASON.VOICE },
  { file: 'apps/web/src/components/affiliate/ctv-order-copy.ts', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/components/affiliate/storefront-sheets.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/components/dealer/dealer-apply.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/components/dealer/price-tab.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/components/ui/error-state.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/lib/auth-context.tsx', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/lib/checkout-rules.ts', use: USE.voice, max: 2, reason: REASON.VOICE },
  { file: 'apps/web/src/lib/client-api.ts', use: USE.voice, max: 3, reason: REASON.VOICE },
  { file: 'apps/web/src/lib/customer-refunds-admin.ts', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/lib/error-text.ts', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/lib/home-text.ts', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/lib/login-errors.ts', use: USE.voice, max: 6, reason: REASON.VOICE },
  { file: 'apps/web/src/lib/loyalty-pos.ts', use: USE.voice, max: 1, reason: REASON.VOICE },
  { file: 'apps/web/src/lib/refund-rules.ts', use: USE.voice, max: 2, reason: REASON.VOICE },
  { file: 'apps/miniapp/src/components/reviews-section.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/miniapp/src/components/storefront-pickers.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/miniapp/src/components/wheel.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/miniapp/src/i18n/vi.ts', use: USE.ellipsis, max: 4, reason: REASON.ELLIPSIS },
  { file: 'apps/miniapp/src/pages/cashback.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/app/hoan-tien/page.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/app/merchant/image-url-field.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/app/merchant/page.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/app/merchant/product-form.tsx', use: USE.ellipsis, max: 5, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/app/thanh-toan/page.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/components/affiliate/storefront-sheets.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/components/affiliate/storefront-signup.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/components/dealer/credit-tab.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/components/dealer/dealer-apply.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/components/dealer/price-tab.tsx', use: USE.ellipsis, max: 2, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/components/dealer/rewards-card.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/components/game/wheel.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/components/staff/payroll-hub.tsx', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/components/staff/shift-sheets.tsx', use: USE.ellipsis, max: 2, reason: REASON.ELLIPSIS },
  { file: 'apps/web/src/lib/browse-text.ts', use: USE.ellipsis, max: 1, reason: REASON.ELLIPSIS },
  { file: 'apps/miniapp/src/i18n/vi.ts', use: USE.brand, max: 1, reason: REASON.BRAND },
  { file: 'apps/miniapp/src/pages/brand-owner.tsx', use: USE.brand, max: 2, reason: REASON.BRAND },
  { file: 'apps/miniapp/src/pages/profile.tsx', use: USE.brand, max: 1, reason: REASON.BRAND },
  { file: 'apps/web/src/app/chu-thuong-hieu/layout.tsx', use: USE.brand, max: 1, reason: REASON.BRAND },
  { file: 'apps/web/src/components/account/account-menu.ts', use: USE.brand, max: 1, reason: REASON.BRAND },
  { file: 'apps/web/src/components/brand-owner/brand-owner-hub.tsx', use: USE.brand, max: 3, reason: REASON.BRAND },
  { file: 'apps/web/src/lib/brand-owner-view.ts', use: USE.brand, max: 1, reason: REASON.BRAND },
  { file: 'apps/web/src/lib/storefront-badge.ts', use: USE.brand, max: 1, reason: REASON.BRAND },
  { file: 'apps/miniapp/src/components/waste-desk-perk.tsx', use: USE.store, max: 2, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/miniapp/src/components/waste-point-picker.tsx', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/miniapp/src/i18n/vi.ts', use: USE.store, max: 1, reason: REASON.STORE_CTV },
  { file: 'apps/miniapp/src/pages/dealer.tsx', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/miniapp/src/pages/recycle-desk.tsx', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/miniapp/src/services/account-api.ts', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/web/src/components/dealer/dealer-apply.tsx', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/web/src/components/recycle/recycle-desk-perk.tsx', use: USE.store, max: 2, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/web/src/components/recycle/recycle-desk.tsx', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/web/src/components/recycle/waste-point-picker.tsx', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/web/src/lib/ledger-labels.ts', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/miniapp/src/utils/waste-labels.ts', use: USE.stock, max: 3, reason: REASON.STOCK },
  { file: 'apps/web/src/components/recycle/recycle-labels.ts', use: USE.stock, max: 3, reason: REASON.STOCK },
  { file: 'apps/miniapp/src/i18n/vi.ts', use: USE.flash, max: 1, reason: REASON.FLASH },
  { file: 'apps/web/src/app/merchant/settlement-tab.tsx', use: USE.flash, max: 2, reason: REASON.FLASH },
  { file: 'apps/web/src/components/affiliate/ctv-order-copy.ts', use: USE.flash, max: 1, reason: REASON.FLASH },
  { file: 'apps/web/src/lib/home-text.ts', use: USE.flash, max: 2, reason: REASON.FLASH },
  { file: 'apps/miniapp/src/pages/about-data.ts', use: USE.expiry, max: 1, reason: REASON.EXPIRY },
  { file: 'apps/web/src/lib/faq-fallback.ts', use: USE.expiry, max: 1, reason: REASON.EXPIRY },
  { file: 'packages/app-core/src/legal.ts', use: USE.voice, max: 6, reason: REASON.LEGAL },
  { file: 'packages/app-core/src/game-newbie.ts', use: USE.ellipsis, max: 2, reason: REASON.ELLIPSIS },
  { file: 'packages/app-core/src/dealer-apply-copy.ts', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'packages/app-core/src/loyalty-copy.ts', use: USE.store, max: 2, reason: REASON.STORE_PHYSICAL },
  { file: 'packages/app-core/src/notification-route.ts', use: USE.flash, max: 2, reason: REASON.FLASH },
];

// Đối chứng trên nguồn giả: mẫu quét phải bắt đúng chữ hiển thị và bỏ qua mã (comment, tên biến, className, import, kiểu literal).
describe('displayStrings: chỉ lấy chữ khách đọc', () => {
  const texts = (src: string, file = 'apps/miniapp/src/pages/x.tsx') => displayStrings(src, file).map((s) => s.text.trim());

  it.each([
    ['<p>Vui lòng thử lại</p>', 'Vui lòng thử lại'],
    ["const m = 'Mất kết nối, vui lòng thử lại';", 'Mất kết nối, vui lòng thử lại'],
    ['<img alt="Freeship" />', 'Freeship'],
    ['<input placeholder="Voucher" />', 'Voucher'],
    ['<button title="Top">x</button>', 'Top'],
    ["const m = `Đang tải... ${n} món`;", 'Đang tải...'],
    ['<span>Flash sale</span>', 'Flash sale'],
    ["<input placeholder={ok ? 'Voucher' : undefined} />", 'Voucher'],
    ["<Badge>{'Freeship'}</Badge>", 'Freeship'],
    ["<Badge>{ok && 'HOT'}</Badge>", 'HOT'],
    ["<Badge>{ok ? 'Flash sale' : null}</Badge>", 'Flash sale'],
    ['<Chip text="Voucher" />', 'Voucher'],
    ['<Chip text="Flash sale" />', 'Flash sale'],
    ["const BADGE = 'Flash sale';", 'Flash sale'],
    ["const LEFT = '2h 05m';", '2h 05m'],
    ["const hint = 'voucher của bạn';", 'voucher của bạn'],
    ['<p>Mất kết nối. Vui\n            lòng thử lại</p>', 'Mất kết nối. Vui lòng thử lại'],
    ['const label = `HSD ${d}`;', 'HSD'],
    ["const label = `HSD: ${d}`;", 'HSD:'],
    ['const label = `${code} · HSD ${d}`;', '· HSD'],
    ['const label = `${n} HOT`;', 'HOT'],
    ['const label = `${a} Freeship`;', 'Freeship'],
    ['const label = `(HSD ${d})`;', '(HSD'],
    ['const label = `(Top ${n})`;', '(Top'],
    ['const label = `${n} HOT!`;', 'HOT!'],
    ['const label = `${n}, HSD.`;', ', HSD.'],
    ['const label = `${n} (HOT)`;', '(HOT)'],
    ['const label = `${a} · HSD\\n`;', '· HSD'],
  ])('bắt %s', (src, expected) => {
    expect(texts(src, 'apps/miniapp/src/pages/x.tsx')).toContain(expected);
  });

  it('chuỗi ASCII đọc như câu trong file .ts cũng được bắt', () => {
    expect(texts("export const BADGE = 'Flash sale';", 'apps/web/src/lib/badges.ts')).toContain('Flash sale');
  });

  it.each([
    ['// Vui lòng thử lại'],
    ['/* Chỉ còn 3 món */ const a = 1;'],
    ['const voucherList = 1;'],
    ['<div className="tubu-voucher-card" />'],
    ['<div className="Còn hàng" />'],
    ['<div data-testid="voucher-row" />'],
    ["import x from './voucher-sheet';"],
    ["export { y } from './freeship';"],
    ["type K = 'FREESHIP' | 'Chỉ còn';"],
    ["const kind = 'FREESHIP';"],
    ['const re = /Vui lòng/;'],
    ["<ScrollRow label={fillCopy('shop.vouchers')} />"],
    ["<Badge>{fillCopy('badge.freeship')}</Badge>"],
    ["<Badge>{kind === 'FREESHIP' && <Icon />}</Badge>"],
    ["<Badge>{items.map((i) => i.kind === 'voucher' ? 1 : 2)}</Badge>"],
    ["const key = ['voucher', id];"],
    ["const kind = 'freeship';"],
    ["const url = '/api/vouchers';"],
    ["const css = 'flash-sale-row';"],
    ['<Chip tone="FREESHIP" />'],
  ])('bỏ qua %s', (src) => {
    expect(displayStrings(src, 'x.tsx')).toEqual([]);
  });

  it('file .ts đọc theo kiểu TS: hàm generic <T>(x) => x không sinh chữ giả', () => {
    expect(displayStrings('const f = <T>(a: T, ...r: unknown[]) => api.get(...r);', 'x.ts')).toEqual([]);
  });

  it('JSX ngắt dòng giữa hai từ vẫn đọc như một dấu cách', () => {
    expect(texts('<p>\n  Chúng\n    tôi kết nối bạn\n</p>')).toEqual(['Chúng tôi kết nối bạn']);
  });

  it('ghi đúng số dòng của chuỗi', () => {
    expect(displayStrings("const a = 1;\nconst b = 'Vui lòng';", 'x.ts')).toEqual([{ line: 2, text: 'Vui lòng' }]);
  });
});

describe('findHits: ca vi phạm cố ý', () => {
  const bad = "export const m = 'Vui lòng thử lại';";

  it('chữ cấm trong file khách xem ra đúng một hit kèm chữ thay thế', () => {
    const hits = findHits([{ file: 'apps/miniapp/src/pages/x.tsx', text: bad }]);
    expect(hits).toEqual([{ file: 'apps/miniapp/src/pages/x.tsx', line: 1, use: 'Bạn hoặc Tubu', text: 'Vui lòng thử lại' }]);
  });

  it.each([
    'apps/web/src/app/admin/page.tsx',
    'apps/web/src/components/admin/tab.tsx',
    'apps/web/src/lib/admin-client.ts',
    'apps/miniapp/src/pages/x.spec.tsx',
    'apps/web/src/test-utils/fixtures/rows.ts',
  ])('không quét %s', (file) => {
    expect(findHits([{ file, text: bad }])).toEqual([]);
  });

  // Mỗi luật FORBIDDEN_TERMS phải có ít nhất một ca bắt và một ca bỏ qua (ux-copy D2), kể cả chữ ASCII không dấu.
  const CATCH: [text: string, use: string][] = [
    ['Nhãn hàng của bạn', 'Thương hiệu'],
    ['Theo dõi nhãn này', 'Thương hiệu'],
    ['Cùng nhà', 'Thương hiệu'],
    ['Top bán chạy', 'Bán chạy nhất'],
    ['Freeship cho đơn từ 299k', 'Miễn phí giao hàng'],
    ['Kho voucher của bạn', 'Mã giảm giá'],
    ['Rủ bạn mua chung, nhận mã giảm 15%', 'Mã giảm giá'],
    ['Mã giảm', 'Mã giảm giá'],
    ['Flash sale hôm nay', 'Giờ vàng'],
    ['Ưu đãi giờ vàng', 'Giờ vàng (hoa chữ G)'],
    ['HSD 12/2026', 'Hạn dùng hoặc Dùng đến'],
    ['Chỉ còn 3 sản phẩm', 'Còn {n} sản phẩm'],
    ['Mất kết nối, vui lòng thử lại', 'Bạn hoặc Tubu'],
    ['Chúng tôi sẽ gọi lại', 'Bạn hoặc Tubu'],
    ['Mua tại cửa hàng', 'Gian hàng'],
    ['Đang tải...', '… (một ký tự)'],
    ['Còn 2h 05m', 'countdownText, ví dụ "2 giờ 05 phút"'],
    ['Còn 2h 5m', 'countdownText, ví dụ "2 giờ 05 phút"'],
    ['Còn 12h 30m', 'countdownText, ví dụ "2 giờ 05 phút"'],
    ['Hàng HOT', 'bỏ chữ giục mua'],
    ['Giá SỐC', 'bỏ chữ giục mua'],
    ['Giá sốc', 'bỏ chữ giục mua'],
    ['Mua kèm deal sốc', 'bỏ chữ giục mua'],
    ['Nhanh tay kẻo hết', 'bỏ chữ giục mua'],
  ];

  it.each(CATCH)('"%s" bị bắt (use: %s)', (text, use) => {
    const hits = findHits([{ file: 'apps/web/src/a.tsx', text: `export const t = ${JSON.stringify(text)};` }]);
    expect(hits.map((h) => h.use)).toContain(use);
  });

  it('mỗi luật của FORBIDDEN_TERMS có ít nhất một ca bắt', () => {
    const uncovered = FORBIDDEN_TERMS.filter((t) => !CATCH.some(([text]) => t.pattern.test(text))).map((t) => String(t.pattern));
    expect(uncovered).toEqual([]);
  });

  it.each([
    'Giờ vàng',
    'Bán chạy nhất',
    'Mã giảm giá',
    'Nhận mã giảm giá 15% cho đơn sau',
    'mã giảm giá của shop',
    'Thương hiệu',
    'Gian hàng',
    'Miễn phí giao hàng',
    'Hạn dùng 12/2026',
    'Còn 3 sản phẩm',
    'Đang tải…',
    'Kết thúc sau 2 giờ 05 phút',
    'Topping',
    'Hotline',
    'Bạn thử lại nhé',
    'Mua kèm giá tốt',
  ])('"%s" sạch', (text) => {
    expect(findHits([{ file: 'apps/web/src/a.tsx', text: `export const t = ${JSON.stringify(text)};` }])).toEqual([]);
  });

  it.each([
    ["export const B = () => <Badge>{'Freeship'}</Badge>;", 'Miễn phí giao hàng'],
    ['export const B = () => <Chip text="Voucher" />;', 'Mã giảm giá'],
    ["export const BADGE = 'Flash sale';", 'Giờ vàng'],
    ["export const LEFT = '2h 05m';", 'countdownText, ví dụ "2 giờ 05 phút"'],
    ["export const B = () => <Badge>{ok && 'HSD'}</Badge>;", 'Hạn dùng hoặc Dùng đến'],
    ['export const B = () => <span>HOT</span>;', 'bỏ chữ giục mua'],
    ['export const hsd = (d: string) => `HSD ${d}`;', 'Hạn dùng hoặc Dùng đến'],
    ['export const hsd = (d: string) => `HSD: ${d}`;', 'Hạn dùng hoặc Dùng đến'],
  ])('chữ ASCII không dấu %s bị bắt', (text, use) => {
    expect(findHits([{ file: 'apps/web/src/a.tsx', text }]).map((h) => h.use)).toContain(use);
  });
});

describe('findHits: chuỗi template bắt đầu bằng chữ hoa ASCII', () => {
  const at = (src: string) => findHits([{ file: 'apps/web/src/a.ts', text: src }]).map((h) => h.use);

  it('"HSD ${d}" bị bắt dù đầu chuỗi chỉ là "HSD " (không dấu, không dạng "Chữ hoa + chữ thường")', () => {
    expect(at('export const hsd = (d: string) => `HSD ${d}`;')).toEqual(['Hạn dùng hoặc Dùng đến']);
  });

  it('template kiểu `GET ${path}` hoặc `FREESHIP-${id}` không có chữ cấm nên không ra hit', () => {
    expect(at('export const call = (path: string) => `GET ${path}`;')).toEqual([]);
    expect(at('export const code = (id: string) => `FREESHIP-${id}`;')).toEqual([]);
  });

  // `ASCII_PROSE` chỉ xét đầu chuỗi; đoạn đứng sau một biểu thức (TemplateMiddle/TemplateTail) không có "đầu chuỗi" nên phải xét riêng.
  it.each([
    ['export const t = (c: string, d: string) => `${c} · HSD ${d}`;', 'Hạn dùng hoặc Dùng đến'],
    ['export const t = (n: number) => `${n} sản phẩm HOT`;', 'bỏ chữ giục mua'],
    ['export const t = (n: number) => `${n} HOT`;', 'bỏ chữ giục mua'],
    ['export const t = (a: string, b: string) => `${a} - Freeship - ${b}`;', 'Miễn phí giao hàng'],
    ['export const t = (a: string, b: string) => `${a} HSD: ${b}`;', 'Hạn dùng hoặc Dùng đến'],
  ])('đoạn giữa/cuối của template %s bị bắt', (src, use) => {
    expect(at(src)).toEqual([use]);
  });

  it('đoạn giữa/cuối chỉ là mã định danh hoặc đường dẫn không bị coi là chữ khách đọc', () => {
    expect(at('export const a = (id: string, n: string) => `FREESHIP-${id}-${n}-x`;')).toEqual([]);
    expect(at('export const b = (a: string, b: string) => `${a}/voucher/${b}`;')).toEqual([]);
    expect(at('export const c = (a: string, b: string) => `${a} GET ${b}`;')).toEqual([]);
    expect(at('export const d = (a: string) => `${a}-FREESHIP`;')).toEqual([]);
  });
});

describe('findHits: mọi đoạn template (đầu, giữa, cuối) có từ hoa ASCII đứng riêng (L5 4)', () => {
  const at = (src: string) => findHits([{ file: 'apps/web/src/a.ts', text: src }]).map((h) => h.use);

  // Đầu template bắt đầu bằng dấu câu: `ASCII_PROSE` neo ở đầu chuỗi nên bỏ sót "(HSD ".
  it('đầu template bắt đầu bằng dấu câu `(HSD ${d})` bị bắt', () => {
    expect(at('export const t = (d: string) => `(HSD ${d})`;')).toEqual(['Hạn dùng hoặc Dùng đến']);
    expect(at('export const t = (n: number) => `(HOT) ${n}`;')).toEqual(['bỏ chữ giục mua']);
    expect(at('export const t = (n: number) => `(Top ${n})`;')).toEqual(['Bán chạy nhất']);
  });

  // Nhánh chữ hoa cũ chỉ nhận dấu cách, hai chấm hoặc hết đoạn ngay sau chữ.
  it.each([
    ['export const t = (n: number) => `${n} HOT!`;', 'bỏ chữ giục mua'],
    ['export const t = (n: number, d: string) => `${n}, HSD.${d}`;', 'Hạn dùng hoặc Dùng đến'],
    ['export const t = (n: number) => `${n} (HOT)`;', 'bỏ chữ giục mua'],
    ['export const t = (a: string, d: string) => `${a} · HSD\\n${d}`;', 'Hạn dùng hoặc Dùng đến'],
    ['export const t = (a: string) => `${a} · HSD\\n`;', 'Hạn dùng hoặc Dùng đến'],
    ['export const t = (a: string) => `${a} - HOT, ${a}`;', 'bỏ chữ giục mua'],
  ])('đoạn có từ hoa đứng riêng sau dấu câu hoặc ngoặc %s bị bắt', (src, use) => {
    expect(at(src)).toEqual([use]);
  });

  it('mã định danh, đường dẫn và tên lớp có từ hoa dính ký tự mã không bị coi là chữ khách đọc', () => {
    expect(at('export const a = (id: string, n: string) => `FREESHIP-${id}-${n}-x`;')).toEqual([]);
    expect(at('export const b = (a: string) => `${a}-FREESHIP`;')).toEqual([]);
    expect(at('export const c = (a: string, b: string) => `${a}/voucher/${b}`;')).toEqual([]);
    expect(at('export const d = (a: string, b: string) => `${a} GET ${b}`;')).toEqual([]);
    expect(at('export const e = (base: string, id: string) => `${base}/HOT/${id}`;')).toEqual([]);
    expect(at('export const f = (x: string) => `HOT_${x}`;')).toEqual([]);
    expect(at('export const g = (a: string) => `${a}_HSD`;')).toEqual([]);
    expect(at('export const h = (a: string) => `${a}.HOT`;')).toEqual([]);
    expect(at('export const i = (a: string, b: string) => `${a}-HSD-${b}`;')).toEqual([]);
    expect(at('export const j = (a: string) => `tubu-${a}-HOT`;')).toEqual([]);
    expect(at('export const k = (x: string) => `HOT/${x}`;')).toEqual([]);
  });
});

describe('findHits: file chữ khách đọc của API', () => {
  const at = (file: string, text: string) => findHits([{ file, text }]).map((h) => h.use);

  it('phạm vi quét đúng như DESIGN.md ghi: *-notice(.service).ts, *-price(.service).ts và cart/cart.batch-error.ts, không quét service lớn', () => {
    const m = 'apps/api/src/modules';
    for (const f of ['coupons/coupon-notice.ts', 'loyalty/tier-drop-notice.service.ts', 'flash-sale/flash-line-price.ts', 'pricing/x-price.service.ts', 'cart/cart.batch-error.ts']) {
      expect(isApiCopyFile(`${m}/${f}`), f).toBe(true);
    }
    for (const f of ['flash-sale/flash-sale.service.ts', 'cart/cart.service.ts', 'admin/dealer-price-import.ts', 'wallet/referral-notice-ledger.ts']) {
      expect(isApiCopyFile(`${m}/${f}`), f).toBe(false);
    }
  });

  it('câu lý do cũ của coupon-notice ("mã FREESHIP", "giờ vàng", "Chỉ còn") bị bắt', () => {
    const file = 'apps/api/src/modules/coupons/x-notice.ts';
    expect(at(file, "export const r = 'Đơn đầu đã được miễn phí giao, mã FREESHIP được giữ cho đơn sau.';")).toContain('Miễn phí giao hàng');
    expect(at(file, "export const r = 'Hàng giờ vàng không được giảm thêm theo mã.';")).toContain('Giờ vàng (hoa chữ G)');
    expect(at('apps/api/src/modules/flash-sale/x-price.ts', 'export const m = (n: number) => `Chỉ còn ${n} suất Giờ vàng.`;')).toContain('Còn {n} sản phẩm');
  });
});

describe('findHits: câu JSX bị Prettier ngắt dòng', () => {
  const at = (src: string) => findHits([{ file: 'apps/web/src/a.tsx', text: src }]).map((h) => h.use);

  it('thuật ngữ hai từ bị ngắt dòng ở giữa vẫn bị bắt', () => {
    expect(at('export const B = () => <p>Mất kết nối. Vui\n   lòng thử lại</p>;')).toContain('Bạn hoặc Tubu');
    expect(at('export const B = () => <p>Nhận\n   mã giảm</p>;')).toContain('Mã giảm giá');
  });

  it('"Mã giảm giá" ngắt dòng ở giữa không bị bắt nhầm', () => {
    expect(at('export const B = () => <p>Nhận mã giảm\n   giá</p>;')).toEqual([]);
  });
});

describe('mã thật của apps/miniapp và apps/web', () => {
  const sources = loadSources();

  // Chữ API trả cho khách (lý do mã không dùng được, lời báo Giờ vàng, lỗi tồn kho) đến tận màn hình mà ngoài tầm quét của app (review/extra-critique-2 P2 #18).
  it('quét cả file chữ khách đọc của API, không quét service và chữ cấm mới ở đó bị bắt', () => {
    for (const f of ['coupons/coupon-notice.ts', 'flash-sale/flash-line-price.ts', 'cart/cart.batch-error.ts', 'loyalty/tier-drop-notice.service.ts']) {
      expect(sources.some((s) => s.file === `apps/api/src/modules/${f}`), f).toBe(true);
    }
    expect(sources.some((s) => s.file === 'apps/api/src/modules/cart/cart.service.ts')).toBe(false);
    expect(sources.some((s) => s.file.startsWith('apps/api/') && !isApiCopyFile(s.file))).toBe(false);
  });
  const hits = findHits(sources);
  const countOf = (file: string, use: string) => hits.filter((h) => h.file === file && h.use === use).length;

  it('quét được cây thật (không quét rỗng)', () => {
    expect(sources.length).toBeGreaterThan(300);
    expect(sources.some((s) => s.file.startsWith('apps/miniapp/src/'))).toBe(true);
    expect(sources.some((s) => s.file.startsWith('apps/web/src/'))).toBe(true);
  });

  it('quét cả chữ dùng chung của app-core (shop-copy, voucher, countdown...), và chữ cấm mới ở đó bị bắt', () => {
    for (const f of ['shop-copy.ts', 'home-copy.ts', 'commerce/countdown.ts', 'commerce/voucher.ts']) {
      expect(sources.some((s) => s.file === `packages/app-core/src/${f}`), f).toBe(true);
    }
    const fresh = findHits([{ file: 'packages/app-core/src/fresh-copy.ts', text: "export const m = 'Vui lòng thử lại';" }]);
    expect(fresh.map((h) => `${h.file} [${h.use}]`)).toEqual(['packages/app-core/src/fresh-copy.ts [Bạn hoặc Tubu]']);
    expect(EXEMPT.some((e) => e.file === 'packages/app-core/src/fresh-copy.ts')).toBe(false);
  });

  it('không có chữ cấm ngoài danh sách miễn, và file đã miễn không vượt trần max', () => {
    const over = hits.filter((h) => {
      const e = EXEMPT.find((x) => x.file === h.file && x.use === h.use);
      return !e || countOf(h.file, h.use) > e.max;
    });
    expect(over.map((h) => `${h.file}:${h.line} [${h.use}] ${h.text.slice(0, 60)}`)).toEqual([]);
  });

  it('mỗi dòng miễn có lý do, trỏ file đã quét, dùng chữ thay thế có thật, không trùng', () => {
    const uses = new Set(FORBIDDEN_TERMS.map((t) => t.use));
    const files = new Set(sources.map((s) => s.file));
    const keys = EXEMPT.map((e) => `${e.file}|${e.use}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of EXEMPT) {
      expect(e.reason.trim().length, `${e.file} thiếu lý do`).toBeGreaterThan(10);
      expect(files.has(e.file), `${e.file} không nằm trong cây quét`).toBe(true);
      expect(uses.has(e.use), `${e.use} không phải một FORBIDDEN_TERMS.use`).toBe(true);
      expect(e.max, `${e.file} max`).toBeGreaterThan(0);
    }
  });

  it('trần max bằng đúng số chữ cũ còn lại: sửa bớt thì hạ max, sạch hẳn thì xoá dòng', () => {
    const off = EXEMPT.filter((e) => countOf(e.file, e.use) < e.max).map((e) => {
      const n = countOf(e.file, e.use);
      return `${e.file} [${e.use}]: còn ${n}/${e.max}, ${n === 0 ? 'xoá dòng miễn' : `hạ max xuống ${n}`}`;
    });
    expect(off).toEqual([]);
  });

  // Khối "Sắp diễn ra" của Giờ vàng Trang chủ (Mini `components/flash-sale.tsx`, web `components/home/flash-sale.tsx`) ghép "Sau {t}" (`flash.startsInTile`) qua `fillCopy`, ngoài tầm
  // quét chữ thô, nên `t` phải đến từ `countdownText` ("2 giờ 05 phút"). `formatCountdown` ("2h 05m") đã xoá; ca này giữ cho nó không quay lại qua một file giao diện.
  it('không file giao diện nào còn dùng formatCountdown, và chữ đếm ngược không dính dạng cấm "2h 05m" (D2 countdownText)', () => {
    const users = sources.filter((s) => !NOT_SCANNED.some((re) => re.test(s.file)) && /\bformatCountdown\b/.test(s.text)).map((s) => s.file);
    expect(users).toEqual([]);
    const shown = countdownText(2 * 3_600_000 + 5 * 60_000);
    expect(shown).toBe('2 giờ 05 phút');
    expect(FORBIDDEN_TERMS.filter((t) => t.pattern.test(shown)).map((t) => t.use)).toEqual([]);
  });
});
