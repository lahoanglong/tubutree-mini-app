import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/** Nội dung trong cặp ngoặc cân bằng bắt đầu ở `open` (chỉ số của ký tự mở). */
function balanced(text: string, open: number): string {
  const pairs: Record<string, string> = { '(': ')', '{': '}' };
  const stack: string[] = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (pairs[ch]) stack.push(pairs[ch]!);
    else if (stack.length && ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

/** Các nơi ghi cột `users.phone` (create/update/upsert của user, bỏ qua `where`). */
export function userPhoneWriters(): string[] {
  const hits: string[] = [];
  const call = /\b(?:this\.prisma|prisma|tx|db)\.user\.(?:create|update|upsert|updateMany|createMany)\s*\(/g;
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(call)) {
      const body = balanced(text, m.index! + m[0].length - 1);
      const dataAt = body.search(/\bdata\s*:/);
      if (dataAt < 0) continue;
      const brace = body.indexOf('{', dataAt);
      if (brace < 0) continue;
      if (/\bphone\b/.test(balanced(body, brace))) hits.push(relative(SRC, file));
    }
  }
  return [...new Set(hits)].sort();
}

/**
 * Điểm đơn chat tự liên kết theo SĐT chỉ an toàn khi `users.phone` là số đã xác minh (Zalo cấp qua getPhoneNumber). Test này canh
 * nơi GHI cột đó: thêm đường ghi mới (vd khách tự gõ SĐT ở hồ sơ) làm test đỏ để người thêm phải thêm cờ xác minh vào
 * verifiedMemberPhone (external-chat.rules.ts) trước khi bật loyalty.chat_order_points_enabled.
 */
describe('nguồn của users.phone (điều kiện để tự liên kết điểm đơn chat theo SĐT)', () => {
  it('chỉ AuthService ghi users.phone (từ số Zalo đã giải mã), xoá tài khoản chỉ xoá số về null', () => {
    expect(userPhoneWriters()).toEqual(['modules/auth/auth.service.ts', 'modules/users/account-deletion.service.ts']);
    const deletion = readFileSync(join(SRC, 'modules/users/account-deletion.service.ts'), 'utf8');
    expect(deletion).toContain('phone: null,');
    const auth = readFileSync(join(SRC, 'modules/auth/auth.service.ts'), 'utf8');
    expect(auth).toContain('this.zalo.resolvePhoneNumber(phoneToken, accessToken)');
  });

  it('không có DTO hồ sơ nào cho khách gửi `phone` lên cập nhật tài khoản', () => {
    const dto = readFileSync(join(SRC, 'modules/users/dto/update-me.dto.ts'), 'utf8');
    expect(dto).not.toMatch(/\bphone\b/);
  });
});
