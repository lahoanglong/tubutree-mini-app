import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as ts from 'typescript';
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

  it.each(seeded.map((t) => [t.code, t] as const))('%s: mọi biến của nội dung mặc định có trong bảng', (_code, t) => {
    for (const v of usedIn(t.bodyTemplate)) expect(TEMPLATE_VARIABLES[t.code]).toContain(v);
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


/**
 * Đối chiếu với chỗ gọi: mọi biến mà mã điền cho một mẫu (object literal ở `notify(user, 'MÃ', { ... })` hoặc `template: 'MÃ', data: () => ({ ... })`)
 * phải có trong bảng, nếu không admin không thêm được biến đó vào câu dù mã đã điền. Khoá nội bộ chỉ dùng để điều hướng không tính.
 */
describe('Bảng biến khớp các chỗ gọi notify()', () => {
  const INTERNAL_KEYS = new Set(['post_id', 'route', 'product_slug']);
  const SRC = join(__dirname, '../..');
  const codes = Object.keys(TEMPLATE_VARIABLES);

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) sourceFiles(p, out);
      else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.race-spec.ts')) out.push(p);
    }
    return out;
  }

  const literalOf = (n: ts.Node | undefined): ts.ObjectLiteralExpression | null => {
    if (!n) return null;
    if (ts.isObjectLiteralExpression(n)) return n;
    if (ts.isParenthesizedExpression(n)) return literalOf(n.expression);
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && !ts.isBlock(n.body)) return literalOf(n.body);
    return null;
  };

  it('không có biến nào mã điền mà bảng thiếu', () => {
    const filled: { code: string; key: string; site: string }[] = [];
    const quoted = new RegExp(`['"](${codes.join('|')})['"]`);
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf-8');
      if (!quoted.test(text)) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const visit = (n: ts.Node): void => {
        if (ts.isStringLiteral(n) && TEMPLATE_VARIABLES[n.text]) {
          let obj: ts.ObjectLiteralExpression | null = null;
          const parent = n.parent;
          if (ts.isCallExpression(parent)) obj = literalOf(parent.arguments[parent.arguments.indexOf(n as ts.Expression) + 1]);
          else if (ts.isPropertyAssignment(parent) && ts.isObjectLiteralExpression(parent.parent)) {
            const data = parent.parent.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && /^(data|vars|variables|params)$/.test(p.name.getText(sf)));
            obj = literalOf(data?.initializer);
          }
          if (obj) {
            for (const prop of obj.properties) {
              if (ts.isSpreadAssignment(prop) || !prop.name) continue;
              filled.push({ code: n.text, key: prop.name.getText(sf).replace(/['"]/g, ''), site: `${file.slice(SRC.length)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}` });
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(filled.length).toBeGreaterThan(50);
    const missing = filled.filter((f) => !INTERNAL_KEYS.has(f.key) && !f.key.endsWith('_id') && !TEMPLATE_VARIABLES[f.code]!.includes(f.key));
    expect(missing).toEqual([]);
  });

  it('bốn biến mã điền mà trước đây bảng thiếu', () => {
    expect(TEMPLATE_VARIABLES.GROUP_BUY_SUCCESS).toEqual(expect.arrayContaining(['code', 'expires', 'product']));
    expect(TEMPLATE_VARIABLES.GAME_CHECKIN_REMINDER).toContain('freezes');
    expect(TEMPLATE_VARIABLES.REFERRAL_REWARD_REVOKED).toEqual(expect.arrayContaining(['points', 'debt']));
    expect(TEMPLATE_VARIABLES.DEALER_CREDIT_PAYMENT_REPORTED).toContain('note');
  });
});
