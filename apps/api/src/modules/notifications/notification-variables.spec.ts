import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATE_VARIABLES, VARIABLE_LABELS, templateVariableProblem, variablesOf } from './notification-variables';

type SeedTemplate = { code: string; bodyTemplate: string };

function seededTemplates(): SeedTemplate[] {
  const src = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf-8');
  const start = src.indexOf('const NOTIFICATION_TEMPLATES = [');
  const open = src.indexOf('[', src.indexOf('=', start));
  const end = src.indexOf('\n];', open);
  return new Function(`return ${src.slice(open, end + 2)};`)() as SeedTemplate[];
}

const usedIn = (body: string) => [...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))];

describe('Biến của mẫu thông báo', () => {
  const seeded = seededTemplates();

  it('bảng biến phủ đúng các mẫu mặc định, không thừa không thiếu', () => {
    expect(Object.keys(TEMPLATE_VARIABLES).sort()).toEqual(seeded.map((t) => t.code).sort());
  });

  it.each(seeded.map((t) => [t.code, t] as const))('%s: nội dung mặc định chỉ dùng biến có trong bảng', (_code, t) => {
    expect(usedIn(t.bodyTemplate).sort()).toEqual([...TEMPLATE_VARIABLES[t.code]!].sort());
    expect(templateVariableProblem(t.code, t.bodyTemplate)).toBe('');
  });

  it('mọi biến đều có tên gọi dễ hiểu', () => {
    const keys = new Set(Object.values(TEMPLATE_VARIABLES).flat());
    for (const k of keys) expect(VARIABLE_LABELS[k]).toBeTruthy();
  });

  it('mẫu mã giảm giá chào mừng liệt kê đúng biến, không có mã đơn hàng', () => {
    expect(variablesOf('WELCOME_VOUCHER')!.map((v) => v.key).sort()).toEqual(['code', 'expires', 'min_order_note', 'value']);
    expect(variablesOf('WELCOME_VOUCHER')!.map((v) => v.key)).not.toContain('order_code');
  });

  it('mẫu ngoài bảng không kiểm được (null)', () => {
    expect(variablesOf('MAU_TU_THEM')).toBeNull();
    expect(templateVariableProblem('MAU_TU_THEM', 'Xin chào {{bat_ky}}')).toBe('');
  });

  describe('templateVariableProblem', () => {
    it('biến mã không điền cho mẫu này: báo tên biến và danh sách dùng được', () => {
      const p = templateVariableProblem('WELCOME_VOUCHER', 'Tặng mã {{order_code}}');
      expect(p).toContain('{{order_code}}');
      expect(p).toContain('{{code}}');
      expect(p).toContain('{{value}}');
    });

    it.each([
      ['dấu cách', 'Mã {{ code }}'],
      ['có dấu tiếng Việt', 'Mã {{mã}}'],
      ['viết hoa sai', 'Mã {{Code}}'],
      ['ngoặc đơn', 'Mã {code}'],
      ['biến trống', 'Mã {{}}'],
    ])('lỗi gõ: %s', (_l, body) => {
      expect(templateVariableProblem('WELCOME_VOUCHER', body)).not.toBe('');
    });

    it('nội dung hợp lệ và không biến đều qua', () => {
      expect(templateVariableProblem('WELCOME_VOUCHER', 'Tặng bạn mã {{code}} giảm {{value}}, dùng trước {{expires}}.')).toBe('');
      expect(templateVariableProblem('GAME_TREE_THIRSTY', 'Cây đang khát, ghé tưới nhé!')).toBe('');
    });

    it('mẫu không có biến mà gõ biến thì báo "không có biến nào"', () => {
      expect(templateVariableProblem('GAME_TREE_THIRSTY', 'Cây của {{user}} khát')).toContain('không có biến nào');
    });
  });
});
