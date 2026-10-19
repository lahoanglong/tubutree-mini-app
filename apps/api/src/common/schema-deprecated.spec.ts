import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(__dirname, '..');
const SCHEMA_PATH = join(__dirname, '../../prisma/schema.prisma');

/**
 * Bảng/cột đánh dấu `/// @deprecated` trong schema.prisma (C-108) và bằng chứng "không ai đọc". Đánh dấu thêm
 * thì phải thêm dòng ở đây kèm cách chứng minh; spec fail nếu schema và bảng này lệch nhau, hoặc nếu có code
 * đọc một bảng/cột đã đánh dấu (khi đó phải gỡ dấu, không phải sửa spec).
 *
 * - `delegate`: tên accessor Prisma của model; chỉ cho phép các lệnh ghi trong `writes`.
 * - `word`: tên cột (duy nhất trong mã nguồn); chỉ cho phép đúng mẫu ghi null trong `allowed`.
 * - `manual`: tên cột trùng tên chỗ khác hoặc quá chung nên grep tự động không chứng minh được; bằng chứng
 *   nằm ở docs/2026-10-review/impl/PD-2.md, spec chỉ giữ dấu đánh dấu.
 */
const DEPRECATED: Record<string, { delegate?: string; writes?: string[]; word?: string; allowed?: RegExp; manual?: string }> = {
  CohortRepeatSnapshot: { delegate: 'cohortRepeatSnapshot', writes: [] },
  FunnelDailySnapshot: { delegate: 'funnelDailySnapshot', writes: [] },
  BetaTester: { delegate: 'betaTester', writes: [] },
  BetaFeedback: { delegate: 'betaFeedback', writes: [] },
  BottleReturn: { delegate: 'bottleReturn', writes: [] },
  RefillPickupLocation: { delegate: 'refillPickupLocation', writes: [] },
  AffiliateClick: { delegate: 'affiliateClick', writes: ['create'] },
  'AffiliateClick.convertedOrderId': { word: 'convertedOrderId' },
  'RetentionDailySnapshot.dauEventBased': { word: 'dauEventBased', allowed: /dauEventBased:\s*null/ },
  'MembershipTier.badgeImageUrl': { word: 'badgeImageUrl' },
  'User.pancakeCustomerId': { word: 'pancakeCustomerId' },
  'User.zaloAccessToken': { manual: 'cùng tên với tham số Zalo của chấm công; chỉ account-deletion.service gán null' },
  'User.zaloRefreshToken': { manual: 'chỉ account-deletion.service gán null' },
  'Order.commission': { manual: 'tên quá chung; không có order.commission, orders.commission hay select/sum nào' },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const source = walk(SRC_ROOT).map((p) => stripComments(readFileSync(p, 'utf-8'))).join('\n');

/** Các `/// @deprecated` trong schema, trả "Model" (đứng trước dòng model) hoặc "Model.field". */
function deprecatedInSchema(): string[] {
  const lines = readFileSync(SCHEMA_PATH, 'utf-8').split('\n');
  const found: string[] = [];
  let model = '';
  for (let i = 0; i < lines.length; i++) {
    const m = /^model\s+(\w+)\s*\{/.exec(lines[i]!);
    if (m) model = m[1]!;
    if (/^\}/.test(lines[i]!)) model = '';
    if (!/^\s*\/\/\/\s*@deprecated\b/.test(lines[i]!)) continue;
    let j = i + 1;
    while (j < lines.length && /^\s*\/\/\//.test(lines[j]!)) j++;
    const next = lines[j] ?? '';
    const asModel = /^model\s+(\w+)\s*\{/.exec(next);
    if (asModel) found.push(asModel[1]!);
    else {
      const field = /^\s*(\w+)\s+\S/.exec(next);
      if (field && model) found.push(`${model}.${field[1]}`);
    }
  }
  return found.sort();
}

describe('schema.prisma /// @deprecated (C-108)', () => {
  it('danh sách đánh dấu trong schema khớp bảng bằng chứng', () => {
    expect(deprecatedInSchema()).toEqual(Object.keys(DEPRECATED).sort());
  });

  it.each(Object.entries(DEPRECATED).filter(([, e]) => e.delegate))('%s: không có lệnh đọc nào ngoài ghi cho phép', (_name, e) => {
    const calls = [...source.matchAll(new RegExp(`\\.${e.delegate}\\.(\\w+)\\(`, 'g'))].map((m) => m[1]!);
    expect(calls.filter((c) => !(e.writes ?? []).includes(c))).toEqual([]);
  });

  it.each(Object.entries(DEPRECATED).filter(([, e]) => e.word))('%s: không có chỗ dùng ngoài mẫu cho phép', (_name, e) => {
    const word = new RegExp(`\\b${e.word}\\b`);
    const uses = source.split('\n').filter((l) => word.test(l) && !(e.allowed && e.allowed.test(l)));
    expect(uses).toEqual([]);
  });

  it('bảng chết không còn bị gọi bằng SQL thô', () => {
    for (const table of ['cohort_repeat_snapshot', 'funnel_daily_snapshot', 'beta_feedbacks', 'beta_testers', 'affiliate_clicks', 'bottle_returns', 'refill_pickup_locations']) {
      expect(source).not.toContain(table);
    }
  });
});
