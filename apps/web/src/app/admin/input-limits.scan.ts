/**
 * Quét mã nguồn API tìm chỗ service/rules chặn độ dài một trường chữ thấp hơn trần DTO (L4-03, L5-01..L5-03, L6-02..L6-04).
 * Chỉ bắt các dạng đọc được bằng regex. Giới hạn còn lại, không làm chắc được: biến trung gian (`const d = x.trim(); d.length > N`),
 * hàm kiểm không nhận trường làm đối số trực tiếp (vd `const v = dto.field; check(v)`), regex tạo bằng `new RegExp(...)` hay hằng ở file khác,
 * regex chỉ dùng để phân loại (không có `!` trước `.test(`, vd nhận dạng chuỗi giống SĐT trong ô tìm) không tính là trần, hàm/method trùng tên ở nhiều file (lấy mọi bản), và trần đặt ở lớp khác (controller, pipe) không bị quét.
 */

export interface FieldCap {
  file: string;
  limit: number;
  kind: 'length' | 'slice' | 'regex';
}

export interface SourceFile {
  name: string;
  text: string;
}

const NUM = '[\\d_]+';
const toNumber = (raw: string) => Number(raw.replace(/_/g, ''));

/** Hằng số: tìm ở chính file trước, rồi lần lượt ở các nguồn khác; hằng là bí danh của hằng khác (`const A = B;`) thì đọc theo (tối đa 5 bước); bí danh không ra số thì xét tiếp nguồn sau. Không bao giờ lấy từ mã web. */
export function apiConstValue(name: string, sources: string[], depth = 0): number | null {
  if (depth > 5) return null;
  const num = new RegExp(`(?:const|readonly)\\s+${name}\\s*=\\s*(${NUM})\\b`);
  const alias = new RegExp(`(?:const|readonly)\\s+${name}\\s*=\\s*([A-Z][A-Z0-9_]*)\\s*;`);
  for (const text of sources) {
    const m = text.match(num);
    if (m) return toNumber(m[1]!);
    const a = text.match(alias);
    if (a && a[1] !== name) {
      const resolved = apiConstValue(a[1]!, sources, depth + 1);
      if (resolved !== null) return resolved;
    }
  }
  return null;
}

/** Độ dài tối đa của một regex đơn giản (`^[A-Z0-9]{2,16}$`, `^0\d{8,10}$`): cộng lượng tử tối đa của từng phần tử. */
export function regexMax(source: string): number | null {
  const body = source.replace(/^\^/, '').replace(/\$$/, '');
  const atom = /(\\[dwsDWS]|\[(?:\\.|[^\]])+\]|[^{}?*+()|\\])(?:\{(\d+)(?:,(\d+))?\})?/g;
  let total = 0;
  let consumed = 0;
  for (const m of body.matchAll(atom)) {
    if (m.index !== consumed) return null;
    consumed += m[0].length;
    total += m[3] ? Number(m[3]) : m[2] ? Number(m[2]) : 1;
  }
  return consumed === body.length ? total : null;
}

/** `lookup(tên, văn bản file)` trả giá trị hằng số hoặc null. */
export type ConstLookup = (name: string, localText: string) => number | null;

/** Cắt chỉ để hiển thị (đoạn trích thông báo, xem trước), không phải trần của dữ liệu lưu: chỉ khi khoá/biến nhận giá trị ngay trước biểu thức cắt có tên như vậy. */
const DISPLAY_TARGET = /\b(?:excerpt|preview|snippet|summary)\w*\s*[:=]\s*[^;,{}]*$/i;
const TRIM = '(?:\\??\\.trim\\(\\))?';

/** Chuỗi bên trong cặp ngoặc bắt đầu tại `open` (vị trí của ký tự mở), cân ngoặc cùng loại; null nếu không đóng. */
function balanced(text: string, open: number, o: string, c: string): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === o) depth++;
    else if (text[i] === c && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

/** Thân của `function name(...) {` hoặc method `name(...) {` (có thể có private/async/kiểu trả về). */
function functionBodies(text: string, name: string): Array<{ params: string[]; body: string }> {
  const out: Array<{ params: string[]; body: string }> = [];
  const def = new RegExp(`(?:function\\s+${name}|(?:^|[\\s;{}])${name})\\s*(?:<[^>]*>)?\\(`, 'g');
  for (const m of text.matchAll(def)) {
    const paren = m.index! + m[0].length - 1;
    const params = balanced(text, paren, '(', ')');
    if (params === null) continue;
    const after = text.slice(paren + params.length + 2);
    const brace = after.match(/^\s*(?::[^{;=]+)?\{/);
    if (!brace) continue;
    const body = balanced(text, paren + params.length + 2 + brace[0].length - 1, '{', '}');
    if (body !== null) out.push({ params: params.split(',').map((p) => p.trim().replace(/^(?:readonly\s+)?(\w+)[?!]?\s*(?::.*)?(?:=.*)?$/s, '$1')).filter((p) => /^\w+$/.test(p)), body });
  }
  return out;
}

/** Biểu thức chỉ là tham số hoặc tham số cắt khoảng trắng (`raw`, `raw.trim()`, `const v = typeof raw === 'string' ? raw.trim() : ''`), không qua biến đổi khác. */
function isParamValue(ident: string, body: string, params: string[]): boolean {
  if (params.includes(ident)) return true;
  const def = body.match(new RegExp(`\\b(?:const|let)\\s+${ident}\\s*=\\s*([^;]+);`))?.[1]?.trim();
  if (!def) return false;
  return params.some((p) => new RegExp(`^(?:typeof\\s+${p}\\s*===?\\s*'string'\\s*\\?\\s*)?${p}(?:\\??\\.trim\\(\\))?(?:\\s*:\\s*''|\\s*\\?\\?\\s*'')?$`).test(def));
}

/** Mọi regex neo `^…$` dùng làm cổng `!RE.test(x)` (phủ định: không khớp thì từ chối) trong thân hàm, với x chính là tham số (hoặc tham số đã trim). */
function testedRegexMaxes(fn: { params: string[]; body: string }, text: string): number[] {
  const out: number[] = [];
  const gate = (re: string, resolveLiteral: (m: RegExpMatchArray) => string | undefined) => {
    for (const t of fn.body.matchAll(new RegExp(`!\\s*${re}\\.test\\(\\s*(\\w+)(?:\\??\\.trim\\(\\))?\\s*\\)`, 'g'))) {
      const lit = resolveLiteral(t);
      const max = lit ? regexMax(lit.slice(1, -1)) : null;
      if (max !== null && isParamValue(t[2]!, fn.body, fn.params)) out.push(max);
    }
  };
  gate('([A-Z][A-Z0-9_]*)', (t) => text.match(new RegExp(`const\\s+${t[1]}\\s*=\\s*(\\/(?:\\\\.|[^/\\\\])+\\/)`))?.[1]);
  gate('(\\/\\^(?:\\\\.|[^/\\\\\\n])+\\$\\/)', (t) => t[1]);
  return out;
}

export function findFieldCaps(files: SourceFile[], field: string, lookup: ConstLookup): FieldCap[] {
  const out: FieldCap[] = [];
  const num = (raw: string, text: string) => (/^[\d_]+$/.test(raw) ? toNumber(raw) : lookup(raw, text));

  for (const { name, text } of files) {
    for (const m of text.matchAll(new RegExp(`\\b${field}${TRIM}\\.length\\s*(>=?)\\s*([A-Z][A-Z0-9_]*|${NUM})`, 'g'))) {
      const n = num(m[2]!, text);
      if (n === null) continue;
      const limit = m[1] === '>=' ? n - 1 : n;
      if (limit > 0) out.push({ file: name, limit, kind: 'length' });
    }
    for (const m of text.matchAll(new RegExp(`\\b${field}${TRIM}\\.(?:slice|substring)\\(\\s*0\\s*,\\s*([A-Z][A-Z0-9_]*|${NUM})\\s*\\)`, 'g'))) {
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      if (DISPLAY_TARGET.test(text.slice(lineStart, m.index))) continue;
      const n = num(m[1]!, text);
      if (n !== null) out.push({ file: name, limit: n, kind: 'slice' });
    }
    // Regex neo viết thẳng làm cổng `!/^…$/.test(` và thử ngay trên thuộc tính của trường: !/^…$/.test(dto.field) (biến trần tên trùng, như `phone` đã chuẩn hoá, không tính).
    for (const m of text.matchAll(/!\s*(\/\^(?:\\.|[^/\\\n])+\$\/)\.test\(/g)) {
      const args = balanced(text, m.index! + m[0].length - 1, '(', ')');
      const max = args !== null && new RegExp(`^\\s*\\w+\\??\\.${field}${TRIM}\\s*$`).test(args) ? regexMax(m[1]!.slice(1, -1)) : null;
      if (max !== null) out.push({ file: name, limit: max, kind: 'regex' });
    }
  }

  // Hàm hay method được gọi với giá trị của trường (`norm(t, dto.field?.trim())`, `this.norm(dto.field)`) và kiểm bằng regex neo ^…$ trong thân.
  const called = new Set<string>();
  for (const { text } of files) {
    for (const m of text.matchAll(/\b([A-Za-z_]\w*)\(/g)) {
      const args = balanced(text, m.index! + m[0].length - 1, '(', ')');
      if (args !== null && new RegExp(`\\b${field}\\b`).test(args)) called.add(m[1]!);
    }
  }
  for (const fn of called) {
    for (const { name, text } of files) {
      for (const f of functionBodies(text, fn)) {
        for (const max of testedRegexMaxes(f, text)) out.push({ file: name, limit: max, kind: 'regex' });
      }
    }
  }
  return out;
}
