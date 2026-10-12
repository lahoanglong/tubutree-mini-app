import {
  computePointExpiry,
  loadPointExpiryTxns,
  LoyaltyExpiryService,
  lotRecoverable,
  orderLotKey,
  reviewLotKey,
  type PointExpiryTxn,
} from './loyalty-expiry.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { milestoneGrantReason } from '../wallet/referral-reward';

const DAY = 864e5;
const NOW = new Date('2026-07-05T00:00:00.000Z');

// Helper để dựng PointsTransaction tối giản cho helper thuần.
const tx = (
  id: string,
  delta: number,
  createdAt: string,
  expiresAt: string | null = null,
  reason?: string,
  ref?: { refType: string; refId: string },
): PointExpiryTxn => ({
  id,
  delta,
  createdAt: new Date(createdAt),
  expiresAt: expiresAt ? new Date(expiresAt) : null,
  ...(reason ? { reason } : {}),
  ...(ref ?? {}),
});
const review = (id: string, delta: number, createdAt: string, expiresAt: string | null, reviewId: string) =>
  tx(id, delta, createdAt, expiresAt, delta > 0 ? 'REVIEW:tinh-dau' : 'REVIEW_DELETE:p1', { refType: 'REVIEW', refId: reviewId });
const expired = (id: string, amount: number, createdAt: string) => tx(id, -amount, createdAt, null, 'POINTS_EXPIRED');

describe('computePointExpiry (pure FIFO helper)', () => {
  const WINDOW = 7 * DAY;

  it('1 lô đã hết hạn, chưa tiêu → expiredNow = toàn bộ lô', () => {
    const r = computePointExpiry([tx('a', 100, '2025-01-01', '2026-01-01')], NOW, WINDOW);
    expect(r.expiredNow).toBe(100);
    expect(r.expiringSoon).toEqual({ amount: 0, earliestExpiresAt: null });
  });

  it('lô hết hạn đã bị tiêu 1 phần (FIFO) → expiredNow = phần còn lại', () => {
    const r = computePointExpiry(
      [tx('a', 100, '2025-01-01', '2026-01-01'), tx('b', -30, '2025-06-01')],
      NOW,
      WINDOW,
    );
    expect(r.expiredNow).toBe(70);
  });

  it('tiêu ăn LÔ CŨ trước lô mới chưa hết hạn (FIFO) → lô mới sống sót', () => {
    // a: cũ + đã hết hạn; b: mới + còn hạn (trong cửa sổ nhắc); c: tiêu 100.
    // FIFO tiêu a trước → a=0 (không còn hết hạn), b còn nguyên.
    // Nếu tiêu NGƯỢC (mới trước) thì b bị ăn còn a hết hạn → expiredNow=100 (sai).
    const r = computePointExpiry(
      [
        tx('a', 100, '2025-01-01', '2026-01-01'),
        tx('b', 50, '2026-06-01', new Date(NOW.getTime() + 3 * DAY).toISOString()),
        tx('c', -100, '2026-06-15'),
      ],
      NOW,
      WINDOW,
    );
    expect(r.expiredNow).toBe(0);
    expect(r.expiringSoon.amount).toBe(50); // lô mới sống sót, đang trong cửa sổ nhắc
  });

  it('POINTS_EXPIRED âm trước đó đã tiêu hết lô hết hạn → expiredNow = 0 (idempotent)', () => {
    const r = computePointExpiry(
      [
        tx('a', 100, '2025-01-01', '2026-01-01'),
        // cron lần trước tạo âm -100 (không expiresAt) → replay FIFO tiêu lại lô a.
        tx('e', -100, '2026-07-05'),
      ],
      NOW,
      WINDOW,
    );
    expect(r.expiredNow).toBe(0);
  });

  it('lô không hết hạn (expiresAt null) không bao giờ tính là hết hạn', () => {
    const r = computePointExpiry([tx('a', 100, '2020-01-01', null)], NOW, WINDOW);
    expect(r.expiredNow).toBe(0);
    expect(r.expiringSoon.amount).toBe(0);
  });

  it('cửa sổ sắp hết hạn: chỉ tính lô trong (now, now+window]; lấy earliest', () => {
    const soonEarly = new Date(NOW.getTime() + 3 * DAY).toISOString();
    const soonLate = new Date(NOW.getTime() + 5 * DAY).toISOString();
    const outside = new Date(NOW.getTime() + 10 * DAY).toISOString();
    const expired = '2026-01-01';
    const r = computePointExpiry(
      [
        tx('a', 20, '2025-07-01', expired), // đã hết hạn
        tx('b', 40, '2025-08-01', soonLate), // sắp hết hạn (5 ngày)
        tx('c', 60, '2025-09-01', soonEarly), // sắp hết hạn (3 ngày) — earliest
        tx('d', 80, '2025-10-01', outside), // ngoài cửa sổ
      ],
      NOW,
      WINDOW,
    );
    expect(r.expiredNow).toBe(20);
    expect(r.expiringSoon.amount).toBe(100); // 40 + 60
    expect(r.expiringSoon.earliestExpiresAt?.toISOString()).toBe(soonEarly);
  });

  it('không có gì hết hạn → {0, {0, null}}', () => {
    const future = new Date(NOW.getTime() + 100 * DAY).toISOString();
    const r = computePointExpiry([tx('a', 100, '2026-06-01', future)], NOW, WINDOW);
    expect(r).toEqual({ expiredNow: 0, expiringSoon: { amount: 0, earliestExpiresAt: null } });
  });

  it('không có giao dịch → {0, {0, null}}', () => {
    expect(computePointExpiry([], NOW, WINDOW)).toEqual({
      expiredNow: 0,
      expiringSoon: { amount: 0, earliestExpiresAt: null },
    });
  });

  it('deterministic: sort theo createdAt asc, tiebreak id asc dù input xáo trộn', () => {
    // a & b cùng createdAt; a (id nhỏ hơn) là lô CÒN HẠN, b là lô HẾT HẠN.
    // FIFO + tiebreak id asc → tiêu a trước. expiredNow phải = 100 (b hết hạn nguyên vẹn).
    // Nếu tiebreak sai (b trước) → tiêu b, còn a → expiredNow=50 (sai).
    const soon = new Date(NOW.getTime() + 4 * DAY).toISOString();
    const r = computePointExpiry(
      [
        tx('c', -50, '2025-02-01'),
        tx('b', 100, '2025-01-01T00:00:00.000Z', '2026-01-01'),
        tx('a', 50, '2025-01-01T00:00:00.000Z', soon),
      ],
      NOW,
      WINDOW,
    );
    expect(r.expiredNow).toBe(100);
    expect(r.expiringSoon.amount).toBe(0); // a (còn hạn) đã bị tiêu hết
  });

  /**
   * Điểm hoàn khi huỷ đơn (OQ-15) và điểm đơn giao đều có hạn nhưng nằm SAU các lô không hạn (thưởng game, review,
   * giới thiệu...) trong thứ tự FIFO. Dòng POINTS_EXPIRED mà cron ghi phải được replay vào chính lô đã hết hạn, nếu
   * không nó ăn vào lô không hạn cũ hơn, lô hết hạn trông còn nguyên và đêm sau cron trừ lần nữa (mất điểm thật).
   */
  describe('POINTS_EXPIRED chỉ ăn lô đã hết hạn (lô hết hạn không phải lô cũ nhất còn tồn)', () => {
    const PAST = '2026-06-01';

    it('lô cũ hơn không hạn: sau khi cron đã trừ lô hết hạn → expiredNow = 0 (không trừ lần hai)', () => {
      const r = computePointExpiry(
        [
          tx('a', 100, '2025-01-01', null),
          tx('b', 50, '2025-06-01', PAST),
          expired('e', 50, '2026-07-04'),
        ],
        NOW,
        WINDOW,
      );
      expect(r.expiredNow).toBe(0);
    });

    it('lô cũ hơn có hạn dài hơn (cấu hình tháng hết hạn đã giảm): cũng không trừ lần hai', () => {
      const r = computePointExpiry(
        [
          tx('a', 100, '2025-01-01', '2027-01-01'),
          tx('b', 50, '2025-06-01', PAST),
          expired('e', 50, '2026-07-04'),
        ],
        NOW,
        WINDOW,
      );
      expect(r.expiredNow).toBe(0);
    });

    it('mô phỏng cron chạy 4 đêm liên tiếp: tổng trừ đúng bằng lô hết hạn, không trừ lại', () => {
      const rows: PointExpiryTxn[] = [tx('a', 100, '2025-01-01', null), tx('b', 50, '2025-06-01', PAST)];
      let totalExpired = 0;
      for (let night = 0; night < 4; night++) {
        const at = new Date(NOW.getTime() + night * DAY);
        const { expiredNow } = computePointExpiry(rows, at, 0);
        if (expiredNow > 0) {
          totalExpired += expiredNow;
          rows.push({ id: `e${night}`, delta: -expiredNow, createdAt: at, expiresAt: null, reason: 'POINTS_EXPIRED' });
        }
      }
      expect(totalExpired).toBe(50);
    });

    it('điểm hoàn có hạn nằm sau lô không hạn: hết hạn đúng một lần dù cron chạy lại', () => {
      const rows: PointExpiryTxn[] = [
        tx('game', 80, '2026-01-01', null),
        tx('order', 100, '2026-02-01', '2027-02-01'),
        tx('redeem', -40, '2026-03-01'),
        tx('refund', 40, '2026-03-02', '2027-03-02', 'ORDER_REFUND_POINTS:C1'),
      ];
      const at = new Date('2027-03-03T01:00:00Z');
      const first = computePointExpiry(rows, at, 0);
      // redeem -40 ăn lô game cũ nhất (còn 40, không hạn); lô đơn 100 và lô hoàn 40 hết hạn → 140.
      expect(first.expiredNow).toBe(140);
      rows.push(expired('e1', first.expiredNow, '2027-03-03T01:00:00Z'));
      expect(computePointExpiry(rows, new Date('2027-03-04T01:00:00Z'), 0).expiredNow).toBe(0);
    });

    it('lô còn hạn không bị dòng POINTS_EXPIRED ăn: vẫn tính là sắp hết hạn trong cửa sổ nhắc', () => {
      const soon = new Date(NOW.getTime() + 3 * DAY).toISOString();
      const r = computePointExpiry(
        [
          tx('a', 30, '2025-01-01', soon),
          tx('b', 50, '2025-06-01', PAST),
          expired('e', 50, '2026-07-04'),
        ],
        NOW,
        WINDOW,
      );
      expect(r.expiredNow).toBe(0);
      expect(r.expiringSoon.amount).toBe(30);
    });

    it('POINTS_EXPIRED lớn hơn các lô hết hạn tại thời điểm đó → phần dư tiêu FIFO như cũ (không âm, không lỗi)', () => {
      const r = computePointExpiry(
        [
          tx('a', 100, '2025-01-01', null),
          tx('b', 50, '2025-06-01', PAST),
          expired('e', 80, '2026-07-04'),
        ],
        NOW,
        WINDOW,
      );
      expect(r.expiredNow).toBe(0);
    });

    it('lô chỉ hết hạn SAU thời điểm ghi dòng POINTS_EXPIRED thì dòng đó không ăn lô ấy', () => {
      const r = computePointExpiry(
        [
          tx('b', 50, '2025-06-01', '2026-07-04T12:00:00Z'),
          tx('c', 20, '2025-07-01', PAST),
          expired('e', 20, '2026-07-04T00:00:00Z'),
        ],
        new Date('2026-07-05T00:00:00Z'),
        0,
      );
      expect(r.expiredNow).toBe(50);
    });

    it('tiêu điểm thường (không phải POINTS_EXPIRED) vẫn FIFO như cũ: ăn lô cũ nhất, lô hết hạn còn nguyên', () => {
      const r = computePointExpiry(
        [tx('a', 100, '2025-01-01', null), tx('b', 50, '2025-06-01', PAST), tx('s', -30, '2026-01-01', null, 'ORDER_REDEEM:C9')],
        NOW,
        WINDOW,
      );
      expect(r.expiredNow).toBe(50);
    });
  });

  /**
   * Thu hồi điểm đánh giá (REVIEW_DELETE) phải ăn đúng lô đánh giá của nó. Replay FIFO thuần ăn vào lô CŨ NHẤT, lô đánh giá
   * (có hạn) vẫn còn nguyên và tới hạn cron trừ thêm chính số điểm đã thu hồi.
   */
  describe('REVIEW_DELETE ăn đúng lô đánh giá cùng refId, phần dư mới FIFO', () => {
    const PAST = '2026-06-01';

    it('lô cũ không hạn nằm trước: thu hồi không ăn lô cũ, lô đánh giá hết sạch nên không còn gì hết hạn', () => {
      const r = computePointExpiry(
        [
          tx('a', 30, '2025-01-01', null),
          review('r', 5, '2025-05-01', PAST, 'rv1'),
          review('d', -5, '2025-05-02', null, 'rv1'),
        ],
        NOW,
        WINDOW,
      );
      expect(r.expiredNow).toBe(0);
    });

    it('lô cũ có hạn dài hơn lô đánh giá (cấu hình hạ tháng): thu hồi vẫn không để lô đánh giá bị trừ lại', () => {
      const r = computePointExpiry(
        [
          tx('a', 30, '2025-01-01', '2027-01-01'),
          review('r', 5, '2025-05-01', PAST, 'rv1'),
          review('d', -5, '2025-05-02', null, 'rv1'),
        ],
        NOW,
        WINDOW,
      );
      expect(r.expiredNow).toBe(0);
    });

    it('hai đánh giá khác refId: thu hồi đánh giá mới ăn lô của nó, không ăn lô đánh giá cũ hơn đã hết hạn', () => {
      const soon = new Date(NOW.getTime() + 3 * DAY).toISOString();
      const r = computePointExpiry(
        [
          review('r1', 5, '2025-05-01', PAST, 'rv1'),
          review('r2', 5, '2025-05-10', soon, 'rv2'),
          review('d', -5, '2025-05-11', null, 'rv2'),
        ],
        NOW,
        WINDOW,
      );
      expect(r.expiredNow).toBe(5); // lô r1 hết hạn đúng một lần
      expect(r.expiringSoon.amount).toBe(0); // lô r2 đã bị thu hồi hết
    });

    it('lô đánh giá đã bị tiêu bớt trước khi xoá: thu hồi ăn phần còn lại của lô đó, phần dư FIFO sang lô khác', () => {
      const r = computePointExpiry(
        [
          review('r', 5, '2025-05-01', PAST, 'rv1'),
          tx('s', -3, '2025-05-02', null, 'ORDER_REDEEM:C1'), // FIFO ăn 3 điểm lô đánh giá (lô cũ nhất)
          tx('b', 10, '2025-05-03', PAST),
          review('d', -5, '2025-05-04', null, 'rv1'), // lô đánh giá còn 2: ăn 2, dư 3 FIFO sang lô b
        ],
        NOW,
        WINDOW,
      );
      expect(r.expiredNow).toBe(7);
    });

    it('không có lô đánh giá cùng refId (dòng gốc cũ, đã gộp phiên): FIFO như cũ', () => {
      const r = computePointExpiry(
        [tx('a', 30, '2025-01-01', PAST), review('d', -5, '2025-05-02', null, 'rv-lạ')],
        NOW,
        WINDOW,
      );
      expect(r.expiredNow).toBe(25);
    });

    it('dòng âm refType khác hoặc thiếu refId không đi vào cơ chế này: vẫn FIFO', () => {
      const r = computePointExpiry(
        [
          tx('a', 30, '2025-01-01', null),
          review('r', 5, '2025-05-01', PAST, 'rv1'),
          tx('x', -5, '2025-05-02', null, 'ORDER_REDEEM:C1', { refType: 'ORDER', refId: 'rv1' }),
          tx('y', -5, '2025-05-03', null, 'REVIEW_DELETE:p1'), // refType/refId vắng
        ],
        NOW,
        WINDOW,
      );
      // x và y đều ăn lô a (cũ nhất) → lô đánh giá còn nguyên và hết hạn 5.
      expect(r.expiredNow).toBe(5);
    });

    it('lô đánh giá cũ không hạn (trước PE-3) bị thu hồi thì lô có hạn khác không bị ăn nhầm', () => {
      const r = computePointExpiry(
        [
          tx('e', 30, '2025-01-01', PAST),
          review('r', 5, '2025-05-01', null, 'rv1'),
          review('d', -5, '2025-05-02', null, 'rv1'),
        ],
        NOW,
        WINDOW,
      );
      expect(r.expiredNow).toBe(30);
    });
  });

  /**
   * PE-5: dòng âm đảo ngược một khoản cộng cụ thể (huỷ/trả đơn, thu hồi thưởng giới thiệu) ăn lô của khoản cộng đó, như
   * REVIEW_DELETE. Dòng âm TIÊU (dùng điểm cho đơn, đổi voucher, góp quỹ cây, quay thưởng) vẫn FIFO.
   */
  describe('đảo ngược một khoản cộng cụ thể ăn đúng lô gốc, phần dư mới FIFO (PE-5)', () => {
    const PAST = '2026-06-01';
    const FUTURE = '2027-06-01'; // chưa hết hạn và ngoài cửa sổ nhắc
    const ORDER = { refType: 'ORDER' };
    const delivered = (id: string, delta: number, createdAt: string, expiresAt: string | null, orderId: string, code = 'C1') =>
      tx(id, delta, createdAt, expiresAt, `ORDER_DELIVERED:${code}`, { ...ORDER, refId: orderId });
    const reversed = (id: string, delta: number, createdAt: string, orderId: string, code = 'C1') =>
      tx(id, delta, createdAt, null, `ORDER_REVERSED:${code}`, { ...ORDER, refId: orderId });
    const refundPoints = (id: string, delta: number, createdAt: string, expiresAt: string | null, orderId: string, code = 'C1') =>
      tx(id, delta, createdAt, expiresAt, `ORDER_REFUND_POINTS:${code}`, { ...ORDER, refId: orderId });

    describe('huỷ/trả đơn: ORDER_REVERSED ăn lô ORDER_DELIVERED cùng refId', () => {
      it('lô cũ không hạn nằm trước: thu hồi không ăn lô cũ, lô đơn hết sạch nên không còn gì hết hạn', () => {
        const r = computePointExpiry(
          [tx('a', 30, '2025-01-01', null), delivered('d', 20, '2025-05-01', PAST, 'o1'), reversed('v', -20, '2025-05-02', 'o1')],
          NOW,
          WINDOW,
        );
        expect(r.expiredNow).toBe(0);
      });

      it('lô cũ có hạn dài hơn lô đơn (cấu hình hạ tháng): lô đơn đã thu hồi không bị trừ lại, lô cũ còn nguyên', () => {
        const r = computePointExpiry(
          [tx('a', 30, '2025-01-01', '2027-01-01'), delivered('d', 20, '2025-05-01', PAST, 'o1'), reversed('v', -20, '2025-05-02', 'o1')],
          NOW,
          WINDOW,
        );
        expect(r.expiredNow).toBe(0);
        expect(r.expiringSoon.amount).toBe(0);
      });

      it('hai đơn: đảo đơn mới ăn lô của nó, không ăn lô đơn cũ hơn (lô đơn cũ đã hết hạn vẫn hết hạn đúng một lần)', () => {
        const r = computePointExpiry(
          [
            tx('a', 30, '2025-01-01', null),
            delivered('d1', 20, '2025-04-01', PAST, 'o1', 'C1'),
            delivered('d2', 10, '2025-05-01', FUTURE, 'o2', 'C2'),
            reversed('v2', -10, '2025-05-02', 'o2', 'C2'),
          ],
          NOW,
          WINDOW,
        );
        expect(r.expiredNow).toBe(20);
      });

      it('thu hồi lớn hơn lô đơn: ăn hết lô đơn trước, phần dư mới FIFO sang lô cũ nhất', () => {
        const r = computePointExpiry(
          [
            tx('a', 30, '2025-01-01', null),
            delivered('d', 20, '2025-05-01', PAST, 'o1'),
            tx('s', -15, '2025-05-02', null, 'ORDER_REDEEM:C9', { ...ORDER, refId: 'o9' }), // dòng tiêu FIFO ăn 15 của lô a
            tx('b', 10, '2025-05-03', PAST),
            reversed('v', -25, '2025-05-04', 'o1'), // ăn hết 20 của lô đơn, dư 5 FIFO vào lô a (còn 15 → 10)
          ],
          NOW,
          WINDOW,
        );
        expect(r.expiredNow).toBe(10); // chỉ lô b; FIFO thuần sẽ để lại 10 của lô đơn và trả 20
      });

      it('không có lô ORDER_DELIVERED cùng refId (điểm đơn chưa cộng, hay đã gộp phiên): FIFO như cũ', () => {
        const r = computePointExpiry([tx('a', 30, '2025-01-01', PAST), reversed('v', -20, '2025-05-02', 'o-lạ')], NOW, WINDOW);
        expect(r.expiredNow).toBe(10);
      });

      it('dòng hoàn ORDER_REFUND_POINTS cùng refId là lô riêng: thu hồi không ăn nó dù lô đơn đã bị tiêu hết và hai dòng cùng createdAt', () => {
        const T = '2025-06-01T00:00:00.000Z';
        const r = computePointExpiry(
          [
            delivered('d', 20, '2025-01-01', PAST, 'o1'),
            tx('s', -20, '2025-02-01', null, 'ORDER_REDEEM:C9', { ...ORDER, refId: 'o9' }), // FIFO ăn hết lô đơn
            tx('a', 30, '2025-03-01', null),
            refundPoints('a-refund', 40, T, PAST, 'o1'), // id nhỏ hơn: replay thấy lô hoàn trước dòng thu hồi
            reversed('z-reversed', -20, T, 'o1'),
          ],
          NOW,
          WINDOW,
        );
        // Lô đơn đã cạn nên 20 điểm thu hồi FIFO vào lô a; lô hoàn 40 còn nguyên và hết hạn.
        expect(r.expiredNow).toBe(40);
      });

      it('dòng tiêu ORDER_REDEEM mang cùng refType/refId với lô ORDER_DELIVERED vẫn là dòng TIÊU: FIFO ăn lô cũ', () => {
        const r = computePointExpiry(
          [
            tx('a', 30, '2025-01-01', null),
            delivered('d', 20, '2025-05-01', PAST, 'o1'),
            tx('s', -20, '2025-05-02', null, 'ORDER_REDEEM:C1', { ...ORDER, refId: 'o1' }),
          ],
          NOW,
          WINDOW,
        );
        expect(r.expiredNow).toBe(20); // lô đơn còn nguyên (tiêu ăn lô a) và đã hết hạn
      });

      it('dòng ORDER_REVERSED thiếu refId hoặc refType khác: không khoá, FIFO như cũ', () => {
        const r = computePointExpiry(
          [
            tx('a', 30, '2025-01-01', null),
            delivered('d', 20, '2025-05-01', PAST, 'o1'),
            tx('v1', -5, '2025-05-02', null, 'ORDER_REVERSED:C1', { ...ORDER, refId: '' }),
            tx('v2', -5, '2025-05-03', null, 'ORDER_REVERSED:C1'),
            tx('v3', -5, '2025-05-04', null, 'ORDER_REVERSED:C1', { refType: 'REVIEW', refId: 'o1' }),
          ],
          NOW,
          WINDOW,
        );
        expect(r.expiredNow).toBe(20);
      });
    });

    describe('thu hồi thưởng giới thiệu: dòng REVOKE ăn lô thưởng cùng hậu tố reason', () => {
      const REFERRAL = { refType: 'REFERRAL' };
      const grant = (id: string, delta: number, createdAt: string, expiresAt: string | null, refereeId: string) =>
        tx(id, delta, createdAt, expiresAt, `REFERRAL_ORDER2:${refereeId}`, { ...REFERRAL, refId: 'o1:o2' });
      const revoke = (id: string, delta: number, createdAt: string, refereeId: string, orderId = 'o2') =>
        tx(id, delta, createdAt, null, `REFERRAL_ORDER2_REVOKE:${refereeId}`, { ...REFERRAL, refId: orderId });

      it('refId khác nhau giữa dòng thưởng và dòng thu hồi (đơn bị trả so với "<đơn đầu>:<đơn hai>"): vẫn ăn đúng lô thưởng', () => {
        const r = computePointExpiry(
          [tx('a', 30, '2025-01-01', null), grant('g', 5, '2025-05-01', PAST, 'u1'), revoke('v', -5, '2025-05-02', 'u1')],
          NOW,
          WINDOW,
        );
        expect(r.expiredNow).toBe(0);
      });

      it('thu hồi của người được mời khác không ăn lô thưởng này', () => {
        const r = computePointExpiry(
          [
            tx('a', 30, '2025-01-01', null),
            grant('g1', 5, '2025-05-01', PAST, 'u1'),
            grant('g2', 5, '2025-05-02', FUTURE, 'u2'),
            revoke('v', -5, '2025-05-03', 'u2'),
          ],
          NOW,
          WINDOW,
        );
        expect(r.expiredNow).toBe(5); // lô của u1 còn nguyên và hết hạn; lô của u2 đã thu hồi hết
      });

      it('thu hồi thiếu (người mời đã tiêu bớt, dòng thu hồi nhỏ hơn lô thưởng): ăn phần có, lô thưởng còn dư hết hạn đúng phần dư', () => {
        const r = computePointExpiry(
          [tx('a', 30, '2025-01-01', null), grant('g', 5, '2025-05-01', PAST, 'u1'), revoke('v', -3, '2025-05-02', 'u1')],
          NOW,
          WINDOW,
        );
        expect(r.expiredNow).toBe(2);
      });

      it('dòng REFERRAL_DEBT (delta 0) không tạo lô và không tiêu gì', () => {
        const r = computePointExpiry(
          [tx('a', 30, '2025-01-01', null), grant('g', 5, '2025-05-01', PAST, 'u1'), tx('d', 0, '2025-05-02', null, 'REFERRAL_ORDER2_DEBT:u1:5', { refType: 'REFERRAL_DEBT', refId: 'o2' })],
          NOW,
          WINDOW,
        );
        expect(r.expiredNow).toBe(5);
      });

      describe('mốc thưởng thêm: thu hồi đời n chỉ ăn lô đời n', () => {
        const milestoneGrant = (id: string, delta: number, createdAt: string, count: number, gen: number, expiresAt = PAST) =>
          tx(id, delta, createdAt, expiresAt, milestoneGrantReason('R1', count, gen), { ...REFERRAL, refId: 'R1' });
        const milestoneRevoke = (id: string, delta: number, createdAt: string, count: number, gen: number) =>
          tx(id, delta, createdAt, null, `REFERRAL_MILESTONE_REVOKE:R1:${count}#${gen}`, { ...REFERRAL, refId: 'o2' });

        it('đời 0 (reason thưởng không hậu tố) khớp thu hồi #0', () => {
          const r = computePointExpiry(
            [tx('a', 30, '2025-01-01', null), milestoneGrant('m', 10, '2025-05-01', 3, 0), milestoneRevoke('v', -10, '2025-05-02', 3, 0)],
            NOW,
            WINDOW,
          );
          expect(r.expiredNow).toBe(0);
        });

        it('đời 1 (hậu tố #1) khớp thu hồi #1; lô đời 0 đã thu hồi trước đó không bị ăn lại', () => {
          const r = computePointExpiry(
            [
              tx('a', 30, '2025-01-01', null),
              milestoneGrant('m0', 10, '2025-05-01', 3, 0),
              milestoneRevoke('v0', -10, '2025-05-02', 3, 0),
              milestoneGrant('m1', 12, '2025-05-03', 3, 1),
              milestoneRevoke('v1', -12, '2025-05-04', 3, 1),
            ],
            NOW,
            WINDOW,
          );
          expect(r.expiredNow).toBe(0);
        });

        it('thu hồi đời 1 không ăn lô đời 0 còn nguyên của cùng mốc (đời 0 chưa thu hồi → vẫn hết hạn)', () => {
          const r = computePointExpiry(
            [
              tx('a', 30, '2025-01-01', null),
              milestoneGrant('m0', 10, '2025-05-01', 3, 0),
              milestoneGrant('m1', 12, '2025-05-03', 3, 1, FUTURE),
              milestoneRevoke('v1', -12, '2025-05-04', 3, 1),
            ],
            NOW,
            WINDOW,
          );
          expect(r.expiredNow).toBe(10);
        });

        it('mốc khác số lượt không lẫn nhau', () => {
          const r = computePointExpiry(
            [
              tx('a', 30, '2025-01-01', null),
              milestoneGrant('m3', 10, '2025-05-01', 3, 0),
              milestoneGrant('m5', 20, '2025-05-02', 5, 0, FUTURE),
              milestoneRevoke('v5', -20, '2025-05-03', 5, 0),
            ],
            NOW,
            WINDOW,
          );
          expect(r.expiredNow).toBe(10);
        });

        it('hậu tố đời hỏng (không phải số nguyên không âm): không khoá, FIFO như cũ', () => {
          const r = computePointExpiry(
            [
              tx('a', 30, '2025-01-01', null),
              milestoneGrant('m', 10, '2025-05-01', 3, 0),
              tx('v', -10, '2025-05-02', null, 'REFERRAL_MILESTONE_REVOKE:R1:3#x', { ...REFERRAL, refId: 'o2' }),
            ],
            NOW,
            WINDOW,
          );
          expect(r.expiredNow).toBe(10);
        });
      });
    });

    describe('sổ đã ghi trước PE-5 (hồi tố): khách đã bị trừ hai lần không bị trừ thêm lần nào nữa', () => {
      it('lô cũ không hạn, đơn giao rồi trả, POINTS_EXPIRED -20 đã ghi nhầm: replay mới không còn lô hết hạn, phần dư đi FIFO vào lô cũ', () => {
        const ledger = [
          tx('a', 30, '2025-01-01', null),
          delivered('d', 20, '2025-05-01', PAST, 'o1'),
          reversed('v', -20, '2025-05-02', 'o1'),
          tx('e', -20, '2026-06-02', null, 'POINTS_EXPIRED'), // bản cũ ghi dòng này vì lô đơn trông còn nguyên
        ];
        expect(computePointExpiry(ledger, NOW, WINDOW).expiredNow).toBe(0);
        expect(computePointExpiry(ledger, new Date(NOW.getTime() + 400 * DAY), WINDOW).expiredNow).toBe(0);
      });

      it('lô cũ có hạn dài: dòng POINTS_EXPIRED đã ghi nhầm ăn lô cũ, tới hạn lô cũ chỉ hết hạn phần còn lại (tổng vẫn khớp số dư sổ)', () => {
        const ledger = [
          tx('a', 30, '2025-01-01', '2027-01-01'),
          delivered('d', 20, '2025-05-01', PAST, 'o1'),
          reversed('v', -20, '2025-05-02', 'o1'),
          tx('e', -20, '2026-06-02', null, 'POINTS_EXPIRED'),
        ];
        expect(computePointExpiry(ledger, NOW, WINDOW).expiredNow).toBe(0);
        expect(computePointExpiry(ledger, new Date('2027-02-01'), WINDOW).expiredNow).toBe(10); // 30 + 20 - 20 - 20 = 10 còn lại ở lô cũ
      });

      it('lô cũ có hạn đã qua, hết hạn trước lô đơn, thu hồi ghi trước hạn lô cũ: bản cũ để thu hồi ăn lô cũ nên phần chênh chỉ hết hạn cùng lô đơn; replay mới coi nó hết hạn từ hạn lô cũ, tức là bị trừ ngay', () => {
        const ledger = [
          tx('a', 30, '2025-01-01', '2026-01-01'),
          delivered('d', 20, '2025-05-01', '2026-05-01', 'o1'),
          reversed('v', -20, '2025-06-01', 'o1'),
          tx('e', -10, '2026-01-02', null, 'POINTS_EXPIRED'), // cron cũ chỉ thấy 10 điểm còn trong lô cũ (30 trừ 20 do thu hồi ăn nhầm)
        ];
        const before = new Date('2026-03-01'); // lô cũ đã hết hạn, lô đơn chưa
        const after = new Date('2026-05-02'); // cả hai đã hết hạn
        // Bản cũ: 0 tại `before` (lô cũ còn 0, lô đơn còn 20 chưa tới hạn) rồi 20 tại `after`.
        expect(computePointExpiry(ledger, before, WINDOW).expiredNow).toBe(20);
        expect(computePointExpiry(ledger, after, WINDOW).expiredNow).toBe(20);
        // Số dư sổ là 30 + 20 - 20 - 10 = 20: hạn lô cũ đã qua nên toàn bộ số dư còn lại là điểm hết hạn.
      });
    });

    describe('bất biến cũ: không có dòng đảo ngược thì kết quả y hệt replay FIFO + POINTS_EXPIRED', () => {
      /** Bản replay trước PE-5, không có khái niệm lô gốc: FIFO thuần, riêng POINTS_EXPIRED ăn lô đã hết hạn lúc nó ghi. */
      function plainReplay(txns: PointExpiryTxn[], now: Date) {
        const lots: { remaining: number; expiresAt: Date | null }[] = [];
        const eat = (from: typeof lots, amount: number) => {
          let left = amount;
          for (const lot of from) {
            if (left <= 0) break;
            const take = Math.min(lot.remaining, left);
            lot.remaining -= take;
            left -= take;
          }
          return left;
        };
        const sorted = [...txns].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
        for (const t of sorted) {
          if (t.delta > 0) lots.push({ remaining: t.delta, expiresAt: t.expiresAt });
          else if (t.delta < 0) {
            let rest = -t.delta;
            if (t.reason === 'POINTS_EXPIRED') rest = eat(lots.filter((l) => l.expiresAt != null && l.expiresAt.getTime() <= t.createdAt.getTime()), rest);
            eat(lots, rest);
          }
        }
        return lots.filter((l) => l.expiresAt != null && l.expiresAt.getTime() <= now.getTime()).reduce((sum, l) => sum + l.remaining, 0);
      }

      /** PRNG xác định (mulberry32) để ca lỗi tái hiện được. */
      function rng(seed: number) {
        return () => {
          seed = (seed + 0x6d2b79f5) | 0;
          let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
          return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
      }

      it('300 sổ ngẫu nhiên: lô có/không hạn, dòng tiêu mọi loại (kể cả cùng refType/refId với lô), dòng POINTS_EXPIRED', () => {
        const rand = rng(20260511);
        const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)]!;
        const day = (n: number) => new Date(Date.UTC(2025, 0, 1) + n * DAY);
        for (let run = 0; run < 300; run++) {
          const txns: PointExpiryTxn[] = [];
          const lines = 3 + Math.floor(rand() * 12);
          for (let i = 0; i < lines; i++) {
            const createdAt = day(i * 3 + Math.floor(rand() * 2));
            const orderId = pick(['o1', 'o2', 'o3']);
            if (rand() < 0.55) {
              const expiresAt = rand() < 0.3 ? null : day(i * 3 + Math.floor(rand() * 500));
              txns.push({
                id: `t${String(i).padStart(2, '0')}`,
                delta: 1 + Math.floor(rand() * 30),
                createdAt,
                expiresAt,
                reason: pick(['ORDER_DELIVERED:C1', 'ORDER_REFUND_POINTS:C1', 'DAILY_CHECKIN:DAY_1', 'GAME_SPIN_WIN:x', 'REFERRAL_ORDER2:u1']),
                refType: pick(['ORDER', 'GAME', 'CHECKIN', 'REFERRAL']),
                refId: orderId,
              });
            } else {
              txns.push({
                id: `t${String(i).padStart(2, '0')}`,
                delta: -(1 + Math.floor(rand() * 25)),
                createdAt,
                expiresAt: null,
                reason: pick(['ORDER_REDEEM:C1', 'LOYALTY_REDEEM_VOUCHER:v', 'GAME_SPIN_COST', 'GAME_BUY_TREE:T', 'POINTS_EXPIRED']),
                refType: pick(['ORDER', 'REWARD', 'GAME', 'EXPIRE']),
                refId: orderId,
              });
            }
          }
          const now = day(200 + Math.floor(rand() * 400));
          expect(computePointExpiry(txns, now, 0).expiredNow).toBe(plainReplay(txns, now));
        }
      });
    });
  });

  it('tiêu vượt số lô còn lại (bất biến vỡ) → bỏ qua phần dư, không âm', () => {
    const r = computePointExpiry(
      [tx('a', 50, '2025-01-01', '2026-01-01'), tx('b', -80, '2025-06-01')],
      NOW,
      WINDOW,
    );
    expect(r.expiredNow).toBe(0);
  });
});

/**
 * PF-3: phần của MỘT lô còn thu hồi được theo sổ. reverseOrderPoints và ReviewsService.remove dùng nó làm trần thu hồi: chỉ
 * phần lô đã bị cron trừ vì HẾT HẠN, hay đã bị dòng thu hồi cùng khoá lấy, mới là "đã mất". Điểm bị FIFO tiêu ăn không phải
 * mất: lockedOrderPoints giữ cho số dư đủ để thu hồi trong cửa sổ đổi trả, nên chi tiêu từ lô KHÁC không được tính vào lô này.
 */
describe('lotRecoverable (phần lô còn thu hồi được theo sổ)', () => {
  const ORDER = { refType: 'ORDER' };
  const delivered = (id: string, delta: number, createdAt: string, expiresAt: string | null, orderId: string) =>
    tx(id, delta, createdAt, expiresAt, 'ORDER_DELIVERED:C1', { ...ORDER, refId: orderId });
  const reversed = (id: string, delta: number, createdAt: string, orderId: string) =>
    tx(id, delta, createdAt, null, 'ORDER_REVERSED:C1', { ...ORDER, refId: orderId });
  const key = orderLotKey('o1');

  it('lô chưa ai đụng → còn nguyên', () => {
    expect(lotRecoverable([tx('a', 30, '2025-01-01'), delivered('d', 20, '2026-06-01', '2027-06-01', 'o1')], key)).toBe(20);
  });

  it('cron đã trừ POINTS_EXPIRED cho lô đã hết hạn → còn 0 (không còn gì để thu hồi)', () => {
    const r = lotRecoverable(
      [tx('a', 30, '2025-01-01'), delivered('d', 20, '2025-05-01', '2026-05-01', 'o1'), expired('x', 20, '2026-05-02')],
      key,
    );
    expect(r).toBe(0);
  });

  it('cron mới trừ một phần lô hết hạn (phần còn lại sau khi FIFO tiêu bớt) → chỉ phần cron trừ là mất', () => {
    const r = lotRecoverable(
      [delivered('d', 20, '2025-05-01', '2026-05-01', 'o1'), tx('s', -5, '2025-06-01'), expired('x', 15, '2026-05-02')],
      key,
    );
    expect(r).toBe(5);
  });

  it('lô đã hết hạn nhưng cron chưa chạy → còn nguyên (thu hồi lúc này thì cron đêm sau không trừ nữa)', () => {
    expect(lotRecoverable([delivered('d', 20, '2025-05-01', '2026-05-01', 'o1')], key)).toBe(20);
  });

  it('điểm tiêu ăn lô cũ trước (FIFO) rồi tới lô đơn: phần đó không tính là mất, lô đơn vẫn thu hồi đủ', () => {
    const r = lotRecoverable([tx('a', 30, '2025-01-01'), delivered('d', 20, '2026-06-01', null, 'o1'), tx('s', -40, '2026-06-10')], key);
    expect(r).toBe(20);
  });

  it('lô đơn là lô CŨ NHẤT còn tồn, chi tiêu từ lô khác ăn vào nó theo FIFO: vẫn thu hồi đủ (số dư còn đủ nhờ lockedOrderPoints)', () => {
    const txns = [delivered('d', 20, '2026-07-03', '2027-07-03', 'o1'), tx('g', 100, '2026-07-04', null, 'GAME_X'), tx('s', -100, '2026-07-05')];
    expect(lotRecoverable(txns, key)).toBe(20);
  });

  it('tiêu hết cả lô theo FIFO → vẫn là phần chưa mất (trần theo số dư lo phần không đủ)', () => {
    expect(lotRecoverable([delivered('d', 20, '2026-06-01', null, 'o1'), tx('s', -20, '2026-06-10')], key)).toBe(20);
  });

  it('dòng thu hồi đã ghi ăn đúng lô này', () => {
    expect(lotRecoverable([tx('a', 30, '2025-01-01'), delivered('d', 20, '2026-06-01', null, 'o1'), reversed('v', -12, '2026-06-05', 'o1')], key)).toBe(8);
  });

  it('chỉ tính đúng khoá: lô của đơn khác không lẫn vào', () => {
    const txns = [delivered('d1', 20, '2026-06-01', null, 'o1'), delivered('d2', 50, '2026-06-02', null, 'o2')];
    expect(lotRecoverable(txns, orderLotKey('o1'))).toBe(20);
    expect(lotRecoverable(txns, orderLotKey('o2'))).toBe(50);
  });

  it('không có lô nào mang khoá (dòng cộng cũ thiếu refType/refId, hay đơn chưa giao) → null để caller không thu hẹp', () => {
    expect(lotRecoverable([tx('d', 20, '2026-06-01', null, 'ORDER_DELIVERED:C1')], key)).toBeNull();
    expect(lotRecoverable([], key)).toBeNull();
    expect(lotRecoverable([tx('a', 30, '2025-01-01')], key)).toBeNull();
  });

  it('đánh giá: khoá theo id đánh giá, dòng REVIEW_DELETE đã ghi ăn đúng lô', () => {
    const txns = [tx('a', 30, '2025-01-01'), review('r1', 5, '2026-06-01', '2027-06-01', 'rv1'), review('r2', -2, '2026-06-02', null, 'rv1')];
    expect(lotRecoverable(txns, reviewLotKey('rv1'))).toBe(3);
  });

  it('đánh giá cũ hơn lô đã bị tiêu: chi tiêu FIFO ăn vào lô đánh giá không làm nó mất', () => {
    const txns = [review('r1', 5, '2026-06-01', '2027-06-01', 'rv1'), tx('g', 40, '2026-06-02', null, 'GAME_X'), tx('s', -40, '2026-06-03')];
    expect(lotRecoverable(txns, reviewLotKey('rv1'))).toBe(5);
  });

  it('không đổi thứ tự đầu vào của caller (hàm thuần)', () => {
    const txns = [delivered('d', 20, '2026-06-01', null, 'o1'), tx('a', 30, '2025-01-01')];
    const before = txns.map((t) => t.id);
    lotRecoverable(txns, key);
    expect(txns.map((t) => t.id)).toEqual(before);
  });

  it('lô hết hạn mà cron chưa chạy vẫn còn nguyên dù FIFO đã tiêu bớt: expiredNow chỉ tính phần chưa tiêu, trần thu hồi thì không', () => {
    const txns = [tx('a', 30, '2025-01-01'), delivered('d', 20, '2025-05-01', '2026-05-01', 'o1'), tx('s', -35, '2025-06-01')];
    expect(lotRecoverable(txns, key)).toBe(20);
    expect(computePointExpiry(txns, NOW, 0).expiredNow).toBe(15);
  });
});

describe('loadPointExpiryTxns', () => {
  it('chỉ lô STANDARD của đúng user, theo createdAt rồi id, kèm reason/refType/refId', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await loadPointExpiryTxns({ pointsTransaction: { findMany } } as never, 'u1');
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', lot: 'STANDARD' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, delta: true, expiresAt: true, createdAt: true, reason: true, refType: true, refId: true },
    });
  });
});

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T,
} as unknown as SystemConfigService;

describe('LoyaltyExpiryService.expirePoints (cron)', () => {
  function setup(opts: {
    candidates: { userId: string }[];
    userTxns: PointExpiryTxn[];
    updateCount: number;
    /** Sổ user đọc lại SAU khi khoá dòng user (mặc định = userTxns, tức không ai chen vào giữa). */
    txnsAfterLock?: PointExpiryTxn[];
  }) {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(opts.candidates) // ứng viên (distinct userId)
      .mockResolvedValueOnce(opts.userTxns); // toàn bộ txn của user đó (đọc nhanh, chưa khoá)
    const order: string[] = [];
    const txQueryRaw = jest.fn(async () => {
      order.push('lock');
      return [];
    });
    const txFindMany = jest.fn(async () => {
      order.push('reload');
      return opts.txnsAfterLock ?? opts.userTxns;
    });
    const txUpdateMany = jest.fn().mockResolvedValue({ count: opts.updateCount });
    const txCreate = jest.fn().mockResolvedValue({});
    const txObj = {
      $queryRaw: txQueryRaw,
      user: { updateMany: txUpdateMany },
      pointsTransaction: { findMany: txFindMany, create: txCreate },
    };
    const $transaction = jest.fn(async (cb: (t: typeof txObj) => Promise<unknown>) => cb(txObj));
    const prisma = {
      pointsTransaction: { findMany },
      $transaction,
    } as unknown as PrismaService;
    const notifications = { notify: jest.fn() } as unknown as NotificationsService;
    const svc = new LoyaltyExpiryService(prisma, config, notifications);
    return { svc, findMany, txUpdateMany, txCreate, txFindMany, txQueryRaw, order, $transaction };
  }

  it('user có expiredNow>0 → decrement có guard gte + tạo POINTS_EXPIRED txn (cặp atomic)', async () => {
    const { svc, txUpdateMany, txCreate } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 100, '2025-01-01', '2026-01-01')], // expiredNow=100
      updateCount: 1,
    });
    await svc.expirePoints();

    expect(txUpdateMany).toHaveBeenCalledTimes(1);
    const upd = txUpdateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'u1', pointsBalance: { gte: 100 } });
    expect(upd.data).toEqual({ pointsBalance: { decrement: 100 } });

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(txCreate.mock.calls[0][0].data).toMatchObject({
      userId: 'u1',
      delta: -100,
      reason: 'POINTS_EXPIRED',
      refType: 'EXPIRE',
    });
  });

  it('dòng POINTS_EXPIRED không tự đặt createdAt: mặc định lúc INSERT luôn sau `now` của lượt cron, replay dựa vào đó', async () => {
    const { svc, txCreate } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 100, '2025-01-01', '2026-01-01')],
      updateCount: 1,
    });
    await svc.expirePoints();

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(txCreate.mock.calls[0][0].data).not.toHaveProperty('createdAt');
  });

  it('balance-guard count=0 (số dư < expiredNow) → KHÔNG tạo txn (bỏ qua, không âm)', async () => {
    const { svc, txUpdateMany, txCreate } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 100, '2025-01-01', '2026-01-01')],
      updateCount: 0, // guard chặn: không có dòng nào bị decrement
    });
    await svc.expirePoints();

    expect(txUpdateMany).toHaveBeenCalledTimes(1);
    expect(txCreate).not.toHaveBeenCalled();
  });

  it('PD-3 (T7): ứng viên và sổ FIFO chỉ lấy lô STANDARD; dòng POINTS_EXPIRED ghi lô STANDARD', async () => {
    // Lô CONVERTED (quy từ xu) lọt vào FIFO thì dòng tiêu điểm thường ăn nhầm lô quy đổi cũ hơn, lô
    // thường trông "còn nguyên" và cron trừ quá tay (spec PD-3 mục 2.2).
    const { svc, findMany, txUpdateMany, txCreate } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 100, '2025-01-01', '2026-01-01')],
      updateCount: 1,
    });
    await svc.expirePoints();

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ lot: 'STANDARD', delta: { gt: 0 } });
    expect(findMany.mock.calls[1][0].where).toEqual({ userId: 'u1', lot: 'STANDARD' });
    expect(txUpdateMany.mock.calls[0][0].data).toEqual({ pointsBalance: { decrement: 100 } });
    expect(txCreate.mock.calls[0][0].data).toMatchObject({ lot: 'STANDARD' });
  });

  it('đọc kèm refType và refId của từng dòng (computePointExpiry cần chúng để thu hồi đánh giá ăn đúng lô), cả hai lần đọc', async () => {
    const { svc, findMany, txFindMany } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 100, '2025-01-01', '2026-01-01')],
      updateCount: 1,
    });
    await svc.expirePoints();
    expect(findMany.mock.calls[1][0].select).toMatchObject({ refType: true, refId: true });
    expect((txFindMany.mock.calls[0] as unknown as [{ select: unknown }])[0].select).toMatchObject({ refType: true, refId: true });
  });

  it('đọc kèm reason của từng dòng (computePointExpiry cần nó để nhận ra POINTS_EXPIRED), cả lần đọc nhanh lẫn lần đọc trong tx', async () => {
    const { svc, findMany, txFindMany } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 100, '2025-01-01', '2026-01-01')],
      updateCount: 1,
    });
    await svc.expirePoints();
    expect(findMany.mock.calls[1][0].select).toMatchObject({ reason: true });
    expect((txFindMany.mock.calls[0] as unknown as [{ select: unknown }])[0].select).toMatchObject({ reason: true });
  });

  it('lô không hạn cũ hơn + dòng POINTS_EXPIRED đã có cho lô hết hạn → không trừ lần hai (không mở tx)', async () => {
    const { svc, $transaction, txUpdateMany } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [
        tx('a', 100, '2025-01-01', null),
        tx('b', 50, '2025-06-01', '2026-06-01'),
        tx('e', -50, '2026-07-04', null, 'POINTS_EXPIRED'),
      ],
      updateCount: 1,
    });
    await svc.expirePoints();
    expect($transaction).not.toHaveBeenCalled();
    expect(txUpdateMany).not.toHaveBeenCalled();
  });

  it('khoá dòng user rồi đọc lại sổ trong transaction; lượt kia đã trừ trước (sổ có POINTS_EXPIRED) → không trừ lần hai', async () => {
    const expiredLot = tx('a', 100, '2025-01-01', '2026-01-01');
    const { svc, txUpdateMany, txCreate, txFindMany, order } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [expiredLot], // đọc nhanh: thấy 100 đã hết hạn
      txnsAfterLock: [expiredLot, tx('b', -100, '2026-02-01', null)], // sau khi khoá: bên kia đã trừ xong
      updateCount: 1,
    });
    await svc.expirePoints();

    expect(order).toEqual(['lock', 'reload']);
    expect(txFindMany.mock.calls[0]).toEqual([expect.objectContaining({ where: { userId: 'u1', lot: 'STANDARD' } })]);
    expect(txUpdateMany).not.toHaveBeenCalled();
    expect(txCreate).not.toHaveBeenCalled();
  });

  it('expiredNow=0 → không mở transaction', async () => {
    const { svc, $transaction } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 100, '2020-01-01', null)], // null = không hết hạn
      updateCount: 1,
    });
    await svc.expirePoints();
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe('LoyaltyExpiryService.remindExpiringPoints (cron)', () => {
  function setup(opts: {
    candidates: { userId: string }[];
    userTxns: PointExpiryTxn[];
    recentLog: unknown;
  }) {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(opts.candidates)
      .mockResolvedValueOnce(opts.userTxns);
    const notifFindFirst = jest.fn().mockResolvedValue(opts.recentLog);
    const notify = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      pointsTransaction: { findMany },
      notificationLog: { findFirst: notifFindFirst },
    } as unknown as PrismaService;
    const notifications = { notify } as unknown as NotificationsService;
    const svc = new LoyaltyExpiryService(prisma, config, notifications);
    return { svc, findMany, notifFindFirst, notify };
  }

  it('user có điểm sắp hết hạn + chưa nhắc gần đây → notify POINTS_EXPIRING', async () => {
    const soon = new Date(Date.now() + 3 * DAY);
    const { svc, notify } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 40, '2025-08-01', soon.toISOString())],
      recentLog: null,
    });
    await svc.remindExpiringPoints();
    expect(notify).toHaveBeenCalledTimes(1);
    const [uid, code, vars] = notify.mock.calls[0];
    expect(uid).toBe('u1');
    expect(code).toBe('POINTS_EXPIRING');
    expect(vars.points).toBe('40');
    expect(typeof vars.date).toBe('string');
  });

  it('đã nhắc trong kỳ (NotificationLog gần đây) → bỏ qua, KHÔNG notify (dedup)', async () => {
    const soon = new Date(Date.now() + 3 * DAY);
    const { svc, notify } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 40, '2025-08-01', soon.toISOString())],
      recentLog: { id: 'log-1' },
    });
    await svc.remindExpiringPoints();
    expect(notify).not.toHaveBeenCalled();
  });

  it('PD-3: nhắc sắp hết hạn chỉ xét lô STANDARD (lô quy đổi không bao giờ hết hạn)', async () => {
    const soon = new Date(Date.now() + 3 * DAY);
    const { svc, findMany } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 40, '2025-08-01', soon.toISOString())],
      recentLog: null,
    });
    await svc.remindExpiringPoints();
    expect(findMany.mock.calls[0][0].where).toMatchObject({ lot: 'STANDARD' });
    expect(findMany.mock.calls[1][0].where).toEqual({ userId: 'u1', lot: 'STANDARD' });
  });

  it('không có điểm nào trong cửa sổ (amount=0) → không notify', async () => {
    const { svc, notify } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 40, '2020-01-01', '2026-01-01')], // đã hết hạn, không "sắp"
      recentLog: null,
    });
    await svc.remindExpiringPoints();
    expect(notify).not.toHaveBeenCalled();
  });
});
