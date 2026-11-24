import { Prisma } from '@prisma/client';
import {
  PANCAKE_IGNORE_ZERO_STOCK_KEY,
  applyPancakeStock,
  forcePancakeStock,
  readKeepPositiveOnZero,
  releaseVariationStock,
  restockReturnedVariationStock,
  reserveAvailableVariationStock,
  reserveVariationStock,
} from './variation-stock';

/**
 * Ba câu SQL này quyết định số tồn kho thật, nên bài kiểm tra phép TÍNH được chạy trên Postgres
 * thật (11/11 kịch bản, ghi trong docs/2026-09-12-deploy-runbook.md): Pancake có tự trừ tồn,
 * Pancake không tự trừ, nhập thêm hàng, huỷ đơn sau khi đã nhả giữ chỗ, dữ liệu cũ chưa có mốc,
 * hết hàng, và số Pancake tụt sâu hơn phần giữ chỗ.
 *
 * Phần dưới đây khoá những gì unit test khoá được: đúng câu lệnh, đúng tham số, và không nội
 * suy giá trị vào chuỗi SQL.
 */
function mockTx() {
  const $executeRaw = jest.fn().mockResolvedValue(1);
  const $queryRaw = jest.fn().mockResolvedValue([{ reserved: 0 }]);
  return { tx: { $executeRaw, $queryRaw } as never, $executeRaw, $queryRaw };
}
/** Câu lệnh đã ghép (mảnh `Prisma.sql` lồng bên trong được trải phẳng): SQL với `?` và đúng thứ tự tham số. */
const flat = (m: jest.Mock, i: number) => {
  const [strings, ...values] = m.mock.calls[i]! as [string[], ...Prisma.Sql[]];
  return Prisma.sql(strings, ...values);
};
const sqlOf = (m: jest.Mock, i = 0) => flat(m, i).sql;
const argsOf = (m: jest.Mock, i = 0) => flat(m, i).values;

describe('variation-stock', () => {
  describe('reserveVariationStock', () => {
    it('trừ stock và tăng giữ chỗ trong MỘT câu lệnh, có điều kiện đủ hàng', async () => {
      const { tx, $executeRaw } = mockTx();
      await reserveVariationStock(tx, 'v1', 3);
      const sql = sqlOf($executeRaw);
      expect(sql).toContain('"stock" = "stock" - ');
      expect(sql).toContain('"reservedStock" = "reservedStock" + ');
      // Điều kiện đủ hàng PHẢI nằm trong chính câu UPDATE — đọc rồi ghi là mở khe oversell.
      expect(sql).toContain('"stock" >= ');
      expect(argsOf($executeRaw)).toEqual([3, 3, 'v1', 3]);
    });

    it('0 dòng bị sửa = không đủ hàng', async () => {
      const { tx, $executeRaw } = mockTx();
      $executeRaw.mockResolvedValue(0);
      await expect(reserveVariationStock(tx, 'v1', 3)).resolves.toBe(false);
    });

    it('1 dòng bị sửa = giữ chỗ thành công', async () => {
      const { tx } = mockTx();
      await expect(reserveVariationStock(tx, 'v1', 1)).resolves.toBe(true);
    });

    it('số lượng âm/0/không nguyên → từ chối, KHÔNG chạy SQL (số âm sẽ cộng kho)', async () => {
      const { tx, $executeRaw } = mockTx();
      for (const q of [-5, 0, 1.5, NaN]) {
        await expect(reserveVariationStock(tx, 'v1', q)).resolves.toBe(false);
      }
      expect($executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('restockReturnedVariationStock', () => {
    it('TK-01: chỉ cộng biến thể không có nguồn tồn Pancake (pancakeStock IS NULL), đúng id và số lượng', async () => {
      const { tx, $executeRaw } = mockTx();
      await expect(restockReturnedVariationStock(tx, 'v9', 2)).resolves.toBe(1);
      expect(sqlOf($executeRaw)).toContain('"pancakeStock" IS NULL');
      expect(argsOf($executeRaw)).toEqual([2, 2, 'v9']);
    });

    it('biến thể Pancake bị bỏ qua → trả 0 để caller không đếm vào số đã cộng', async () => {
      const { tx, $executeRaw } = mockTx();
      $executeRaw.mockResolvedValue(0);
      await expect(restockReturnedVariationStock(tx, 'v9', 2)).resolves.toBe(0);
    });

    it('số lượng không dương → không chạm DB', async () => {
      const { tx, $executeRaw } = mockTx();
      await restockReturnedVariationStock(tx, 'v9', 0);
      await restockReturnedVariationStock(tx, 'v9', -1);
      expect($executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('releaseVariationStock', () => {
    it('trả hàng về kho và kẹp giữ chỗ ở 0 (không cho âm)', async () => {
      const { tx, $executeRaw } = mockTx();
      await releaseVariationStock(tx, 'v9', 2);
      const sql = sqlOf($executeRaw);
      expect(sql).toContain('"stock" = "stock" + ');
      // Thiếu GREATEST là reservedStock âm ⇒ lần sync sau thổi phồng tồn kho.
      expect(sql).toContain('GREATEST(0, "reservedStock" - ');
      expect(argsOf($executeRaw)).toEqual([2, 2, 'v9']);
    });

    it('số lượng âm/0 → không làm gì (số âm sẽ TRỪ kho khi đang hoàn đơn)', async () => {
      const { tx, $executeRaw } = mockTx();
      await releaseVariationStock(tx, 'v9', -3);
      await releaseVariationStock(tx, 'v9', 0);
      expect($executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('applyPancakeStock', () => {
    it('ĐÚNG MỘT câu lệnh cho cả hai nhánh (không có khe hở giữa hai lệnh)', async () => {
      const { tx, $executeRaw } = mockTx();
      await applyPancakeStock(tx, 'pv-1', 7);
      expect($executeRaw).toHaveBeenCalledTimes(1);
      const sql = sqlOf($executeRaw);
      // Nhánh dữ liệu cũ (chưa có mốc) giữ nguyên `stock`: nếu ghi đè thì lần deploy đầu tiên
      // là một cú đặt lại tồn kho hàng loạt theo số Pancake — đúng thứ bản vá này đi xoá bỏ.
      expect(sql).toContain('WHEN "pancakeStock" IS NULL THEN "stock"');
      expect(sql).toContain('WHEN "pancakeStock" IS NULL THEN "reservedStock"');
      // Nhánh đã có mốc: nhả phần GIẢM của số Pancake khỏi giữ chỗ.
      expect(sql).toContain('GREATEST(0, "reservedStock" - GREATEST(0, "pancakeStock" - ');
    });

    it('không nội suy giá trị vào chuỗi SQL — số và id đi bằng tham số', async () => {
      const { tx, $executeRaw } = mockTx();
      await applyPancakeStock(tx, "pv-'; DROP TABLE variations; --", 7);
      expect(sqlOf($executeRaw, 0)).not.toContain('DROP TABLE');
      expect(argsOf($executeRaw, 0)).toContain("pv-'; DROP TABLE variations; --");
      expect(argsOf($executeRaw, 0)).toContain(7);
    });

    it('không kèm nguồn số → áp vô điều kiện như cũ, không đọc/ghi mốc nào', async () => {
      const { tx, $executeRaw } = mockTx();
      await expect(applyPancakeStock(tx, 'pv-1', 7)).resolves.toBe(true);
      expect(sqlOf($executeRaw)).not.toMatch(/pancakeStock(EventAt|SyncReadAt|WebhookReceivedAt)/);
      expect(argsOf($executeRaw)).toEqual([7, 7, 7, 7, 'pv-1']);
    });

    it('webhook kèm updated_at → so mốc Pancake với webhook đã áp, so lúc NHẬN với lúc đồng bộ đọc, ghi cả hai mốc trong CÙNG câu (R4-SYNC-2, R5-SYNC-3)', async () => {
      const { tx, $executeRaw } = mockTx();
      const at = new Date('2026-10-14T07:00:02.000Z');
      const receivedAt = new Date('2026-10-14T07:00:03.000Z');
      await applyPancakeStock(tx, 'pv-1', 80, { kind: 'webhook', eventAt: at, receivedAt });
      expect($executeRaw).toHaveBeenCalledTimes(1);
      const sql = sqlOf($executeRaw);
      expect(sql).toContain('"pancakeStockEventAt" = ?');
      expect(sql).toContain('("pancakeStockEventAt" IS NULL OR "pancakeStockEventAt" <= ?)');
      expect(sql).toContain('("pancakeStockSyncReadAt" IS NULL OR "pancakeStockSyncReadAt" < ?)');
      expect(sql).toContain('"pancakeStockWebhookReceivedAt" = GREATEST("pancakeStockWebhookReceivedAt", ?)');
      expect(sql).not.toContain('"pancakeStockSyncReadAt" =');
      const args = argsOf($executeRaw);
      expect(args.filter((a: unknown) => a === at)).toHaveLength(2);
      expect(args.filter((a: unknown) => a === receivedAt)).toHaveLength(3);
      expect(sql).toContain('("pancakeStockEventAt" IS NOT NULL OR "pancakeStockWebhookReceivedAt" IS NULL OR "pancakeStockWebhookReceivedAt" <= ?)');
    });

    it('webhook không có updated_at → không so mốc Pancake, vẫn không áp nếu nhận trước lúc đồng bộ đọc', async () => {
      const { tx, $executeRaw } = mockTx();
      const receivedAt = new Date('2026-10-14T07:00:03.000Z');
      await applyPancakeStock(tx, 'pv-1', 80, { kind: 'webhook', receivedAt });
      const sql = sqlOf($executeRaw);
      expect(sql).not.toContain('pancakeStockEventAt');
      expect(sql).toContain('("pancakeStockSyncReadAt" IS NULL OR "pancakeStockSyncReadAt" < ?)');
      expect(sql).toContain('("pancakeStockWebhookReceivedAt" IS NULL OR "pancakeStockWebhookReceivedAt" <= ?)');
      expect(argsOf($executeRaw).filter((a: unknown) => a === receivedAt)).toHaveLength(3);
    });

    it('lượt đồng bộ → chỉ so lúc đọc với giờ máy chủ (lúc nhận webhook đã áp, lúc đọc của lượt trước), không so với updated_at Pancake', async () => {
      const { tx, $executeRaw } = mockTx();
      const readAt = new Date('2026-10-15T03:00:00.000Z');
      await applyPancakeStock(tx, 'pv-1', 40, { kind: 'sync', readAt });
      expect($executeRaw).toHaveBeenCalledTimes(1);
      const sql = sqlOf($executeRaw);
      expect(sql).not.toContain('pancakeStockEventAt');
      expect(sql).toContain('"pancakeStockSyncReadAt" = ?');
      expect(sql).toContain('("pancakeStockWebhookReceivedAt" IS NULL OR "pancakeStockWebhookReceivedAt" <= ?)');
      expect(sql).toContain('("pancakeStockSyncReadAt" IS NULL OR "pancakeStockSyncReadAt" <= ?)');
      expect(argsOf($executeRaw).filter((a: unknown) => a === readAt)).toHaveLength(3);
    });

    it('0 dòng bị sửa (sự kiện cũ hơn / không có biến thể) → false', async () => {
      const { tx, $executeRaw } = mockTx();
      $executeRaw.mockResolvedValue(0);
      await expect(
        applyPancakeStock(tx, 'pv-1', 90, { kind: 'webhook', eventAt: new Date('2026-10-14T07:00:01.000Z'), receivedAt: new Date() }),
      ).resolves.toBe(false);
    });

    describe('cờ giữ tồn khi Pancake báo 0 (catalog.pancake_ignore_zero_stock)', () => {
      it('cờ tắt: đúng câu lệnh cũ, kể cả khi Pancake báo 0', async () => {
        const off = mockTx();
        const before = mockTx();
        await applyPancakeStock(off.tx, 'pv-1', 0, { kind: 'sync', readAt: new Date(0) }, { keepPositiveOnZero: false });
        await applyPancakeStock(before.tx, 'pv-1', 0, { kind: 'sync', readAt: new Date(0) });
        expect(sqlOf(off.$executeRaw)).toBe(sqlOf(before.$executeRaw));
        expect(sqlOf(off.$executeRaw)).not.toContain('"stock" > 0');
        expect(off.$queryRaw).not.toHaveBeenCalled();
      });

      it('cờ bật mà Pancake báo số dương: áp bình thường, không có điều kiện giữ', async () => {
        const { tx, $executeRaw, $queryRaw } = mockTx();
        const onKept = jest.fn();
        await expect(applyPancakeStock(tx, 'pv-1', 5, undefined, { keepPositiveOnZero: true, onKept })).resolves.toBe(true);
        expect(sqlOf($executeRaw)).not.toContain('"stock" > 0');
        expect($queryRaw).not.toHaveBeenCalled();
        expect(onKept).not.toHaveBeenCalled();
      });

      it('cờ bật và Pancake báo 0: điều kiện "stock" > 0 nằm TRONG câu UPDATE (giữ cả stock lẫn giữ chỗ), vẫn ghi pancakeStock = 0 và mốc', async () => {
        const { tx, $executeRaw, $queryRaw } = mockTx();
        $queryRaw.mockResolvedValue([{ kept: true }]);
        const onKept = jest.fn();
        const readAt = new Date('2026-11-24T03:00:00.000Z');
        await expect(applyPancakeStock(tx, 'pv-1', 0, { kind: 'sync', readAt }, { keepPositiveOnZero: true, onKept })).resolves.toBe(true);
        expect($executeRaw).not.toHaveBeenCalled();
        expect($queryRaw).toHaveBeenCalledTimes(1);
        const sql = sqlOf($queryRaw);
        expect(sql).toContain('WHEN "stock" > 0 OR "pancakeStock" IS NULL THEN "stock"');
        expect(sql).toContain('WHEN "stock" > 0 OR "pancakeStock" IS NULL THEN "reservedStock"');
        expect(sql).toContain('"pancakeStock" = ?');
        expect(sql).toContain('"pancakeStockSyncReadAt" = ?');
        expect(sql).toMatch(/RETURNING "stock" > 0 AS "kept"\s*$/);
        expect(argsOf($queryRaw)).toContain('pv-1');
        expect(onKept).toHaveBeenCalledTimes(1);
      });

      it('cờ bật, Pancake báo 0 mà tồn đã 0 (không giữ gì): áp, không đếm', async () => {
        const { tx, $queryRaw } = mockTx();
        $queryRaw.mockResolvedValue([{ kept: false }]);
        const onKept = jest.fn();
        await expect(applyPancakeStock(tx, 'pv-1', 0, undefined, { keepPositiveOnZero: true, onKept })).resolves.toBe(true);
        expect(onKept).not.toHaveBeenCalled();
      });

      it('cờ bật, số cũ hơn số đã áp (0 dòng): false, không đếm', async () => {
        const { tx, $queryRaw } = mockTx();
        $queryRaw.mockResolvedValue([]);
        const onKept = jest.fn();
        await expect(
          applyPancakeStock(tx, 'pv-1', 0, { kind: 'webhook', receivedAt: new Date() }, { keepPositiveOnZero: true, onKept }),
        ).resolves.toBe(false);
        expect(onKept).not.toHaveBeenCalled();
      });

      it('đọc cờ: chỉ đúng true là bật; thiếu cấu hình, giá trị lạ hay đọc lỗi là tắt', async () => {
        const config = (v: unknown) => ({ get: jest.fn().mockResolvedValue(v) });
        const on = config(true);
        await expect(readKeepPositiveOnZero(on)).resolves.toBe(true);
        expect(on.get).toHaveBeenCalledWith(PANCAKE_IGNORE_ZERO_STOCK_KEY, false);
        for (const v of [false, 'true', 1, null, undefined, {}]) await expect(readKeepPositiveOnZero(config(v))).resolves.toBe(false);
        await expect(readKeepPositiveOnZero(undefined)).resolves.toBe(false);
        await expect(readKeepPositiveOnZero({ get: jest.fn().mockRejectedValue(new Error('db')) })).resolves.toBe(false);
      });
    });
  });

  describe('forcePancakeStock', () => {
    it('đặt lại tuyệt đối và xoá sạch giữ chỗ (lối thoát cho admin)', async () => {
      const { tx, $executeRaw } = mockTx();
      await forcePancakeStock(tx, 'pv-1', 42);
      const sql = sqlOf($executeRaw);
      expect(sql).toContain('"reservedStock" = 0');
      expect(argsOf($executeRaw)).toEqual([42, 42, 'pv-1']);
    });

    it('kèm lúc đọc → mốc đọc của đồng bộ chỉ tiến, không đụng mốc updated_at của webhook', async () => {
      const { tx, $executeRaw } = mockTx();
      const readAt = new Date('2026-10-15T03:00:00.000Z');
      await forcePancakeStock(tx, 'pv-1', 42, { readAt });
      const sql = sqlOf($executeRaw);
      expect(sql).toContain('"reservedStock" = 0');
      expect(sql).toContain('"pancakeStockSyncReadAt" = GREATEST("pancakeStockSyncReadAt", ?)');
      expect(sql).not.toContain('pancakeStockEventAt');
      expect(argsOf($executeRaw)).toEqual([42, 42, readAt, 'pv-1']);
    });

    it('cờ giữ tồn bật và Pancake báo 0 (đồng bộ ?withStock=1): giữ stock + giữ chỗ khi còn hàng, vẫn ghi pancakeStock = 0 và mốc đọc', async () => {
      const { tx, $executeRaw, $queryRaw } = mockTx();
      $queryRaw.mockResolvedValue([{ kept: true }]);
      const onKept = jest.fn();
      const readAt = new Date('2026-10-15T03:00:00.000Z');
      await forcePancakeStock(tx, 'pv-1', 0, { readAt, keepPositiveOnZero: true, onKept });
      expect($executeRaw).not.toHaveBeenCalled();
      const sql = sqlOf($queryRaw);
      expect(sql).toContain('"stock" = CASE WHEN "stock" > 0 THEN "stock" ELSE 0 END');
      expect(sql).toContain('"reservedStock" = CASE WHEN "stock" > 0 THEN "reservedStock" ELSE 0 END');
      expect(sql).toContain('"pancakeStock" = 0');
      expect(sql).toContain('"pancakeStockSyncReadAt" = GREATEST("pancakeStockSyncReadAt", ?)');
      expect(argsOf($queryRaw)).toEqual([readAt, 'pv-1']);
      expect(onKept).toHaveBeenCalledTimes(1);
    });

    it('cờ giữ tồn bật mà Pancake báo số dương, hoặc cờ tắt: ghi đè tuyệt đối như cũ', async () => {
      for (const [n, keepPositiveOnZero] of [[7, true], [0, false]] as const) {
        const { tx, $executeRaw, $queryRaw } = mockTx();
        await forcePancakeStock(tx, 'pv-1', n, { keepPositiveOnZero });
        expect($queryRaw).not.toHaveBeenCalled();
        expect(sqlOf($executeRaw)).toContain('"reservedStock" = 0');
        expect(argsOf($executeRaw)).toEqual([n, n, 'pv-1']);
      }
    });
  });
});

  describe('reserveAvailableVariationStock', () => {
    it('đủ hàng → giữ đúng số yêu cầu, dùng $queryRaw (cần giá trị trả về)', async () => {
      const { tx, $queryRaw } = mockTx();
      $queryRaw.mockResolvedValue([{ reserved: 5 }]);
      await expect(reserveAvailableVariationStock(tx, 'v1', 5)).resolves.toBe(5);
      const sql = ($queryRaw.mock.calls[0]![0] as string[]).join('?');
      expect(sql).toContain('LEAST(');
      expect(sql).toContain('FOR UPDATE');
    });

    it('thiếu hàng → giữ được BAO NHIÊU trả về bấy nhiêu, không throw', async () => {
      const { tx, $queryRaw } = mockTx();
      $queryRaw.mockResolvedValue([{ reserved: 2 }]); // yêu cầu 5, kho chỉ còn 2
      await expect(reserveAvailableVariationStock(tx, 'v1', 5)).resolves.toBe(2);
    });

    it('hết sạch hàng (0 dòng trả về) → 0, không throw', async () => {
      const { tx, $queryRaw } = mockTx();
      $queryRaw.mockResolvedValue([]);
      await expect(reserveAvailableVariationStock(tx, 'v1', 5)).resolves.toBe(0);
    });

    it('số lượng âm/0/không nguyên → từ chối, KHÔNG chạy SQL', async () => {
      const { tx, $queryRaw } = mockTx();
      for (const q of [-1, 0, 1.5, NaN]) {
        await expect(reserveAvailableVariationStock(tx, 'v1', q)).resolves.toBe(0);
      }
      expect($queryRaw).not.toHaveBeenCalled();
    });
  });
