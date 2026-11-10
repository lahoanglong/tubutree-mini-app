import { applyDto, delay, dealerRaceSetup, httpStatus, messageOf, pendingApp } from '../../../test/fakes/w103a-helpers';

/**
 * Nộp hồ sơ đại lý chạy đồng thời (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts). Dùng DealerService THẬT; DB giả có chỉ mục duy nhất một phần
 * dealer_applications_pending_user_key như migration 20260902020000 (userId khi status = PENDING).
 * Bên thua nhận đúng câu tiếng Việt có mã DEALER_APPLICATION_PENDING (Mini App bắt mã này để làm mới trạng thái), không lộ lỗi DB.
 * Không kiểm được trên DB giả: khoá KEY SHARE của khoá ngoại với lượt xoá tài khoản (xem báo cáo wave).
 */
const PENDING_BODY = { code: 'DEALER_APPLICATION_PENDING', message: 'Bạn đã có đơn đăng ký đang chờ duyệt.' };
const SKEWS = Array.from({ length: 13 }, (_, i) => i - 6);

describe('DealerService.apply — race', () => {
  it('hai lượt nộp song song của cùng một người (quét lệch thời điểm): đúng một hồ sơ PENDING, bên thua nhận câu tiếng Việt có mã, admin chỉ được báo một lần', async () => {
    // Số lần lượt thua đã QUA bước kiểm tra "chưa có hồ sơ PENDING" và chỉ bị chỉ mục chặn lúc create (P2002): chứng minh cửa sổ đọc-rồi-ghi có xảy ra.
    let lostAtIndex = 0;
    for (const skew of SKEWS) {
      const { db, dealer, notify } = dealerRaceSetup();
      const create = jest.spyOn(db.client.dealerApplication, 'create');
      const run = async (lag: number) => {
        await delay(lag);
        return dealer.apply('u1', applyDto() as never);
      };
      const settled = await Promise.allSettled([run(Math.max(0, -skew)), run(Math.max(0, skew))]);
      const label = `skew ${skew}`;
      expect({ label, ok: settled.filter((s) => s.status === 'fulfilled').length }).toEqual({ label, ok: 1 });
      const lost = settled.find((s) => s.status === 'rejected')!;
      expect({ label, status: httpStatus(lost) }).toEqual({ label, status: 400 });
      expect((lost as PromiseRejectedResult).reason.getResponse()).toEqual(PENDING_BODY);
      expect(db.rows('dealerApplication').filter((a) => a.userId === 'u1' && a.status === 'PENDING')).toHaveLength(1);
      expect(db.rows('dealerApplication')).toHaveLength(1);
      expect(notify.mock.calls.filter((c) => c[1] === 'OPS_DEALER_APPLICATION_PENDING').map((c) => c[0]).sort()).toEqual(['admin1', 'admin2']);
      lostAtIndex += (await Promise.all(create.mock.results.map((r) => (r.value as Promise<unknown>).then(() => false, (e) => e?.code === 'P2002')))).filter(Boolean).length;
    }
    expect(lostAtIndex).toBeGreaterThan(0);
  });

  it('năm lượt nộp song song: đúng một hồ sơ, bốn bên thua cùng nhận câu tiếng Việt, không lỗi 500', async () => {
    const { db, dealer, notify } = dealerRaceSetup();
    const settled = await Promise.allSettled([0, 1, 2, 3, 4].map(async (i) => (await delay(i % 2), dealer.apply('u1', applyDto() as never))));
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    for (const lost of settled.filter((s) => s.status === 'rejected')) {
      expect(httpStatus(lost)).toBe(400);
      expect((lost as PromiseRejectedResult).reason.getResponse()).toEqual(PENDING_BODY);
    }
    expect(db.rows('dealerApplication').filter((a) => a.status === 'PENDING')).toHaveLength(1);
    expect(notify.mock.calls.filter((c) => c[1] === 'OPS_DEALER_APPLICATION_PENDING')).toHaveLength(2);
  });

  it('hai người khác nhau nộp cùng lúc: cả hai được nhận, mỗi người một hồ sơ PENDING (chỉ mục chỉ chặn trùng theo người)', async () => {
    const { db, dealer } = dealerRaceSetup({ users: [{ id: 'u2', role: 'CUSTOMER', phone: '0922222222', zaloId: 'z2', isBlocked: false, metadata: null }] });
    const settled = await Promise.allSettled([dealer.apply('u1', applyDto() as never), dealer.apply('u2', applyDto({ phone: '0922222222' }) as never)]);
    expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(db.rows('dealerApplication').map((a) => a.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('hồ sơ cũ đã bị từ chối: nộp lại được; hai lượt nộp lại song song vẫn chỉ một hồ sơ PENDING mới', async () => {
    const { db, dealer } = dealerRaceSetup({ applications: [pendingApp('old', 'u1', { status: 'REJECTED', rejectionReason: 'Ảnh mờ' })] });
    const settled = await Promise.allSettled([dealer.apply('u1', applyDto() as never), dealer.apply('u1', applyDto() as never)]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect(messageOf(settled.find((s) => s.status === 'rejected')!)).toBe(PENDING_BODY.message);
    expect(db.rows('dealerApplication').filter((a) => a.status === 'PENDING')).toHaveLength(1);
    expect(db.row('dealerApplication', 'old')).toMatchObject({ status: 'REJECTED', rejectionReason: 'Ảnh mờ' });
  });

  it('đã có hồ sơ PENDING thì nộp lại tuần tự nhận đúng câu tiếng Việt có mã (không tạo thêm dòng)', async () => {
    const { db, dealer } = dealerRaceSetup({ applications: [pendingApp('a1')] });
    const err = await dealer.apply('u1', applyDto() as never).catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toEqual(PENDING_BODY);
    expect(db.rows('dealerApplication')).toHaveLength(1);
  });

  it('người nộp và admin từ chối hồ sơ đang chờ cùng lúc: hồ sơ cũ bị từ chối đúng một lần, không bao giờ có hai hồ sơ PENDING', async () => {
    const outcomes = { applyCreated: 0, applyRefused: 0 };
    for (const skew of SKEWS) {
      const { db, dealer, admin } = dealerRaceSetup({ applications: [pendingApp('a1')] });
      const run = async <T>(lag: number, work: () => Promise<T>) => (await delay(lag), work());
      const settled = await Promise.allSettled([
        run(Math.max(0, -skew), () => admin.reviewDealerApplication('admin1', 'a1', false, undefined, 'Ảnh CCCD mờ')),
        run(Math.max(0, skew), () => dealer.apply('u1', applyDto() as never)),
      ]);
      const label = `skew ${skew}`;
      expect({ label, review: settled[0]!.status }).toEqual({ label, review: 'fulfilled' });
      expect(db.row('dealerApplication', 'a1')).toMatchObject({ status: 'REJECTED', reviewedBy: 'admin1', rejectionReason: 'Ảnh CCCD mờ' });
      const pending = db.rows('dealerApplication').filter((a) => a.status === 'PENDING');
      expect(pending.length).toBeLessThanOrEqual(1);
      if (settled[1]!.status === 'fulfilled') {
        outcomes.applyCreated += 1;
        expect(pending.map((a) => a.id)).not.toContain('a1');
      } else {
        outcomes.applyRefused += 1;
        expect(messageOf(settled[1]!)).toBe(PENDING_BODY.message);
      }
    }
    // Quét đủ hai thứ tự: có lúc nộp thắng (bị từ chối vì còn hồ sơ cũ), có lúc từ chối thắng (hồ sơ mới được tạo).
    expect(outcomes.applyCreated).toBeGreaterThan(0);
    expect(outcomes.applyRefused).toBeGreaterThan(0);
  });

  it('khách vãng lai (zaloId guest_, chưa có SĐT) không nộp được: câu tiếng Việt, không tạo hồ sơ, không báo admin', async () => {
    const { db, dealer, notify } = dealerRaceSetup({ users: [{ id: 'g1', role: 'CUSTOMER', phone: null, zaloId: 'guest_dev-1', isBlocked: false, metadata: null }] });
    const err = await dealer.apply('g1', applyDto() as never).catch((e) => e);
    expect([err.getStatus(), err.message]).toEqual([400, 'Đăng nhập Zalo để đăng ký đại lý.']);
    expect(db.rows('dealerApplication')).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('lớp phòng thủ thứ hai độc lập với chỉ mục: nếu chỉ mục chưa có (migration chưa chạy) thì bước kiểm findFirst vẫn chặn lượt nộp lại tuần tự; song song thì chỉ chỉ mục chặn được', async () => {
    const { db, dealer } = dealerRaceSetup({ noPendingIndex: true });
    await dealer.apply('u1', applyDto() as never);
    const err = await dealer.apply('u1', applyDto() as never).catch((e) => e);
    expect(err.getResponse()).toEqual(PENDING_BODY);
    expect(db.rows('dealerApplication')).toHaveLength(1);
  });
});
