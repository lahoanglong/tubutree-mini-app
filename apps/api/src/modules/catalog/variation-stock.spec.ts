import {
  applyPancakeStock,
  forcePancakeStock,
  releaseVariationStock,
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
  return { tx: { $executeRaw } as never, $executeRaw };
}
const sqlOf = (m: jest.Mock, i = 0) => (m.mock.calls[i]![0] as string[]).join('?');
const argsOf = (m: jest.Mock, i = 0) => m.mock.calls[i]!.slice(1);

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
  });

  describe('forcePancakeStock', () => {
    it('đặt lại tuyệt đối và xoá sạch giữ chỗ (lối thoát cho admin)', async () => {
      const { tx, $executeRaw } = mockTx();
      await forcePancakeStock(tx, 'pv-1', 42);
      const sql = sqlOf($executeRaw);
      expect(sql).toContain('"reservedStock" = 0');
      expect(argsOf($executeRaw)).toEqual([42, 42, 'pv-1']);
    });
  });
});
