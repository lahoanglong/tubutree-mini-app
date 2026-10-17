import { formatResults, parseArgs, WITH_BUSINESS_DEFAULTS_FLAG } from '../../../prisma/seed-reference';

describe('seed-reference: dòng lệnh', () => {
  it('không cờ thì không nạp giá trị kinh doanh', () => {
    expect(parseArgs([])).toEqual({ withBusinessDefaults: false });
  });

  it('có cờ (kể cả sau dấu -- mà pnpm/npm chuyển tiếp) thì nạp', () => {
    expect(parseArgs([WITH_BUSINESS_DEFAULTS_FLAG])).toEqual({ withBusinessDefaults: true });
    expect(parseArgs(['--', WITH_BUSINESS_DEFAULTS_FLAG])).toEqual({ withBusinessDefaults: true });
  });

  it('cờ gõ sai là lỗi, không lặng lẽ chạy không cờ', () => {
    expect(() => parseArgs(['--with-business-default'])).toThrow(/không hợp lệ/);
    expect(() => parseArgs([WITH_BUSINESS_DEFAULTS_FLAG, '--force'])).toThrow(/--force/);
  });

  it('báo một dòng các nhóm chưa nạp kèm cách nạp, không in từng nhóm như "đủ sẵn"', () => {
    const lines = formatResults([
      { group: 'system_configs', total: 118, created: 3 },
      { group: 'membership_tiers', total: 4, created: 0, skipped: true },
      { group: 'missions', total: 4, created: 0, skipped: true },
    ]);
    expect(lines).toEqual([
      '[seed-reference] system_configs: +3 mới, 115 đã có',
      `[seed-reference] chưa nạp (giá trị kinh doanh chờ chủ dự án duyệt): membership_tiers, missions. Chạy lại với ${WITH_BUSINESS_DEFAULTS_FLAG} sau khi duyệt.`,
    ]);
  });
});
