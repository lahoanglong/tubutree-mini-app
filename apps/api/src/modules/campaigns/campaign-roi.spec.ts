import { CAMPAIGN_BANNER_CLICK_EVENT, CAMPAIGN_LANDING_VIEW_EVENT, campaignRoiBatch, ZERO_CAMPAIGN_ROI } from './campaign-roi';

type Db = Parameters<typeof campaignRoiBatch>[0];
const dbOf = (events: unknown[], orders: unknown[]) => ({ $queryRaw: jest.fn().mockResolvedValueOnce(events).mockResolvedValueOnce(orders) });
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?').replace(/\s+/g, ' ');

const A = { id: 'a', startAt: new Date('2026-11-01T00:00:00.000Z'), endAt: new Date('2026-11-11T16:59:59.000Z') };
const B = { id: 'b', startAt: new Date('2026-10-20T00:00:00.000Z'), endAt: new Date('2026-12-01T00:00:00.000Z') };

describe('campaignRoiBatch', () => {
  it('tên sự kiện khớp hai sự kiện máy khách gửi', () => {
    expect(CAMPAIGN_LANDING_VIEW_EVENT).toBe('campaign_landing_view');
    expect(CAMPAIGN_BANNER_CLICK_EVENT).toBe('campaign_banner_click');
  });

  it('không có chiến dịch: không truy vấn DB', async () => {
    const db = dbOf([], []);
    expect((await campaignRoiBatch(db as unknown as Db, [])).size).toBe(0);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('hai truy vấn gom cho cả lô; ghép lượt xem, lượt bấm, số đơn và GMV theo chiến dịch (bigint của Postgres)', async () => {
    const db = dbOf([{ id: 'a', views: 40n, clicks: 12n }], [{ id: 'a', orders: 3n, gmv: 1_250_000n }, { id: 'b', orders: 1n, gmv: 90_000n }]);
    const out = await campaignRoiBatch(db as unknown as Db, [A, B]);
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(out.get('a')).toEqual({ views: 40, clicks: 12, ordersCount: 3, gmv: 1_250_000 });
    // Chiến dịch có đơn nhưng chưa có sự kiện nào: lượt xem/bấm là 0 chứ không mất dòng.
    expect(out.get('b')).toEqual({ views: 0, clicks: 0, ordersCount: 1, gmv: 90_000 });
  });

  it('chiến dịch không có sự kiện lẫn đơn: không có trong kết quả (nơi dùng đọc ?? ZERO_CAMPAIGN_ROI)', async () => {
    const out = await campaignRoiBatch(dbOf([], []) as unknown as Db, [A]);
    expect(out.has('a')).toBe(false);
    expect(ZERO_CAMPAIGN_ROI).toEqual({ views: 0, clicks: 0, ordersCount: 0, gmv: 0 });
  });

  it('SQL sự kiện: chỉ hai sự kiện chiến dịch, khớp props.campaignId, trong khung [startAt, endAt) của từng chiến dịch theo giờ máy chủ nhận', async () => {
    const db = dbOf([], []);
    await campaignRoiBatch(db as unknown as Db, [A, B]);
    const call = db.$queryRaw.mock.calls[0]!;
    const text = sqlOf(call);
    expect(text).toContain(`e.props->>'campaignId' = w.id`);
    expect(text).toContain('e."receivedAt" >= w.starts_at::timestamp');
    expect(text).toContain('e."receivedAt" < w.ends_at::timestamp');
    const values = call.slice(1) as unknown[];
    expect(values).toEqual([
      CAMPAIGN_LANDING_VIEW_EVENT,
      CAMPAIGN_BANNER_CLICK_EVENT,
      ['a', 'b'],
      ['2026-11-01T00:00:00.000Z', '2026-10-20T00:00:00.000Z'],
      ['2026-11-11T16:59:59.000Z', '2026-12-01T00:00:00.000Z'],
      CAMPAIGN_LANDING_VIEW_EVENT,
      CAMPAIGN_BANNER_CLICK_EVENT,
      '2026-10-20T00:00:00.000Z',
    ]);
  });

  it('SQL đơn: chỉ đơn dùng mã GẮN VÀO chiến dịch, trong khung ngày, theo định nghĩa GMV của admin; mỗi (chiến dịch, đơn) đếm một lần', async () => {
    const db = dbOf([], []);
    await campaignRoiBatch(db as unknown as Db, [A]);
    const call = db.$queryRaw.mock.calls[1]!;
    const text = sqlOf(call);
    expect(text).toContain('JOIN campaign_coupons cc ON cc."campaignId" = w.id');
    expect(text).toContain('JOIN coupon_redemptions r ON r."couponId" = cc."couponId"');
    expect(text).toContain('JOIN orders p ON p.id = r."orderId" JOIN orders o ON o.id = p.id OR o."checkoutGroup" = p."checkoutGroup"');
    expect(text).toContain('SELECT DISTINCT w.id AS id, o.id AS order_id, o.total AS total');
    expect(text).toContain('o."createdAt" >= w.starts_at::timestamp');
    expect(text).toContain('o."createdAt" < w.ends_at::timestamp');
    // `Prisma.Sql` (mảnh GMV_ORDER_SQL) là giá trị duy nhất có thuộc tính `sql`.
    const gmvRule = (call.slice(1) as Array<{ sql?: string }>).find((v) => typeof v?.sql === 'string')!;
    expect(gmvRule.sql).toContain(`o.status IN ('CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED')`);
    expect(gmvRule.sql).toContain('o.code NOT IN');
  });

  it('dòng hỏng (giá trị lạ) về 0, không ném', async () => {
    const out = await campaignRoiBatch(dbOf([{ id: 'a', views: 'x', clicks: null }], [{ id: 'a', orders: -3, gmv: undefined }]) as unknown as Db, [A]);
    expect(out.get('a')).toEqual(ZERO_CAMPAIGN_ROI);
  });
});
