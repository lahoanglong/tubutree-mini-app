import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Chặn tái phạm (tubu-w11-01): SĐT chỉ được băm bằng `hmacPhone` (HMAC có khoá) và chỉ được ghi log khi đã che. Quét mã nguồn
 * `apps/api/src` (bỏ file spec): một dòng gọi hàm băm (createHash, hay hàm cục bộ bọc createHash) mà nhắc tới SĐT là băm không khoá; một
 * lệnh log chèn biểu thức có chữ "phone" mà không qua hàm che là lộ số thô.
 */
const SRC = join(__dirname, '..', '..');
const PHONE_WORD = /phone|sdt|msisdn/i;

/** Dòng được phép, kèm lý do. Khoá là `đường dẫn tương đối:đoạn chữ của dòng`. */
const ALLOWED: Record<string, string> = {
  'modules/flash-sale/flash-buyer-keys.ts:FLASH_LEGACY_PHONE_KEY_PREFIX':
    'bí danh CHỈ ĐỌC của khoá SĐT cũ (sha256 trần, trước HMAC): chỉ để đếm lượt đã mua trước khi deploy, không ghi dòng mới dưới khoá này',
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const allowed = (file: string, line: string) => Object.keys(ALLOWED).some((k) => k.startsWith(`${file}:`) && line.includes(k.slice(file.length + 1)));

/** Tên hàm cục bộ chỉ bọc createHash: `const sha256Hex = (s: string) => createHash(...)` hay `function h(...) { return createHash(...) }`. */
function hashHelpers(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\([^)]*\)\s*(?::[^=]+)?=>\s*createHash\(/g)) names.add(m[1]!);
  for (const m of text.matchAll(/function\s+(\w+)\s*\([^)]*\)[^{]*\{\s*return\s+createHash\(/g)) names.add(m[1]!);
  return [...names];
}

function unsaltedPhoneHashes(file: string, text: string): string[] {
  const calls = ['createHash(', ...hashHelpers(text).map((n) => `${n}(`)];
  const hits: string[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
    if (!calls.some((c) => line.includes(c))) return;
    // Lệnh băm xuống dòng (`createHash(...)` rồi `.update(phone)` ở dòng sau): xét tới hết câu lệnh, tối đa 3 dòng sau.
    const end = lines.slice(i, i + 4).findIndex((l) => l.trimEnd().endsWith(';'));
    const stmt = lines.slice(i, end === -1 ? i + 4 : i + end + 1).join('\n');
    if (PHONE_WORD.test(stmt) && !allowed(file, line)) hits.push(`${file}:${i + 1}: ${t}`);
  });
  return hits;
}

const LOG_CALL = /\b(?:logger|log|console)\.(?:log|warn|error|debug|verbose|info)\(/;
const MASKED = /mask|hmacPhone|\.slice\(-\d\)/;
/** Chỉ đếm số lượng (`${phones.length}`) thì không lộ số; `.length` nằm trong biểu thức lớn hơn thì vẫn xét. */
const LENGTH_ONLY = /^\s*[\w.?!]+\.length\s*$/;

function rawPhoneLogs(file: string, text: string): string[] {
  const hits: string[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!LOG_CALL.test(line)) return;
    // Lệnh log viết trên nhiều dòng: xét tới hết câu lệnh (tối đa 4 dòng sau).
    const stmt = [line, ...lines.slice(i + 1, i + 5)].join('\n').split(/\);\s*$/m)[0]!;
    for (const m of stmt.matchAll(/\$\{([^}]*)\}/g)) {
      const expr = m[1]!;
      if (PHONE_WORD.test(expr) && !MASKED.test(expr) && !LENGTH_ONLY.test(expr) && !allowed(file, line)) hits.push(`${file}:${i + 1}: \${${expr}}`);
    }
  });
  return hits;
}

describe('quyền riêng tư SĐT trong apps/api/src (tubu-w11-01)', () => {
  const files = sourceFiles(SRC).map((f) => ({ rel: relative(SRC, f), text: readFileSync(f, 'utf8') }));

  it('đủ file để quét (đường dẫn đúng)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.rel === 'common/crypto/phone-hmac.ts')).toBe(true);
  });

  it('không băm SĐT bằng sha256/md5 trần: dùng hmacPhone (common/crypto/phone-hmac.ts)', () => {
    expect(files.flatMap((f) => unsaltedPhoneHashes(f.rel, f.text))).toEqual([]);
  });

  it('không ghi log SĐT thô: che bằng maskPhone/maskPhoneOrNull hay chỉ ghi đuôi `.slice(-3)`', () => {
    expect(files.flatMap((f) => rawPhoneLogs(f.rel, f.text))).toEqual([]);
  });

  it('bộ dò bắt được đúng hai lỗi đã gặp (khoá Giờ vàng cũ, log số thô) và để yên dạng đã che', () => {
    const oldFlash = [
      "const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');",
      'if (phone) keys.push(`fsk:p:${sha256Hex(`flash-phone:${phone}`)}`);',
    ].join('\n');
    expect(unsaltedPhoneHashes('x.ts', oldFlash)).toHaveLength(1);
    expect(unsaltedPhoneHashes('x.ts', "const h = createHash('sha256').update(user.phone).digest('hex');")).toHaveLength(1);
    expect(unsaltedPhoneHashes('x.ts', 'const k = hmacPhone(user.phone);')).toEqual([]);
    expect(rawPhoneLogs('x.ts', 'this.logger.warn(`Gửi tin cho ${order.phone} lỗi`);')).toHaveLength(1);
    expect(rawPhoneLogs('x.ts', 'this.logger.warn(\n  `Gửi tin cho ${dto.recipientPhone} lỗi`,\n);')).toHaveLength(1);
    expect(rawPhoneLogs('x.ts', 'this.logger.warn(`Gửi tin cho ${maskPhone(order.phone)} lỗi`);')).toEqual([]);
    expect(rawPhoneLogs('x.ts', 'this.logger.warn(`SĐT đuôi ${phone.slice(-3)}`);')).toEqual([]);
  });

  it('bắt cả lệnh băm viết trên nhiều dòng và biểu thức log chỉ "có dính" `.length`', () => {
    expect(unsaltedPhoneHashes('x.ts', "const h = createHash('sha256')\n  .update(order.phone)\n  .digest('hex');")).toHaveLength(1);
    expect(unsaltedPhoneHashes('x.ts', "const h = createHash('sha256').update(token).digest('hex');\nconst phone = order.phone;")).toEqual([]);
    expect(rawPhoneLogs('x.ts', 'this.logger.warn(`Gửi ${phones.length ? phones.join(",") : ""}`);')).toHaveLength(1);
    expect(rawPhoneLogs('x.ts', 'this.logger.warn(`Gửi ${phones.length} số`);')).toEqual([]);
  });
});
