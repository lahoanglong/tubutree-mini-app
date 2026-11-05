import { describe, expect, it } from 'vitest';
import { apiConstValue, findFieldCaps, regexMax } from './input-limits.scan';

const lookup = (consts: Record<string, string> = {}) => (name: string, local: string) => apiConstValue(name, [local, ...Object.entries(consts).map(([k, v]) => `const ${k} = ${v};`)]);
const caps = (text: string, field = 'description', consts: Record<string, string> = {}) =>
  findFieldCaps([{ name: 'x.service.ts', text }], field, lookup(consts)).map((c) => c.limit);

describe('findFieldCaps: dạng service chặn độ dài thấp hơn DTO', () => {
  it('`.length > N` và `.length > CONST`', () => {
    expect(caps('if (description.length > 5000) throw 1;')).toEqual([5000]);
    expect(caps('const DESC_MAX = 5000;\nif (description.length > DESC_MAX) throw 1;')).toEqual([5000]);
  });
  it('`>=` chặn từ N nên trần thực là N - 1', () => {
    expect(caps('if (description.length >= 5000) throw 1;')).toEqual([4999]);
  });
  it('qua .trim() và qua đường dẫn patch.description.trim().length', () => {
    expect(caps('if (patch.description.trim().length > 5000) throw 1;')).toEqual([5000]);
    expect(caps('if (dto.description?.trim().length > 5000) throw 1;')).toEqual([5000]);
  });
  it('cắt im lặng bằng .slice(0, N) hoặc .substring(0, N)', () => {
    expect(caps('const d = description.trim().slice(0, 5000);')).toEqual([5000]);
    expect(caps('const d = patch.description.substring(0, 300);')).toEqual([300]);
  });
  it('cắt để hiển thị (excerpt, preview, snippet, summary) không phải trần của dữ liệu lưu', () => {
    expect(caps('const x = { excerpt: description.slice(0, 200), y: 1 };')).toEqual([]);
    expect(caps('const preview = description.slice(0, 200);')).toEqual([]);
  });
  it('cắt để hiển thị chỉ bỏ qua khi khoá hoặc biến nhận giá trị là excerpt/preview/snippet/summary; comment nhắc summary không làm bỏ qua', () => {
    expect(caps('data.x = description.slice(0, 5000); // summary')).toEqual([5000]);
    expect(caps('const summary = other; data.x = description.slice(0, 5000);')).toEqual([5000]);
    expect(caps('const x = { excerpt: p.description.slice(0, 200), y: 1 };')).toEqual([]);
    expect(caps('const preview = description.trim().slice(0, 200);')).toEqual([]);
  });
  it('`.length > 0` và `.length >= 1` là kiểm rỗng, không phải trần', () => {
    expect(caps('if (description.length > 0 && description.length >= 1) ok();')).toEqual([]);
    expect(caps('if (description.length > 0 || description.length > 5000) ok();')).toEqual([5000]);
  });
  it('hằng có dấu gạch dưới 10_000 đọc đúng 10000', () => {
    expect(caps('const BIG = 10_000;\nif (description.length > BIG) throw 1;')).toEqual([10000]);
    expect(apiConstValue('BIG', ['const BIG = 10_000;'])).toBe(10000);
  });
  it('hằng cùng tên ở nơi khác không ảnh hưởng: local thắng, không có thì lấy nguồn API đầu tiên, không có thì null', () => {
    expect(apiConstValue('X', ['const X = 7;', 'const X = 9;'])).toBe(7);
    expect(apiConstValue('X', ['', 'const X = 9;'])).toBe(9);
    expect(apiConstValue('X', ['', ''])).toBeNull();
  });
  it('không bắt trường khác tên', () => {
    expect(caps('if (shortDescription.length > 5 || mydescription.length > 5) throw 1;')).toEqual([]);
  });
  it('biến trung gian `const d = ...; d.length > N` là giới hạn đã biết, không bắt', () => {
    expect(caps('const d = description.trim();\nif (d.length > 5000) throw 1;')).toEqual([]);
  });
});

describe('findFieldCaps: regex neo ^…$ gọi bằng giá trị của trường', () => {
  const rules = `const ENTITY_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
export function normalizeLink(type: string, raw: string) {
  const value = raw.trim();
  if (!ENTITY_SLUG_RE.test(value)) throw new Error('x');
  return value;
}`;
  const service = 'const linkValue = normalizeLink(linkType, dto.linkValue);';
  it('bắt regex {0,119} của normalizeLink (trần 120) khi service gọi normalizeLink(…, dto.linkValue)', () => {
    const found = findFieldCaps([{ name: 'campaign-admin-rules.ts', text: rules }, { name: 'campaigns-admin.service.ts', text: service }], 'linkValue', lookup());
    expect(found.map((c) => c.limit)).toEqual([120]);
  });
  it('regex nâng lên {0,199} (trần 200) thì không thấp hơn DTO 200', () => {
    const found = findFieldCaps([{ name: 'campaign-admin-rules.ts', text: rules.replace('119', '199') }, { name: 'campaigns-admin.service.ts', text: service }], 'linkValue', lookup());
    expect(found.map((c) => c.limit)).toEqual([200]);
  });
  it('gọi có ngoặc lồng: norm(t, dto.linkValue?.trim())', () => {
    const found = findFieldCaps([{ name: 'r.ts', text: rules }, { name: 's.ts', text: 'const v = normalizeLink(linkType, dto.linkValue?.trim());' }], 'linkValue', lookup());
    expect(found.map((c) => c.limit)).toEqual([120]);
  });
  it('method của class gọi qua this.norm(dto.linkValue)', () => {
    const cls = `const SLUG_RE = /^[a-z]{1,50}$/;
export class S {
  private norm(raw: string): string {
    if (!SLUG_RE.test(raw)) throw new Error('x');
    return raw;
  }
  run(dto: { linkValue: string }) {
    return this.norm(dto.linkValue);
  }
}`;
    expect(findFieldCaps([{ name: 'svc.ts', text: cls }], 'linkValue', lookup()).map((c) => c.limit)).toEqual([50]);
  });
  it('regex viết thẳng /^…$/.test(value) trong hàm được gọi, và /^…$/.test(dto.field) ngay tại chỗ', () => {
    const inline = `export function norm(raw: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(raw)) throw new Error('x');
  return raw;
}`;
    expect(findFieldCaps([{ name: 'r.ts', text: inline }, { name: 's.ts', text: 'norm(dto.linkValue);' }], 'linkValue', lookup()).map((c) => c.limit)).toEqual([80]);
    expect(findFieldCaps([{ name: 's.ts', text: "if (!/^[a-z]{1,30}$/.test(dto.linkValue)) throw new Error('x');" }], 'linkValue', lookup()).map((c) => c.limit)).toEqual([30]);
  });
  it('regex chỉ để phân loại (không phủ định) hoặc thử trên biến đã biến đổi không tính là trần', () => {
    const classify = `export function assertSearch(q: { search?: string }) {
  const s = q.search?.trim() ?? '';
  const phone = searchPhone(s);
  if (!phone || !/^0\\d{9}$/.test(phone)) throw new Error('x');
  if (/^[a-z]{1,5}$/.test(s)) return;
}`;
    const call = 'assertSearch({ search: dto.search }); const p = x; if (!/^0\\d{9}$/.test(phone)) bad();';
    expect(findFieldCaps([{ name: 'a.ts', text: classify }, { name: 'b.ts', text: call }], 'search', lookup())).toEqual([]);
    expect(findFieldCaps([{ name: 'a.ts', text: classify }, { name: 'b.ts', text: call }], 'phone', lookup())).toEqual([]);
  });
  it('hàm không được gọi bằng trường đó thì regex của nó không tính', () => {
    expect(findFieldCaps([{ name: 'r.ts', text: rules }, { name: 's.ts', text: 'normalizeLink(linkType, somethingElse);' }], 'linkValue', lookup())).toEqual([]);
  });
});

describe('regexMax', () => {
  it('cộng lượng tử tối đa', () => {
    expect(regexMax('^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$')).toBe(200);
    expect(regexMax('^0\\d{8,10}$')).toBe(11);
  });
});
