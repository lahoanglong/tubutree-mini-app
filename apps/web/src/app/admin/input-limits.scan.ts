/**
 * Quét mã nguồn API tìm chỗ service/rules chặn độ dài một trường chữ thấp hơn trần DTO (L4-03, L5-01..L5-03).
 * Chỉ bắt các dạng đọc được bằng regex; giới hạn còn lại: biến trung gian (`const d = x.trim(); d.length > N`),
 * độ dài kiểm qua hàm tự viết không nhận trường làm đối số trực tiếp, và trần đặt ở lớp khác (controller, pipe) không bị quét.
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

/** Hằng số của API: tìm ở chính file trước, rồi lần lượt ở các nguồn API khác. Không bao giờ lấy từ mã web. */
export function apiConstValue(name: string, sources: string[]): number | null {
  const re = new RegExp(`(?:const|readonly)\\s+${name}\\s*=\\s*(${NUM})\\b`);
  for (const text of sources) {
    const m = text.match(re);
    if (m) return toNumber(m[1]!);
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

/** Cắt chỉ để hiển thị (đoạn trích thông báo, xem trước), không phải trần của dữ liệu lưu. */
const DISPLAY_ONLY = /\b(?:excerpt|preview|snippet|summary)\b/i;
const TRIM = '(?:\\??\\.trim\\(\\))?';

function functionBody(text: string, name: string): string | null {
  const start = text.search(new RegExp(`function\\s+${name}\\b`));
  if (start < 0) return null;
  const rest = text.slice(start);
  const end = rest.search(/\n\}/);
  return end < 0 ? rest : rest.slice(0, end);
}

export function findFieldCaps(files: SourceFile[], field: string, lookup: ConstLookup): FieldCap[] {
  const out: FieldCap[] = [];
  const num = (raw: string, text: string) => (/^[\d_]+$/.test(raw) ? toNumber(raw) : lookup(raw, text));

  for (const { name, text } of files) {
    for (const m of text.matchAll(new RegExp(`\\b${field}${TRIM}\\.length\\s*(>=?)\\s*([A-Z][A-Z0-9_]*|${NUM})`, 'g'))) {
      const n = num(m[2]!, text);
      if (n !== null) out.push({ file: name, limit: m[1] === '>=' ? n - 1 : n, kind: 'length' });
    }
    for (const m of text.matchAll(new RegExp(`\\b${field}${TRIM}\\.(?:slice|substring)\\(\\s*0\\s*,\\s*([A-Z][A-Z0-9_]*|${NUM})\\s*\\)`, 'g'))) {
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      if (DISPLAY_ONLY.test(text.slice(lineStart, text.indexOf('\n', m.index)))) continue;
      const n = num(m[1]!, text);
      if (n !== null) out.push({ file: name, limit: n, kind: 'slice' });
    }
  }

  // Hàm được gọi với giá trị của trường (`normalizeLink(type, dto.field)`) và kiểm bằng một regex neo ^…$ (`RE.test(value)`).
  const callee = new RegExp(`\\b([A-Za-z_]\\w*)\\(([^()]*\\b${field}\\b[^()]*)\\)`, 'g');
  const called = new Set<string>();
  for (const { text } of files) for (const m of text.matchAll(callee)) called.add(m[1]!);
  for (const fn of called) {
    for (const { name, text } of files) {
      const body = functionBody(text, fn);
      if (!body) continue;
      for (const t of body.matchAll(/\b([A-Z][A-Z0-9_]*)\.test\(/g)) {
        const lit = text.match(new RegExp(`const\\s+${t[1]}\\s*=\\s*(\\/(?:\\\\.|[^/\\\\])+\\/)`))?.[1];
        const max = lit ? regexMax(lit.slice(1, -1)) : null;
        if (max !== null) out.push({ file: name, limit: max, kind: 'regex' });
      }
    }
  }
  return out;
}
