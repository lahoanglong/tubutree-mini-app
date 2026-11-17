/**
 * Lọc `description_html` của MSS lúc ghi (lớp thứ nhất; lớp thứ hai là `parseRichText` của app-core lúc hiển thị, hai app không bao giờ
 * đưa chuỗi này vào `innerHTML`). Đọc theo danh sách thẻ cho phép rồi viết lại HTML mới: không thuộc tính nào sống sót (nên không còn
 * `on*`, `style`, `href="javascript:"`), thẻ `script`/`style`/`iframe`… bị bỏ cả nội dung, thẻ lạ bỏ thẻ giữ chữ, chữ được thoát lại.
 * `a` và `img` hợp đồng cho phép nhưng Tubu không vẽ (parseRichText bỏ), nên ở đây bỏ thẻ giữ chữ của `a`, bỏ hẳn `img`.
 */

const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'textarea',
  'select', 'button', 'form', 'video', 'audio', 'canvas', 'applet', 'xml', 'noembed', 'noframes', 'plaintext', 'xmp',
]);

/** Thẻ đầu vào → thẻ đầu ra. Ngoài bảng này là thẻ lạ: bỏ thẻ, giữ chữ. */
const RENAME: Record<string, string> = {
  p: 'p',
  div: 'p',
  section: 'p',
  article: 'p',
  br: 'br',
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  h1: 'h2',
  h2: 'h2',
  h3: 'h3',
  h4: 'h3',
  h5: 'h3',
  h6: 'h3',
  blockquote: 'blockquote',
  figure: 'figure',
  figcaption: 'figcaption',
};

const VOID_OUT = new Set(['br']);
const TAG_RE = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)\s*>/y;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', deg: '°', times: '×' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (m, body: string) => {
    if (body[0] !== '#') return NAMED[body] ?? m;
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code < 0x20 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return '';
    return String.fromCodePoint(code);
  });
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Ký tự điều khiển (trừ xuống dòng, tab) không phải chữ. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * HTML an toàn từ `description_html`, dài tối đa `maxLength` ký tự (cắt ở ranh giới chữ, thẻ đang mở được đóng). Rỗng sau khi lọc thì
 * trả chuỗi rỗng: người gọi quyết định rỗng là "cố ý để trống" hay "không có ý kiến".
 */
export function sanitizeMssHtml(input: string, maxLength: number): string {
  const src = input
    .replace(CONTROL_RE, '')
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/g, '')
    .replace(/<![^>]*>/g, '')
    .replace(/<\?[\s\S]*?(\?>|$)/g, '');
  const out: string[] = [];
  const open: string[] = [];
  let length = 0;
  let full = false;
  let dropUntil: string | null = null;

  /** Chỗ cho thẻ đóng của mọi thẻ đang mở: phần cắt không được làm HTML vượt trần. */
  const reserve = () => open.reduce((n, t) => n + t.length + 3, 0);
  const emit = (s: string) => {
    if (full) return;
    if (length + s.length + reserve() > maxLength) {
      full = true;
      return;
    }
    out.push(s);
    length += s.length;
  };
  const emitText = (raw: string) => {
    if (full) return;
    const text = escapeText(decodeEntities(raw).replace(CONTROL_RE, ''));
    const room = maxLength - length - reserve();
    if (text.length <= room) {
      emit(text);
      return;
    }
    // Cắt trước một thực thể `&…;` đang dở để không để lại nửa thực thể.
    let cut = text.slice(0, Math.max(0, room));
    const amp = cut.lastIndexOf('&');
    if (amp >= 0 && !cut.slice(amp).includes(';')) cut = cut.slice(0, amp);
    out.push(cut);
    length += cut.length;
    full = true;
  };

  let i = 0;
  while (i < src.length && !full) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? src.length : lt;
    if (textEnd > i) {
      if (!dropUntil) emitText(src.slice(i, textEnd));
      i = textEnd;
      continue;
    }
    TAG_RE.lastIndex = lt;
    const m = TAG_RE.exec(src);
    if (!m) {
      if (!dropUntil) emitText('<');
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
    const tag = RENAME[name];
    if (!tag) continue;
    if (VOID_OUT.has(tag)) {
      if (!closing) emit(`<${tag}>`);
      continue;
    }
    if (!closing) {
      if (m[3] === '/') continue;
      const before = out.length;
      emit(`<${tag}>`);
      if (out.length > before) open.push(tag);
      continue;
    }
    const at = open.lastIndexOf(tag);
    if (at < 0) continue;
    while (open.length > at) out.push(`</${open.pop()}>`);
  }
  while (open.length) out.push(`</${open.pop()}>`);
  // Thẻ rỗng (`<p></p>`, `<strong> </strong>`) không mang gì: bỏ cho tới khi không còn.
  let html = out.join('');
  for (let prev = ''; prev !== html; ) {
    prev = html;
    html = html.replace(/<(p|strong|em|ul|ol|li|h2|h3|blockquote|figure|figcaption)>\s*<\/\1>/g, '');
  }
  return html.trim();
}
