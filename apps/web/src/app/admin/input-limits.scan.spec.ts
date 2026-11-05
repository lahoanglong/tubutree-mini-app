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
