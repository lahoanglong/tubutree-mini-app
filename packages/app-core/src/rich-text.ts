/**
 * Mô tả sản phẩm từ Pancake/WordPress có thể là HTML (`<p>`, `<ul>`, `<strong>`…). Hai app không bao giờ đưa chuỗi đó vào DOM bằng
 * `innerHTML`: hàm ở đây đọc HTML theo danh sách thẻ cho phép và trả về các khối dữ liệu (đoạn, tiêu đề, danh sách) mà React vẽ như chữ.
 * Mọi thuộc tính bị bỏ (nên không còn `on*`, `href="javascript:"`, `style`), nội dung của `script`/`style`/`iframe`… bị bỏ cả khối, thẻ lạ
 * thì bỏ thẻ giữ chữ. Chuỗi không có thẻ thì giữ nguyên xuống dòng như trước (đoạn tách theo dòng trống).
 */

export interface RichInline {
  text: string;
  bold?: true;
  italic?: true;
}

export type RichBlock =
  | { kind: 'p'; inlines: RichInline[] }
  | { kind: 'h'; inlines: RichInline[] }
  | { kind: 'ul' | 'ol'; items: RichInline[][] };

/** Bỏ cả thẻ lẫn nội dung bên trong. */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'textarea', 'select', 'button', 'form']);
const BLOCK_P = new Set(['p', 'div', 'section', 'article', 'blockquote', 'pre', 'figure', 'figcaption', 'table', 'tr', 'header', 'footer', 'main', 'aside', 'dl', 'dd', 'dt']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BOLD = new Set(['strong', 'b']);
const ITALIC = new Set(['em', 'i']);

// Giá trị thuộc tính trong ngoặc có thể chứa `>`: đọc trọn cặp ngoặc để phần đuôi của thuộc tính không rơi ra thành chữ.
const TAG_RE = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)\s*>/y;
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', deg: '°', times: '×', copy: '©', reg: '®', trade: '™' };

/** true khi chuỗi có thẻ HTML thật (không tính dấu `<` đứng một mình như "< 5 tuổi"). */
export function hasHtmlTags(input: string | null | undefined): boolean {
  return !!input && /<\s*\/?\s*[a-zA-Z][a-zA-Z0-9-]*\b[^>]*>/.test(input);
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Ký tự điều khiển và nửa cặp surrogate không phải chữ: bỏ, không làm hỏng chuỗi.
      if (!Number.isFinite(code) || code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

function pushText(target: RichInline[], text: string, bold: number, italic: number) {
  if (!text) return;
  const last = target[target.length - 1];
  const sameStyle = last && !!last.bold === bold > 0 && !!last.italic === italic > 0;
  if (sameStyle) {
    last.text += text;
    return;
  }
  target.push({ text, ...(bold > 0 ? { bold: true as const } : null), ...(italic > 0 ? { italic: true as const } : null) });
}

/** Gộp khoảng trắng như trình duyệt (trừ xuống dòng của `<br>` đã ghi là '\n'), cắt đầu/cuối khối; khối rỗng trả []. */
function tidy(inlines: RichInline[]): RichInline[] {
  const out: RichInline[] = [];
  for (const it of inlines) {
    const text = it.text.replace(/[ \t\r\f\v ]*\n[ \t\r\f\v ]*/g, '\n').replace(/[ \t\r\f\v]+/g, ' ');
    if (text) out.push({ ...it, text });
  }
  while (out.length > 0) {
    const first = out[0]!;
    first.text = first.text.replace(/^[\s]+/, '');
    if (first.text) break;
    out.shift();
  }
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    last.text = last.text.replace(/[\s]+$/, '');
    if (last.text) break;
    out.pop();
  }
  return out;
}

function plainBlocks(input: string): RichBlock[] {
  return input
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((para) => para.replace(/^\s+|\s+$/g, ''))
    .filter((para) => para.length > 0)
    .map((text) => ({ kind: 'p' as const, inlines: [{ text }] }));
}

/** Đọc mô tả (HTML hoặc chữ thường) thành các khối an toàn để vẽ. */
export function parseRichText(input: string | null | undefined): RichBlock[] {
  if (!input) return [];
  if (!hasHtmlTags(input)) return plainBlocks(decodeEntities(input));

  const src = input.replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/g, '').replace(/<![^>]*>/g, '').replace(/<\?[\s\S]*?(\?>|$)/g, '');
  const blocks: RichBlock[] = [];
  let current: RichInline[] = [];
  let currentKind: 'p' | 'h' = 'p';
  let list: { kind: 'ul' | 'ol'; items: RichInline[][] } | null = null;
  let listDepth = 0;
  let item: RichInline[] | null = null;
  let bold = 0;
  let italic = 0;
  let dropUntil: string | null = null;

  const target = () => item ?? current;
  const flushPara = () => {
    const inlines = tidy(current);
    if (inlines.length > 0) blocks.push({ kind: currentKind, inlines });
    current = [];
    currentKind = 'p';
  };
  const flushItem = () => {
    if (!item || !list) return;
    const inlines = tidy(item);
    if (inlines.length > 0) list.items.push(inlines);
    item = null;
  };
  const flushList = () => {
    flushItem();
    if (list && list.items.length > 0) blocks.push(list);
    list = null;
    listDepth = 0;
  };

  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? src.length : lt;
    if (textEnd > i) {
      if (!dropUntil) pushText(target(), decodeEntities(src.slice(i, textEnd)).replace(/\n/g, ' '), bold, italic);
      i = textEnd;
      continue;
    }
    TAG_RE.lastIndex = lt;
    const m = TAG_RE.exec(src);
    if (!m) {
      // `<` không mở thẻ (vd "< 5 tuổi"): giữ như chữ.
      if (!dropUntil) pushText(target(), '<', bold, italic);
      i = lt + 1;
      continue;
    }
    i = TAG_RE.lastIndex;
    const closing = m[1] === '/';
    const name = m[2]!.toLowerCase();
    if (dropUntil) {
      if (closing && name === dropUntil) dropUntil = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && m[3] !== '/') dropUntil = name;
      continue;
    }
    if (name === 'br') {
      pushText(target(), '\n', 0, 0);
      continue;
    }
    if (BOLD.has(name)) {
      bold = Math.max(0, bold + (closing ? -1 : 1));
      continue;
    }
    if (ITALIC.has(name)) {
      italic = Math.max(0, italic + (closing ? -1 : 1));
      continue;
    }
    if (name === 'ul' || name === 'ol') {
      if (!closing) {
        if (list) {
          // Danh sách lồng: gộp vào danh sách ngoài, mỗi mục con thành một mục.
          flushItem();
          listDepth += 1;
        } else {
          flushPara();
          list = { kind: name, items: [] };
          listDepth = 1;
        }
      } else if (list) {
        flushItem();
        listDepth -= 1;
        if (listDepth <= 0) flushList();
      }
      continue;
    }
    if (name === 'li') {
      if (!list) {
        flushPara();
        list = { kind: 'ul', items: [] };
        listDepth = 1;
      }
      flushItem();
      if (!closing) item = [];
      continue;
    }
    if (HEADINGS.has(name) || BLOCK_P.has(name) || name === 'hr') {
      if (item) {
        // Đoạn bên trong một mục danh sách: xuống dòng trong mục.
        if (target().length > 0) pushText(target(), '\n', 0, 0);
        continue;
      }
      if (list) flushList();
      flushPara();
      if (!closing && HEADINGS.has(name)) currentKind = 'h';
      continue;
    }
    // Thẻ khác (span, a, font, img…): bỏ thẻ, giữ chữ; thuộc tính không bao giờ được đọc.
  }
  if (list) flushList();
  flushPara();
  return blocks;
}

/** Chữ thường của các khối (đếm độ dài để thu gọn, tóm tắt cho trình đọc màn hình). */
export function richTextPlain(blocks: readonly RichBlock[]): string {
  return blocks
    .map((b) => ('items' in b ? b.items.map((it) => it.map((x) => x.text).join('')).join('\n') : b.inlines.map((x) => x.text).join('')))
    .join('\n\n');
}
