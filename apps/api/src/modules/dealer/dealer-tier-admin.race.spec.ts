import { ConflictException, HttpException, Logger } from '@nestjs/common';
import { delay, dealerRaceSetup, httpStatus, messageOf } from '../../../test/fakes/w103a-helpers';

/**
 * Sửa / tạo bậc đại lý chạy đồng thời (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts). Dùng DealerAccountsAdminService THẬT; chỉ giả câu
 * `SELECT * FROM "dealer_tiers" ... FOR UPDATE`. Bậc là tham số tiền (chiết khấu, hạn mức): hai admin sửa cùng lúc không được ghi đè mất thay đổi của nhau,
 * và DealerTierHistory chỉ có đúng một dòng cho mỗi lần đổi thật, dòng sau có "cũ" bằng "mới" của dòng trước.
 * Không có tác vụ nâng/hạ bậc theo doanh số trong mã (bậc chỉ gán tay lúc duyệt hồ sơ hoặc cấp vai trò), nên không có test cho thứ không tồn tại.
 * Không kiểm được trên DB giả: deadlock 40P01, hết hạn giao dịch.
 */
const SKEWS = Array.from({ length: 13 }, (_, i) => i - 6);
const lag = (n: number) => Math.max(0, n);
const SILVER = { name: 'Bạc', minOrderVolume: 0, discountPct: 10, creditLimit: 10_000_000, paymentTerms: 'PREPAID' };
const CONFLICT = 'Bậc này vừa được người khác sửa. Tải lại để xem giá trị mới rồi sửa lại.';

const history = (s: ReturnType<typeof dealerRaceSetup>) => s.db.rows('dealerTierHistory');
const tierView = (s: ReturnType<typeof dealerRaceSetup>, id = 'SILVER') => {
  const t = s.db.row('dealerTier', id)!;
  return { name: t.name, minOrderVolume: t.minOrderVolume, discountPct: Math.round((t.discountRules.default as number) * 10_000) / 100, creditLimit: t.creditLimit, paymentTerms: t.paymentTerms };
};

describe('DealerAccountsAdminService — race', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  it('hai admin cùng mở form một phiên bản rồi lưu hai giá trị khác nhau (quét lệch): đúng một người ghi được, người kia nhận 409 tiếng Việt; một dòng lịch sử cũ → mới của người thắng', async () => {
    let waited = 0;
    for (const skew of SKEWS) {
      const s = dealerRaceSetup();
      const save = async (n: number, adminId: string, discountPct: number, creditLimit: number) =>
        (await delay(n), s.accounts.updateTier(adminId, 'SILVER', { ...SILVER, discountPct, creditLimit }, SILVER));
      const settled = await Promise.allSettled([save(lag(-skew), 'admin1', 15, 20_000_000), save(lag(skew), 'admin2', 12, 5_000_000)]);
      const label = `skew ${skew}`;
      expect({ label, ok: settled.filter((r) => r.status === 'fulfilled').length }).toEqual({ label, ok: 1 });
      const lost = settled.find((r) => r.status === 'rejected')!;
      expect({ label, status: httpStatus(lost), message: messageOf(lost) }).toEqual({ label, status: 409, message: CONFLICT });
      const rows = history(s);
      expect(rows).toHaveLength(1);
      const winner = rows[0]!.changedBy as string;
      const target = winner === 'admin1' ? { discountPct: 15, creditLimit: 20_000_000 } : { discountPct: 12, creditLimit: 5_000_000 };
      expect(tierView(s)).toEqual({ ...SILVER, ...target });
      expect(rows[0]).toMatchObject({ tierId: 'SILVER', action: 'UPDATE', oldValue: SILVER, newValue: { ...SILVER, ...target } });
      waited += s.db.stats.lockWaits;
    }
    expect(waited).toBeGreaterThan(0);
  });

  it('sáu admin lưu CÙNG một giá trị mới từ cùng một phiên bản: tất cả thành công, bậc ghi một lần, đúng một dòng lịch sử (lượt sau thấy đã đúng giá trị nên không ghi trùng)', async () => {
    const s = dealerRaceSetup();
    const next = { ...SILVER, discountPct: 18, creditLimit: 30_000_000 };
    const settled = await Promise.allSettled([1, 2, 3, 4, 5, 6].map(async (i) => (await delay(i % 3), s.accounts.updateTier(`admin${i}`, 'SILVER', next, SILVER))));
    expect(settled.map((r) => r.status)).toEqual(Array(6).fill('fulfilled'));
    expect(history(s)).toHaveLength(1);
    expect(tierView(s)).toEqual({ ...SILVER, discountPct: 18, creditLimit: 30_000_000 });
    for (const r of settled) expect((r as PromiseFulfilledResult<any>).value).toMatchObject({ id: 'SILVER', discountPct: 18, creditLimit: 30_000_000 });
  });

  it('bốn admin sửa bậc liên tục, mỗi người thử lại với phiên bản vừa thấy khi nhận 409: bốn dòng lịch sử liền mạch (cũ của dòng sau = mới của dòng trước), bậc cuối là mới của dòng cuối', async () => {
    const s = dealerRaceSetup();
    const read = async () => (await delay(1), tierView(s));
    const edit = async (i: number) => {
      await delay(i % 2);
      for (let attempt = 0; attempt < 8; attempt++) {
        const seen = await read();
        try {
          await s.accounts.updateTier(`admin${i}`, 'SILVER', { ...seen, creditLimit: seen.creditLimit + i * 1_000_000 }, seen);
          return;
        } catch (e) {
          if (!(e instanceof ConflictException)) throw e;
        }
      }
      throw new Error(`admin${i} hết lượt thử lại`);
    };
    await Promise.all([1, 2, 3, 4].map(edit));
    const rows = history(s);
    expect(rows).toHaveLength(4);
    // Cùng changedAt (giờ giả) nên thứ tự ghi theo thứ tự chèn của DB giả; chuỗi cũ → mới phải nối liền bất kể admin nào ghi trước.
    let cursor: unknown = SILVER;
    const remaining = [...rows];
    while (remaining.length) {
      const idx = remaining.findIndex((r) => JSON.stringify(r.oldValue) === JSON.stringify(cursor));
      expect(idx).toBeGreaterThanOrEqual(0);
      cursor = remaining.splice(idx, 1)[0]!.newValue;
    }
    expect(tierView(s)).toEqual(cursor);
    expect(tierView(s).creditLimit).toBe(SILVER.creditLimit + 10_000_000);
  });

  it('ba admin tạo cùng mã bậc đồng thời (quét lệch): đúng một người tạo được, hai người còn lại nhận 409 tiếng Việt; một dòng lịch sử CREATE, một dòng bậc', async () => {
    for (const skew of SKEWS) {
      const s = dealerRaceSetup();
      const create = async (n: number, adminId: string) =>
        (await delay(n), s.accounts.createTier(adminId, { id: 'PLATINUM', name: 'Bạch kim', minOrderVolume: 100_000_000, discountPct: 25, creditLimit: 80_000_000, paymentTerms: 'NET 30' }));
      const settled = await Promise.allSettled([create(lag(-skew), 'admin1'), create(lag(skew), 'admin2'), create(lag(skew) + 1, 'admin3')]);
      const label = `skew ${skew}`;
      expect({ label, ok: settled.filter((r) => r.status === 'fulfilled').length }).toEqual({ label, ok: 1 });
      for (const lost of settled.filter((r) => r.status === 'rejected')) {
        expect({ label, status: httpStatus(lost), message: messageOf(lost) }).toEqual({ label, status: 409, message: 'Mã bậc PLATINUM đã tồn tại. Chọn mã khác.' });
      }
      expect(s.db.rows('dealerTier').filter((t) => t.id === 'PLATINUM')).toHaveLength(1);
      expect(history(s).filter((h) => h.tierId === 'PLATINUM')).toHaveLength(1);
      expect(history(s)[0]).toMatchObject({ action: 'CREATE', tierId: 'PLATINUM', newValue: { name: 'Bạch kim', discountPct: 25, creditLimit: 80_000_000 } });
    }
  });

  it('lỗi nhập bậc đều là tiếng Việt và không ghi gì: chiết khấu vượt trần, tên trống, hạn mức âm; sửa bậc không tồn tại → 404', async () => {
    const s = dealerRaceSetup();
    const err = async (work: () => Promise<unknown>) => (await work().catch((e) => e)) as HttpException;
    const tooHigh = await err(() => s.accounts.updateTier('admin1', 'SILVER', { ...SILVER, discountPct: 99 }, SILVER));
    expect([tooHigh.getStatus(), tooHigh.message]).toEqual([400, expect.stringMatching(/^Chiết khấu 99% vượt trần 45%/)]);
    const bad = await err(() => s.accounts.updateTier('admin1', 'SILVER', { ...SILVER, name: '  ', creditLimit: -1 }, SILVER));
    expect(bad.message).toBe('Tên bậc không được để trống. Hạn mức công nợ phải là số đồng nguyên từ 0 đến 2.000.000.000.');
    const missing = await err(() => s.accounts.updateTier('admin1', 'KHONG_CO', SILVER, SILVER));
    expect([missing.getStatus(), missing.message]).toEqual([404, 'Không tìm thấy bậc đại lý.']);
    expect(history(s)).toHaveLength(0);
    expect(tierView(s)).toEqual(SILVER);
  });
});
