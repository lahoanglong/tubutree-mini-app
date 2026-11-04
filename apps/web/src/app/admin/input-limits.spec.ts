import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EXEMPT_INPUTS, INPUT_LIMITS } from './input-limits.table';

/**
 * L4-03: ô gõ chữ của màn quản trị phải chặn đúng ở trần của DTO (`@MaxLength`/`@Length`), nếu không người dùng gõ
 * quá trần rồi mới nhận lỗi 400. Spec duyệt mọi `<input>`/`<textarea>` kiểu chữ trong `app/admin` và `components/admin`:
 * ô có trong INPUT_LIMITS phải có `maxLength` bằng trần DTO (đọc thẳng từ mã nguồn API: `@MaxLength`, `@Length`, hoặc
 * độ dài tối đa của `@Matches`), hoặc thấp hơn kèm lý do `stricter`; ô khác phải nằm trong EXEMPT_INPUTS kèm lý do.
 * Ô có `maxLength` mà không có dòng nào cũng đỏ: không còn ô nào được bỏ qua âm thầm.
 */
const SRC = join(process.cwd(), 'src');
const REPO = resolve(process.cwd(), '../..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = [...walk(join(SRC, 'app/admin')), ...walk(join(SRC, 'components/admin'))]
  .filter((f) => f.endsWith('.tsx') && !/\.spec\./.test(f))
  .map((f) => ({ file: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));

const NON_TEXT = new Set(['number', 'checkbox', 'radio', 'file', 'date', 'datetime-local', 'time', 'month', 'hidden', 'range', 'color', 'password']);

function constValue(name: string, localText: string): number | null {
  const re = new RegExp(`(?:const|readonly)\\s+${name}\\s*=\\s*([\\d_]+)`);
  const local = localText.match(re);
  if (local) return Number(local[1]!.replace(/_/g, ''));
  for (const f of walk(join(SRC, 'lib'))) {
    if (!f.endsWith('.ts')) continue;
    const m = readFileSync(f, 'utf8').match(re);
    if (m) return Number(m[1]!.replace(/_/g, ''));
  }
  return null;
}

interface FoundInput {
  key: string;
  file: string;
  line: number;
  maxLength: number | 'dynamic' | null;
}

function discover(): FoundInput[] {
  const out: FoundInput[] = [];
  for (const { file, text } of files) {
    const seen = new Map<string, number>();
    for (const m of text.matchAll(/<(input|textarea)\b/g)) {
      let depth = 0;
      let j = m.index! + m[0].length;
      for (; j < text.length; j++) {
        const c = text[j];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (depth === 0 && c === '>') break;
      }
      const tag = text.slice(m.index!, j + 1);
      const type = tag.match(/type="(\w+)"/)?.[1] ?? 'text';
      if (NON_TEXT.has(type)) continue;
      const value = (tag.match(/value=\{((?:[^{}]|\{[^{}]*\})*)\}/)?.[1] ?? '?').replace(/\s+/g, ' ').trim();
      const base = `${file}::${value}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const ml = tag.match(/maxLength=(?:\{([^}]*)\}|"(\d+)")/);
      let maxLength: FoundInput['maxLength'] = null;
      if (ml) {
        const raw = (ml[1] ?? ml[2])!.trim();
        maxLength = /^\d+$/.test(raw) ? Number(raw) : /^[A-Z_]+$/.test(raw) ? constValue(raw, text) ?? 'dynamic' : 'dynamic';
      }
      out.push({ key: n === 1 ? base : `${base}#${n}`, file, line: text.slice(0, m.index!).split('\n').length, maxLength });
    }
  }
  return out;
}

/** Độ dài tối đa của một regex đơn giản (`^[A-Z0-9]{2,16}$`, `^0\d{8,10}$`): cộng lượng tử tối đa của từng phần tử. */
function regexMax(source: string): number | null {
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

/** Trần chuỗi của một trường DTO: `@MaxLength(n)`, `@Length(min, n)` hoặc `@Matches(regex)`; n có thể là hằng số cùng file. */
function dtoCap(spec: string): number | null {
  const [path, rest] = spec.split(':') as [string, string];
  const [cls, field] = rest.split('.') as [string, string];
  const source = readFileSync(resolve(REPO, path), 'utf8');
  const start = source.search(new RegExp(`class ${cls}\\b`));
  if (start < 0) throw new Error(`Không thấy class ${cls} trong ${path}`);
  const after = source.slice(start);
  const body = after.slice(after.indexOf('{') + 1, (after.search(/\n\}/) + 1) || undefined);
  const deco = '@\\w+\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*\\)\\s*';
  const hit = new RegExp(`((?:${deco})+)(?:readonly\\s+)?${field}[!?]?\\s*:`).exec(body);
  if (!hit) throw new Error(`Không thấy trường ${cls}.${field} trong ${path}`);
  const decos = hit[1]!;
  const arg = decos.match(/@MaxLength\(\s*([^,)]+)/)?.[1] ?? decos.match(/@Length\(\s*\d+\s*,\s*([^,)]+)/)?.[1];
  if (!arg) {
    const matches = decos.match(/@Matches\(\s*(\/(?:\\.|[^/\\])+\/|\w+)/)?.[1];
    if (!matches) return null;
    let literal = matches.startsWith('/') ? matches : null;
    if (!literal) {
      const re = new RegExp(`const\\s+${matches}\\s*=\\s*(\\/(?:\\\\.|[^/\\\\])+\\/)`);
      literal = source.match(re)?.[1] ?? apiSources().map((t) => t.match(re)?.[1]).find(Boolean) ?? null;
    }
    return literal ? regexMax(literal.slice(1, -1)) : null;
  }
  const v = arg.trim();
  if (/^[\d_]+$/.test(v)) return Number(v.replace(/_/g, ''));
  const re = new RegExp(`(?:const|readonly)\\s+${v}\\s*=\\s*([\\d_]+)`);
  const c = source.match(re) ?? apiSources().map((t) => t.match(re)).find(Boolean);
  return c ? Number(c[1]!.replace(/_/g, '')) : null;
}

let apiCache: string[] | null = null;
/** Hằng số trần có thể nằm ở file khác của API (vd DEALER_PRICE_CSV_MAX_LENGTH): quét một lần. */
function apiSources(): string[] {
  apiCache ??= walk(resolve(REPO, 'apps/api/src'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => readFileSync(f, 'utf8'));
  return apiCache;
}

const found = discover();

describe('ô gõ chữ ở màn quản trị khớp trần DTO (L4-03)', () => {
  it('mỗi ô gõ chữ có maxLength hoặc nằm trong danh sách miễn (kèm lý do)', () => {
    const offenders = found
      .filter((f) => f.maxLength === null && !(f.key in INPUT_LIMITS) && !(f.key in EXEMPT_INPUTS))
      .map((f) => `${f.file}:${f.line}  ${f.key}`);
    expect(offenders).toEqual([]);
  });

  it('ô đã khai trong bảng có maxLength đúng bằng trần DTO', () => {
    const wrong: string[] = [];
    for (const [key, { dto, max, stricter }] of Object.entries(INPUT_LIMITS)) {
      const input = found.find((f) => f.key === key);
      if (!input) continue;
      const cap = dtoCap(dto);
      const ok = stricter ? cap !== null && max < cap : cap === max;
      if (!ok) wrong.push(`${key}: bảng ghi ${max}${stricter ? ' (chặt hơn DTO)' : ''}, DTO ${dto} là ${cap}`);
      if (input.maxLength !== max) wrong.push(`${input.file}:${input.line} ${key}: maxLength ${input.maxLength} ≠ ${max}`);
    }
    expect(wrong).toEqual([]);
  });

  it('bảng không còn dòng của ô đã bị xoá hoặc đổi tên', () => {
    const keys = new Set(found.map((f) => f.key));
    expect([...Object.keys(INPUT_LIMITS), ...Object.keys(EXEMPT_INPUTS)].filter((k) => !keys.has(k))).toEqual([]);
  });

  it('ô đã có maxLength đều có dòng trong bảng (đối chiếu DTO) hoặc dòng miễn', () => {
    const unchecked = found.filter((f) => f.maxLength !== null && !(f.key in INPUT_LIMITS) && !(f.key in EXEMPT_INPUTS));
    expect(unchecked.map((f) => `${f.file}:${f.line}  ${f.key}  maxLength=${f.maxLength}`)).toEqual([]);
  });

  it('dòng `stricter` ghi rõ lý do', () => {
    expect(Object.entries(INPUT_LIMITS).filter(([, v]) => v.stricter !== undefined && v.stricter.trim().length < 8)).toEqual([]);
  });

  it('maxLength là con số hoặc hằng số đọc được, trừ ô được khai rõ trong bảng', () => {
    expect(
      found.filter((f) => f.maxLength === 'dynamic' && !(f.key in INPUT_LIMITS) && !(f.key in EXEMPT_INPUTS)).map((f) => `${f.file}:${f.line} ${f.key}`),
    ).toEqual([]);
  });

  it('ô SĐT của form Cấp / đổi vai trò nhận số dán dạng "+84 912 345 678" mà không bị cắt', () => {
    const phone = found.find((f) => f.key === 'app/admin/page.tsx::phone');
    expect(typeof phone?.maxLength === 'number' && phone.maxLength >= '+84 912 345 678'.length).toBe(true);
  });

  it('mọi dòng miễn có lý do', () => {
    expect(Object.entries(EXEMPT_INPUTS).filter(([, reason]) => reason.trim().length < 8)).toEqual([]);
  });
});

export { discover, dtoCap };
