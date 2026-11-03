import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { countdownText } from './commerce/countdown';
import { couponNotAppliedNotice } from './commerce/coupon-notice';
import { FLASH_OVER_LIMIT_MESSAGE, FLASH_SOLD_OUT_MESSAGE, isCartFixableError } from './commerce/flash-limit';
import { fillCopy, FORBIDDEN_TERMS } from './shop-copy';
import { walletNegativeCheckoutReason } from './wallet-rules';
import { ACCOUNT_NAME_REQUIRED, ACCOUNT_NUMBER_INVALID, BANK_NAME_REQUIRED, RETURN_REASON_REQUIRED } from './client-copy';
import { REFUND_ACCOUNT_NAME_REQUIRED, REFUND_ACCOUNT_NUMBER_INVALID, REFUND_BANK_NAME_REQUIRED, RETURN_REASON_REQUIRED as API_RETURN_REASON_REQUIRED } from '../../../apps/api/src/modules/orders/refund-notice';
import { flashOverLimitMessage, FLASH_OVER_LIMIT_MSG, FLASH_SOLD_OUT_MSG } from '../../../apps/api/src/modules/flash-sale/flash-sale-notice';
import { WALLET_SHORT_MESSAGE, walletNegativeMessage } from '../../../apps/api/src/modules/checkout/wallet-notice';

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
// hoặc từ ASCII viết thường từ hai chữ (`${n} voucher`, `${n} flash sale`) mà trước đó không phải ký tự mã (chữ/số, `_`, `-`, `/`, `.`, `=`) và, với từ không viết hoa đầu, sau đó cũng không phải chữ/số, `_`, `-`, `/`, `=`; mọi ký tự khác (cách, dấu câu, ngoặc, `·`, hết đoạn) là ranh giới.
// Nhờ vậy `FREESHIP-${id}`, `${a}-FREESHIP`, `${base}/HOT/${id}`, `HOT_${x}`, `${a}.HOT` vẫn là mã định danh, còn `${n} HOT!`, `(HSD ${d})`, `${n}, HSD.` là chữ khách đọc.
const TEMPLATE_WORD_PROSE = /(?<![A-Za-z0-9_\-/.=])(?:[A-Z][a-z]|[A-Za-z]{2,}(?![A-Za-z0-9_\-/=]))/;
// Địa chỉ đầy đủ (`https://api.tubu.vn/vouchers/`) và giá trị truy vấn (`?tab=HOT`, `&sort=hot`, `=HOT`) là mã gửi cho máy chủ, không phải chữ khách đọc: bỏ khỏi đoạn template trước khi xét.
const QUERY_VALUE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*|[?&=][^\s&#]*/g;
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
      const text = isTemplatePart ? n.text.replace(QUERY_VALUE, ' ') : n.text;
      if (!isCode && (VI_LETTER.test(text) || ASCII_PROSE.test(text) || (isTemplatePart && TEMPLATE_WORD_PROSE.test(text)) || isTextAttr || isChild)) push(n, text);
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

function findHits(sources: { file: string; text: string }[], terms: readonly { pattern: RegExp; use: string }[] = FORBIDDEN_TERMS, skip: readonly RegExp[] = NOT_SCANNED): TermHit[] {
  const hits: TermHit[] = [];
  for (const { file, text } of sources) {
    if (skip.some((re) => re.test(file))) continue;
    for (const s of displayStrings(text, file)) {
      for (const term of terms) if (term.pattern.test(s.text)) hits.push({ file, line: s.line, use: term.use, text: s.text.trim() });
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

// Luật riêng cho API: "Vui lòng"/"chúng tôi" không quay lại ở BẤT KỲ file API nào (lỗi nghiệp vụ, chữ quản trị, tin nhắn), không chỉ ở file chữ khách đọc của `isApiCopyFile`.
// Chữ quản trị của API cũng đổi nên thư mục `admin/` không được miễn như `NOT_SCANNED`; chỉ bỏ spec. Các thuật ngữ cấm khác vẫn chỉ quét file chữ khách đọc.
const API_SRC = 'apps/api/src';
const API_SKIP = [/\.(spec|test)\.ts$/];
const API_VOICE = FORBIDDEN_TERMS.filter((t) => t.use === 'Bạn hoặc Tubu');

function loadApiSources(): { file: string; text: string }[] {
  return walk(join(REPO, API_SRC))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: relative(REPO, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }))
    .filter((s) => !API_SKIP.some((re) => re.test(s.file)));
}

/** Văn bản pháp lý nằm trong API (nếu có): "chúng tôi" là chủ thể ký trong văn bản. `max` bằng đúng số chỗ hiện có, như `EXEMPT`. Hiện không có. */
const API_VOICE_EXEMPT: { file: string; max: number; reason: string }[] = [];

interface Exemption {
  file: string;
  use: string;
  /** Trần số chỗ vi phạm của file với chữ này: vượt thì đỏ (không thêm vi phạm mới vào file đã miễn). */
  max: number;
  reason: string;
}
const USE = {
  voice: 'Bạn hoặc Tubu',
  store: 'Gian hàng',
} as const;

// Mỗi lý do nêu vì sao chữ cũ còn đó và ai sẽ đổi: không có dòng nào là "đã chấp nhận vĩnh viễn".
const REASON = {
  STORE_PHYSICAL: '"cửa hàng" ở đây là điểm bán/điểm nhận vật lý của đối tác hoặc của khách (Đổi rác, đại lý, sổ điểm), không phải Gian hàng CTV; D2 chưa tách hai nghĩa nên chưa quyết đổi chữ',
  LEGAL: 'văn bản pháp lý (điều khoản, bảo mật, đổi trả, vận chuyển): "chúng tôi" là chủ thể ký trong văn bản, đổi chữ cần chủ duyệt nội dung, không phải chữ giao diện',
} as const;

const EXEMPT: Exemption[] = [
  { file: 'apps/miniapp/src/components/waste-desk-perk.tsx', use: USE.store, max: 2, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/miniapp/src/components/waste-point-picker.tsx', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/miniapp/src/pages/dealer.tsx', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/miniapp/src/pages/recycle-desk.tsx', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/miniapp/src/services/account-api.ts', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/web/src/components/dealer/dealer-apply.tsx', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/web/src/components/recycle/recycle-desk-perk.tsx', use: USE.store, max: 2, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/web/src/components/recycle/recycle-desk.tsx', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/web/src/components/recycle/waste-point-picker.tsx', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'apps/web/src/lib/ledger-labels.ts', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'packages/app-core/src/legal.ts', use: USE.voice, max: 6, reason: REASON.LEGAL },
  { file: 'packages/app-core/src/dealer-apply-copy.ts', use: USE.store, max: 1, reason: REASON.STORE_PHYSICAL },
  { file: 'packages/app-core/src/loyalty-copy.ts', use: USE.store, max: 2, reason: REASON.STORE_PHYSICAL },
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
    ['Xem trang nhãn', 'Thương hiệu'],
    ['Nhãn Cocoon', 'Thương hiệu'],
    ['Xin nhãn Cocoon', 'Thương hiệu'],
    ['Xem nhãn giao nhanh', 'Thương hiệu'],
    ['Bạn chưa được cấp quyền quản lý nhãn nào', 'Thương hiệu'],
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
    'Quét mã trên nhãn dán ngoài hộp',
    'Bạn nhập hoặc quét lại mã trên nhãn nhé.',
    'Chụp ảnh sản phẩm, bao bì và tem nhãn',
    'Nhãn hiệu thuộc Tubu Tree',
    'Dán nhãn lên hộp trước khi gửi',
    'Long nhãn sấy',
    'Quét nhãn ngoài hộp',
    'In nhãn vận đơn',
    'Mật ong hoa nhãn',
    'Quả nhãn Hưng Yên',
    'Nhãn giao hàng',
    'Đọc kỹ nhãn trước khi dùng',
    'Xem nhãn sản phẩm ở mặt sau',
    'Nhãn lồng Hưng Yên',
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

describe('findHits: từ cấm viết thường và giá trị truy vấn trong template (M2)', () => {
  const at = (src: string) => findHits([{ file: 'apps/web/src/a.ts', text: src }]).map((h) => h.use);

  // Nhánh chữ hoa cũ bỏ sót từ cấm viết thường đứng riêng ở đoạn giữa và cuối: `${n} voucher` là chữ khách đọc.
  it.each([
    ['export const t = (n: number) => `${n} voucher`;', 'Mã giảm giá'],
    ['export const t = (n: number) => `${n} freeship`;', 'Miễn phí giao hàng'],
    ['export const t = (n: number) => `${n} flash sale`;', 'Giờ vàng'],
    ['export const t = (a: string, b: string) => `${a} · voucher ${b}`;', 'Mã giảm giá'],
    ['export const t = (n: number) => `${n} hot`;', 'bỏ chữ giục mua'],
    ['export const t = (n: number) => `${n} voucher của bạn`;', 'Mã giảm giá'],
  ])('từ cấm viết thường %s bị bắt', (src, use) => {
    expect(at(src)).toEqual([use]);
  });

  // Giá trị truy vấn và đường dẫn không phải chữ khách đọc; mã dính ký tự mã vẫn là mã định danh.
  it.each([
    'export const a = () => `/san-pham?tab=HOT`;',
    'export const b = (base: string, p: number) => `${base}?tab=HOT&page=${p}`;',
    'export const c = (base: string) => `${base}&sort=hot`;',
    'export const d = (p: number) => `/x?sort=hot&page=${p}`;',
    'export const e = (base: string, id: string) => `${base}/voucher/${id}`;',
    'export const f = (id: string) => `voucher-${id}`;',
    'export const g = (a: string) => `${a}_voucher`;',
    'export const h = (a: string) => `${a}-freeship`;',
    'export const i = (id: string) => `FREESHIP-${id}`;',
    'export const j = (x: string) => `HOT_${x}`;',
    'export const k = (base: string, id: string) => `${base}/HOT/${id}`;',
    'export const l = (a: string) => `${a}.voucher`;',
    'export const m = (id: string) => `https://api.tubu.vn/vouchers/${id}`;',
    'export const n = (a: string, t: string) => `${a}?tab=Top&q=${t}`;',
  ])('giá trị truy vấn hoặc mã dính ký tự mã %s không bị bắt', (src) => {
    expect(at(src)).toEqual([]);
  });

  it('displayStrings giữ từ viết thường ở đoạn template và bỏ giá trị truy vấn', () => {
    const texts = (src: string) => displayStrings(src, 'apps/web/src/a.ts').map((s) => s.text.trim());
    expect(texts('const t = `${n} voucher`;')).toContain('voucher');
    expect(texts('const u = `/x?tab=HOT&p=${p}`;').join('|')).not.toMatch(/HOT/);
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

describe('chữ "Vui lòng" và "chúng tôi" trong toàn bộ API (M2)', () => {
  const apiAt = (file: string, text: string) => findHits([{ file, text }], API_VOICE, API_SKIP).map((h) => h.use);

  it.each([
    ["export const m = 'Vui lòng thử lại';", 'apps/api/src/common/x.ts'],
    ["export const m = 'Hệ thống đang bận, vui lòng thử lại.';", 'apps/api/src/common/x.ts'],
    ["export const m = 'Chúng tôi sẽ gọi lại cho bạn.';", 'apps/api/src/modules/orders/x.service.ts'],
    ['export const m = (n: number) => `${n} sản phẩm hết hàng, vui lòng chọn lại.`;', 'apps/api/src/modules/cart/x.ts'],
    ["throw new BadRequestException('Vui lòng nhập lý do từ chối.');", 'apps/api/src/modules/admin/x.service.ts'],
  ])('đối chứng: %s bị bắt (kể cả viết thường và thư mục admin)', (src, file) => {
    expect(apiAt(file, src)).toEqual(['Bạn hoặc Tubu']);
  });

  it('đối chứng: câu đã đổi, comment và spec không bị bắt', () => {
    expect(apiAt('apps/api/src/common/x.ts', "export const m = 'Bạn thử lại nhé.';")).toEqual([]);
    expect(apiAt('apps/api/src/common/x.ts', '// Vui lòng thử lại (comment)\nexport const a = 1;')).toEqual([]);
    expect(apiAt('apps/api/src/common/x.spec.ts', "export const m = 'Vui lòng thử lại';")).toEqual([]);
  });

  it('chỉ luật "Bạn hoặc Tubu": thuật ngữ cấm khác ở file API thường không bị luật này bắt', () => {
    expect(apiAt('apps/api/src/modules/orders/x.service.ts', "export const m = 'Freeship cho đơn từ 299k';")).toEqual([]);
  });

  const sources = loadApiSources();
  const hits = findHits(sources, API_VOICE, API_SKIP);

  it('quét được cây API thật: đủ file, có cả admin/, không có spec', () => {
    expect(sources.length).toBeGreaterThan(300);
    expect(sources.some((s) => s.file === 'apps/api/src/modules/checkout/checkout.service.ts')).toBe(true);
    expect(sources.some((s) => s.file === 'apps/api/src/modules/admin/admin.service.ts')).toBe(true);
    expect(sources.some((s) => /\.spec\.ts$/.test(s.file))).toBe(false);
  });

  it('không file API nào còn "Vui lòng" hoặc "chúng tôi" ngoài danh sách miễn pháp lý', () => {
    const over = hits.filter((h) => {
      const e = API_VOICE_EXEMPT.find((x) => x.file === h.file);
      return !e || hits.filter((x) => x.file === h.file).length > e.max;
    });
    expect(over.map((h) => `${h.file}:${h.line} ${h.text.slice(0, 70)}`)).toEqual([]);
  });

  it('mỗi dòng miễn pháp lý có lý do, trỏ file có thật và max bằng đúng số chỗ hiện có', () => {
    const files = new Set(sources.map((s) => s.file));
    for (const e of API_VOICE_EXEMPT) {
      expect(e.reason.trim().length, `${e.file} thiếu lý do`).toBeGreaterThan(10);
      expect(files.has(e.file), `${e.file} không nằm trong cây quét`).toBe(true);
      expect(hits.filter((h) => h.file === e.file).length, `${e.file}: max phải bằng số chỗ hiện có`).toBe(e.max);
    }
  });
});

// Câu client lặp câu API: khách thấy một câu dù lỗi chặn ở màn hay do máy chủ từ chối, nên hai bên phải bằng nhau từng chữ.
// Giới hạn của tầng quét (2): chỉ bắt khi 6 chữ đầu giống và chỉ lấy câu từ file chữ khách đọc của API; câu lệch ngay từ đầu (vd "Ví đang âm" so "Số dư Ví Tubu đang âm") hoặc nằm ở orders.service/checkout-split phải ghim trực tiếp như Ví.
// Hai tầng: (1) ghim giá trị với câu API (file API thuần chữ, import thẳng); (2) quét: câu client mở đầu giống một câu của file chữ khách đọc của API
// (`isApiCopyFile`) mà phần còn lại khác thì đỏ, trừ khi nằm trong `CLIENT_API_DRIFT_OK` kèm lý do (client cố ý nói ngắn hơn hoặc nói thêm).
describe('câu client lặp câu API phải bằng câu API (gl-1103 chu)', () => {
  it('Ví âm: câu khoá nút trả bằng Ví của client bằng câu máy chủ từ chối lúc đặt', () => {
    for (const owed of ['1đ', '50.000đ', '1.250.000đ']) expect(walletNegativeCheckoutReason(owed)).toBe(walletNegativeMessage(owed));
  });

  it('Giờ vàng: câu vượt giới hạn của client bằng câu máy chủ, hai câu cũ client còn so khớp bằng đúng chữ của máy chủ', () => {
    for (const n of [1, 2, 10]) expect(fillCopy('flash.overLimitError', { n })).toBe(flashOverLimitMessage(n));
    expect(FLASH_SOLD_OUT_MESSAGE).toBe(FLASH_SOLD_OUT_MSG);
    expect(FLASH_OVER_LIMIT_MESSAGE).toBe(FLASH_OVER_LIMIT_MSG);
  });

  it('nhận tiền hoàn và lý do đổi/trả: câu lỗi form của client bằng câu máy chủ (order-actions, return sheet, hai app)', () => {
    expect(BANK_NAME_REQUIRED).toBe(REFUND_BANK_NAME_REQUIRED);
    expect(ACCOUNT_NUMBER_INVALID).toBe(REFUND_ACCOUNT_NUMBER_INVALID);
    expect(ACCOUNT_NAME_REQUIRED).toBe(REFUND_ACCOUNT_NAME_REQUIRED);
    expect(RETURN_REASON_REQUIRED).toBe(API_RETURN_REASON_REQUIRED);
  });

  it('lỗi sửa được ở giỏ: nhận câu cũ và câu mới của máy chủ, không nhận lỗi khác', () => {
    expect(isCartFixableError(FLASH_SOLD_OUT_MSG)).toBe(true);
    expect(isCartFixableError(FLASH_OVER_LIMIT_MSG)).toBe(true);
    expect(isCartFixableError('Sản phẩm "Dầu gội" không đủ tồn kho.')).toBe(true);
    expect(isCartFixableError(flashOverLimitMessage(2))).toBe(false);
    expect(isCartFixableError(WALLET_SHORT_MESSAGE)).toBe(false);
    expect(isCartFixableError('Địa chỉ giao hàng không hợp lệ.')).toBe(false);
  });

  it('mã chưa áp dụng: đầu câu của client bằng đầu câu của API khi giỏ không có hàng Giờ vàng hay combo', () => {
    const api = readFileSync(join(REPO, API_ROOT, 'coupons/coupon-notice.ts'), 'utf8');
    const m = /`(Mã chưa được áp dụng cho đơn này)\$\{why\}: \$\{reason\}`/.exec(api);
    expect(m, 'API đổi câu "Mã chưa được áp dụng": cập nhật couponNotAppliedNotice của client').not.toBeNull();
    expect(couponNotAppliedNotice('Đơn tối thiểu 150.000đ.')).toBe(`${m![1]}: Đơn tối thiểu 150.000đ.`);
  });

  const norm = (s: string) => s.replace(/\$\{[^}]*\}|\{[^}]*\}/g, '§').replace(/\s+/g, ' ').trim();
  const opening = (s: string) => s.split(' ').slice(0, 6).join(' ');
  // Câu tiếng Việt từ chuỗi trong mã (chuỗi thường, template, JSX): tách ở dấu chấm câu, bỏ câu ngắn (nhãn, tiêu đề) vì không đủ dài để coi là lặp lại.
  function sentencesOf(text: string, file: string): { sentence: string; line: number }[] {
    return displayStringsRaw(text, file).flatMap(({ text: t, line }) =>
      norm(t)
        .split(/(?<=[.!?])\s+/)
        .map((x) => x.trim())
        .filter((x) => x.split(' ').length >= 6 && VI_LETTER.test(x))
        .map((sentence) => ({ sentence, line })),
    );
  }
  // Chuỗi nguyên văn (template ghép cả đoạn, `${…}` thành §) để so cả câu có chỗ trống, không bị cắt ở biểu thức như `displayStrings`.
  function displayStringsRaw(source: string, fileName: string): { line: number; text: string }[] {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const out: { line: number; text: string }[] = [];
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const visit = (n: ts.Node) => {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push({ line: lineOf(n), text: n.text });
      else if (ts.isTemplateExpression(n)) out.push({ line: lineOf(n), text: n.head.text + n.templateSpans.map((sp) => '${}' + sp.literal.text).join('') });
      else if (ts.isJsxText(n) && n.text.trim() !== '') out.push({ line: lineOf(n), text: n.text });
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  /** Câu client cố ý khác câu API cùng mở đầu: `file` + `sentence` (đã chuẩn hoá) + lý do. */
  const CLIENT_API_DRIFT_OK: { file: string; sentence: string; reason: string }[] = [
    {
      file: 'packages/app-core/src/commerce/coupon-notice.ts',
      sentence: 'Mã chưa được áp dụng cho đơn này: §',
      reason: 'API chèn "(hàng Giờ vàng ... không được tính vào điều kiện của mã)" trước dấu hai chấm khi giỏ có hàng Giờ vàng hay combo; xem trước theo từng mã không có phần đó. Ca "mã chưa áp dụng" ở trên ghim phần đầu',
    },
  ];

  const all = loadSources();
  const apiSentences = all.filter((s) => s.file.startsWith('apps/api/')).flatMap((s) => sentencesOf(s.text, s.file).map((x) => x.sentence));
  const apiByOpening = new Map<string, Set<string>>();
  for (const sentence of apiSentences) (apiByOpening.get(opening(sentence)) ?? apiByOpening.set(opening(sentence), new Set()).get(opening(sentence))!).add(sentence);

  // Câu API mà client so khớp từng chữ nằm MỘT chỗ ở app-core (ghim ở trên); bản chép riêng trong Mini hoặc web sẽ lệch âm thầm khi API đổi chữ.
  it('câu lỗi Giờ vàng, Ví âm và nhận tiền hoàn của API không bị chép lại ngoài app-core (Mini và web)', () => {
    const literal = /^(?:Hết suất ưu đãi\.|Vượt giới hạn mua ưu đãi\.)$|do thu hồi hoa hồng đơn trả hàng|chỉ gồm chữ số, từ 6 đến 24 số|\(ít nhất 5 ký tự\) nhé/;
    const copied = all
      .filter((s) => !s.file.startsWith('apps/api/') && !s.file.startsWith('packages/app-core/'))
      .flatMap((s) => displayStringsRaw(s.text, s.file).filter((x) => literal.test(x.text.trim())).map((x) => `${s.file}:${x.line}`));
    expect(copied).toEqual([]);
    expect(displayStringsRaw("const m = 'Hết suất ưu đãi.';", 'apps/web/src/x.ts').some((x) => literal.test(x.text.trim()))).toBe(true);
  });

  it('quét được câu của file chữ khách đọc của API (không quét rỗng)', () => {
    expect(apiSentences.length).toBeGreaterThan(20);
    expect(apiSentences).toContain(norm(walletNegativeMessage('${x}')).split(/(?<=[.!?])\s+/)[0]!.replace('${x}', '§'));
  });

  it('câu client mở đầu giống câu API thì bằng câu API', () => {
    const drift: string[] = [];
    for (const s of all) {
      if (s.file.startsWith('apps/api/')) continue;
      for (const { sentence, line } of sentencesOf(s.text, s.file)) {
        const same = apiByOpening.get(opening(sentence));
        if (!same || same.has(sentence)) continue;
        if (CLIENT_API_DRIFT_OK.some((e) => e.file === s.file && e.sentence === sentence)) continue;
        drift.push(`${s.file}:${line}: "${sentence}" khác API: "${[...same][0]}"`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('mỗi ngoại lệ có lý do và còn đúng là câu có thật trong file', () => {
    for (const e of CLIENT_API_DRIFT_OK) {
      expect(e.reason.trim().length, `${e.file} thiếu lý do`).toBeGreaterThan(10);
      const src = all.find((s) => s.file === e.file);
      expect(src && sentencesOf(src.text, src.file).some((x) => x.sentence === e.sentence), `${e.file}: ngoại lệ không còn khớp câu nào`).toBe(true);
    }
  });

  it('đối chứng: câu mở đầu giống nhưng cuối khác bị bắt, câu bằng hoặc mở đầu khác thì không', () => {
    const api = new Set(sentencesOf("export const a = 'Số dư Ví Tubu không đủ để thanh toán đơn định kỳ này.';", 'x-notice.ts').map((x) => x.sentence));
    const same = (t: string) => sentencesOf(`export const b = '${t}';`, 'b.ts').filter((x) => api.has(x.sentence) || [...api].some((a) => opening(a) === opening(x.sentence) && a !== x.sentence)).map((x) => api.has(x.sentence));
    expect(same('Số dư Ví Tubu không đủ để thanh toán đơn định kỳ này.')).toEqual([true]);
    expect(same('Số dư Ví Tubu không đủ để thanh toán đơn đầu tiên, hãy nạp thêm.')).toEqual([false]);
    expect(same('Ví của bạn chưa đủ để thanh toán đơn định kỳ này nhé.')).toEqual([]);
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
