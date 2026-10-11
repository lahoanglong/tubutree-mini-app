import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';

/**
 * Chốt chặn tái phát (PE-3): mọi nơi ghi một dòng điểm vào `points_transactions` mà KHÔNG phải lệnh trừ phải
 * thuộc một trong ba loại:
 *   A. có `expiresAt` (điểm thưởng lô STANDARD hết hạn theo loyalty.point_expire_months, lấy từ
 *      LoyaltyService.pointsExpiresAt), hoặc truyền `expiresAt` qua applyPointsDelta;
 *   B. lô CONVERTED (không hạn có chủ đích, CHECK points_transactions_converted_no_expiry);
 *   C. delta âm hoặc 0 (tiêu, hoàn tác, hết hạn, ghi nợ).
 * Ngoại lệ còn lại nằm trong EXCEPTIONS với lý do. PE-1a bỏ sót game/đánh giá vì chỉ grep tay; test này biến
 * lần grep đó thành kiểm tự động mỗi lần chạy unit test.
 *
 * Đây là kiểm tĩnh trên mã nguồn: thấy lời gọi `pointsTransaction.create*` / `applyPointsDelta(` và đọc phần đối
 * số. Dựng `data` ở biến riêng rồi truyền vào sẽ bị báo; hãy viết trực tiếp trong lời gọi hoặc thêm ngoại lệ.
 */
const SRC_ROOT = join(__dirname, '..', '..');

interface Site {
  file: string;
  line: number;
  call: string;
  args: string;
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/** Phần giữa cặp ngoặc bắt đầu ở `open` (cân ngoặc, bỏ qua chuỗi và comment). Không cân được thì ném lỗi. */
function balancedArgs(source: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '/' && source[i + 1] === '/') i = source.indexOf('\n', i) === -1 ? source.length : source.indexOf('\n', i);
    else if (c === '/' && source[i + 1] === '*') i = source.indexOf('*/', i + 2) === -1 ? source.length : source.indexOf('*/', i + 2) + 1;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error('không cân được ngoặc của lời gọi ghi sổ điểm');
}

/**
 * Bỏ comment khỏi đoạn mã; `blankStrings` thì bỏ cả nội dung chuỗi và template (giữ cặp nháy), để chữ `expiresAt` nằm trong
 * `reason` hay ghi chú không được tính là trường dữ liệu.
 */
function scrub(source: string, blankStrings: boolean): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quote) {
      if (c === '\\') {
        if (!blankStrings) out += c + (source[i + 1] ?? '');
        i++;
      } else if (c === quote) {
        quote = null;
        out += c;
      } else if (!blankStrings) out += c;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
    } else if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end - 1;
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 1;
      out += ' ';
    } else out += c;
  }
  return out;
}

/** Mọi lời gọi ghi sổ điểm trong `source` (bỏ comment, bỏ phần khai báo hàm applyPointsDelta). */
function findLedgerWrites(source: string, file = 'x.ts'): Site[] {
  const sites: Site[] = [];
  const re = /\.pointsTransaction\s*\.\s*(createManyAndReturn|createMany|create)\s*\(|(?<!function\s)\bapplyPointsDelta\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const lineStart = source.lastIndexOf('\n', m.index) + 1;
    const before = source.slice(lineStart, m.index);
    if (/^\s*(\/\/|\/\*|\*)/.test(before) || before.includes('//')) continue; // nằm trong comment
    sites.push({
      file,
      line: source.slice(0, m.index).split('\n').length,
      call: m[0].replace(/\s+/g, '').replace(/\($/, ''),
      args: balancedArgs(source, m.index + m[0].length - 1),
    });
  }
  return sites;
}

/** `expiresAt: null` / `undefined` chỉ có tên trường mà không đặt hạn nên không được coi là có hạn. */
const HAS_EXPIRY = /\bexpiresAt\b(?!\s*:\s*(?:null|undefined)\b)/;
const CONVERTED_LOT = /\blot:\s*'CONVERTED'/;
const NON_POSITIVE_DELTA = /\bdelta:\s*(?:-|0\b)/;

/** Ngoại lệ phải nêu lý do; khớp theo file và một đoạn riêng của đối số để một dòng ghi mới trong cùng file vẫn bị kiểm. */
const EXCEPTIONS: { file: string; argsInclude: string; why: string }[] = [
  {
    file: 'modules/loyalty/points-ledger.ts',
    argsInclude: 'data',
    why: 'applyPointsDelta là helper chung: data dựng từ input.expiresAt/lot của caller; từng lời gọi applyPointsDelta được kiểm riêng ở test này.',
  },
  {
    file: 'modules/wallet/referral-reward.ts',
    argsInclude: 'delta: take > 0 ? -take : 0',
    why: 'thu hồi thưởng giới thiệu: delta là âm hoặc 0 (phần thiếu ghi thành REFERRAL_DEBT).',
  },
  {
    file: 'modules/loyalty/loyalty.service.ts',
    argsInclude: 'delta: take > 0 ? -take : 0',
    why: 'thu hồi điểm đơn khi huỷ/trả (ORDER_REVERSED): tối đa phần còn lại của lô, delta là âm hoặc 0.',
  },
  {
    file: 'modules/reviews/reviews.service.ts',
    argsInclude: 'delta: take > 0 ? -take : 0',
    why: 'thu hồi điểm đánh giá khi xoá (REVIEW_DELETE): tối đa phần còn lại của lô, delta là âm hoặc 0.',
  },
];

function violation(site: Site): boolean {
  const code = scrub(site.args, true);
  if (HAS_EXPIRY.test(code) || CONVERTED_LOT.test(scrub(site.args, false)) || NON_POSITIVE_DELTA.test(code)) return false;
  return !EXCEPTIONS.some((e) => site.file === e.file && site.args.includes(e.argsInclude));
}

describe('mọi dòng điểm dương lô STANDARD đều có hạn hoặc là ngoại lệ có lý do (PE-3)', () => {
  const rel = (f: string) => f.slice(SRC_ROOT.length + 1).split(sep).join('/');
  const sites = listSourceFiles(SRC_ROOT).flatMap((f) => findLedgerWrites(readFileSync(f, 'utf8'), rel(f)));

  it('quét được các nơi ghi sổ điểm hiện có (không quét hụt)', () => {
    const files = new Set(sites.map((s) => s.file));
    for (const f of [
      'modules/loyalty/loyalty.service.ts',
      'modules/game/game.service.ts',
      'modules/reviews/reviews.service.ts',
      'modules/wallet/reward-points.service.ts',
      'modules/checkout/checkout.service.ts',
      'modules/orders/order-reversal.service.ts',
      'modules/loyalty/loyalty-expiry.service.ts',
    ]) {
      expect(files).toContain(f);
    }
  });

  it('không có dòng cộng điểm nào thiếu expiresAt ngoài danh sách ngoại lệ', () => {
    const bad = sites.filter(violation).map((s) => `${s.file}:${s.line} ${s.call}(${s.args.replace(/\s+/g, ' ').trim().slice(0, 120)})`);
    expect(bad).toEqual([]);
  });

  it('không ngoại lệ nào bị bỏ quên: mỗi ngoại lệ còn khớp ít nhất một lời gọi thật', () => {
    for (const e of EXCEPTIONS) {
      expect(sites.some((s) => s.file === e.file && s.args.includes(e.argsInclude))).toBe(true);
    }
  });

  it('không có INSERT thô vào points_transactions ngoài migration', () => {
    const raw = listSourceFiles(SRC_ROOT)
      .filter((f) => /INSERT\s+INTO\s+"?points_transactions"?/i.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(raw).toEqual([]);
  });
});

/** SQL thô tăng pointsBalance mà không ghi dòng sổ có hạn làm vỡ bất biến balance == SUM(delta) và lách chốt chặn trên. */
const RAW_BALANCE_INCREMENT = /"pointsBalance"\s*=\s*(?:\w+\.)?"pointsBalance"\s*\+/;

describe('không tăng pointsBalance bằng SQL thô (lách sổ điểm)', () => {
  it('không có UPDATE thô nào tăng "pointsBalance" trong mã nguồn', () => {
    const files = listSourceFiles(SRC_ROOT)
      .filter((f) => RAW_BALANCE_INCREMENT.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC_ROOT.length + 1).split(sep).join('/'));
    expect(files).toEqual([]);
  });

  it('bộ quét bắt đúng các dạng viết thông thường', () => {
    expect(RAW_BALANCE_INCREMENT.test('UPDATE "users" SET "pointsBalance" = "pointsBalance" + 5 WHERE "id" = x')).toBe(true);
    expect(RAW_BALANCE_INCREMENT.test('UPDATE "users" u SET "pointsBalance"="pointsBalance"+${n}')).toBe(true);
    expect(RAW_BALANCE_INCREMENT.test('SET "pointsBalance" = u."pointsBalance" + 1')).toBe(true);
    expect(RAW_BALANCE_INCREMENT.test('SELECT "pointsBalance", "pointsConvertedBalance" FROM "users" FOR UPDATE')).toBe(false);
  });
});

describe('bộ quét bắt đúng (test của chính chốt chặn)', () => {
  const bad = (src: string) => findLedgerWrites(src).filter(violation);

  it('bắt dòng cộng điểm thiếu expiresAt (đúng kiểu GAME_SPIN_WIN/REVIEW trước PE-3)', () => {
    expect(bad("await tx.pointsTransaction.create({ data: { userId, delta: 5, reason: 'X', refType: 'GAME' } });")).toHaveLength(1);
    expect(bad("await db.pointsTransaction.create({ data: { userId, delta, reason, refType: 'GAME' } });")).toHaveLength(1);
    expect(bad("await tx.pointsTransaction.createMany({ data: [{ userId, delta: pts, reason }], skipDuplicates: true });")).toHaveLength(1);
    expect(bad("await applyPointsDelta(tx, { userId, delta: points, lot: 'STANDARD', reason, refType: 'X' });")).toHaveLength(1);
  });

  it('bắt expiresAt chỉ có tên mà không đặt hạn: null, undefined, trong chuỗi hay comment', () => {
    expect(bad("tx.pointsTransaction.create({ data: { userId, delta: 5, reason: 'X', expiresAt: null } })")).toHaveLength(1);
    expect(bad('tx.pointsTransaction.create({ data: { userId, delta: 5, reason: "X", expiresAt : undefined } })')).toHaveLength(1);
    expect(bad("tx.pointsTransaction.create({ data: { userId, delta: 5, reason: 'chưa có expiresAt' } })")).toHaveLength(1);
    expect(bad('tx.pointsTransaction.create({ data: { userId, delta: 5, reason: `R:${a}:expiresAt` } })')).toHaveLength(1);
    expect(bad('tx.pointsTransaction.create({ data: { userId, delta: 5, // TODO expiresAt\n reason } })')).toHaveLength(1);
    expect(bad('tx.pointsTransaction.create({ data: { userId, delta: 5, /* expiresAt */ reason } })')).toHaveLength(1);
    expect(bad("applyPointsDelta(tx, { userId, delta: p, lot: 'STANDARD', reason, expiresAt: null })")).toHaveLength(1);
  });

  it('cho qua expiresAt có giá trị: biến, biểu thức, tính từ helper', () => {
    expect(bad('tx.pointsTransaction.create({ data: { userId, delta: 5, expiresAt: await this.loyalty.pointsExpiresAt(now) } })')).toHaveLength(0);
    expect(bad('tx.pointsTransaction.create({ data: { userId, delta: 5, expiresAt: input.expiresAt ?? exp } })')).toHaveLength(0);
    expect(bad("tx.pointsTransaction.create({ data: { userId, delta: 5, reason: 'x', expiresAt: nullable ? null : date } })")).toHaveLength(0);
    expect(bad("tx.pointsTransaction.create({ data: { userId, delta: 5, reason: 'x', expiresAt: nulled } })")).toHaveLength(0);
  });

  it('cho qua: có expiresAt, lô CONVERTED, delta âm hoặc 0', () => {
    expect(bad("tx.pointsTransaction.create({ data: { userId, delta, reason, expiresAt } })")).toHaveLength(0);
    expect(bad("applyPointsDelta(tx, { userId, delta: pts, lot: 'STANDARD', reason, expiresAt })")).toHaveLength(0);
    expect(bad("applyPointsDelta(tx, { userId, delta: p, lot: 'CONVERTED', reason })")).toHaveLength(0);
    expect(bad("tx.pointsTransaction.create({ data: { userId, delta: -cost, reason } })")).toHaveLength(0);
    expect(bad("tx.pointsTransaction.create({ data: { userId, delta: 0, reason } })")).toHaveLength(0);
  });

  it('bỏ qua comment và phần khai báo hàm; không bị đánh lừa bởi ngoặc/dấu nháy trong chuỗi', () => {
    expect(findLedgerWrites('// tx.pointsTransaction.create({ data: { delta: 5 } })')).toHaveLength(0);
    expect(findLedgerWrites(' * dùng applyPointsDelta(tx, { delta: 5 }) để cộng')).toHaveLength(0);
    expect(findLedgerWrites('export async function applyPointsDelta(tx: T, input: I) {}')).toHaveLength(0);
    const tricky = "tx.pointsTransaction.create({ data: { userId, reason: `X:${a}(b`, note: \"it's )\", delta: 5 } }); foo()";
    expect(findLedgerWrites(tricky)).toHaveLength(1);
    expect(bad(tricky)).toHaveLength(1);
  });

  it('comment trong đối số không làm lệch phần cân ngoặc', () => {
    const src = "tx.pointsTransaction.create({\n  data: { userId, // đừng ( nhầm\n    delta: 5, expiresAt },\n});";
    expect(bad(src)).toHaveLength(0);
  });
});
