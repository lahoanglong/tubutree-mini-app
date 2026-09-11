import { Prisma } from '@prisma/client';

/**
 * Tồn kho variation — một chỗ duy nhất biết cách cộng/trừ 3 cột đi cùng nhau.
 *
 * ## Vấn đề gốc (P0-3)
 *
 * Đồng bộ catalog Pancake mỗi 15 phút ghi `stock = remain_quantity` TUYỆT ĐỐI. Nếu số Pancake
 * cũ hơn thời điểm đơn cục bộ trừ kho, hàng vừa bán hết được "hồi sinh" ⇒ bán vượt tồn.
 *
 * Câu hỏi chặn suốt hai phiên trước: *Pancake có tự trừ `remain_quantity` khi ta tạo đơn qua
 * API không?* Không có tài liệu trong repo và bảng webhook chưa từng nhận sự kiện thật, nên
 * không trả lời được bằng code.
 *
 * ## Cách thoát: thiết kế ĐÚNG với cả hai câu trả lời
 *
 * - `pancakeStock` — số Pancake báo lần gần nhất (mốc so sánh).
 * - `reservedStock` — số đơn vị ta đã bán mà số Pancake CHƯA phản ánh.
 * - `stock` — tồn kho bán được = `pancakeStock − reservedStock`. Mọi nơi kiểm tồn/hiển thị vẫn
 *   đọc đúng cột `stock` như cũ, không phải sửa một chỗ đọc nào.
 *
 * Khi đồng bộ, phần GIẢM của số Pancake được nhả khỏi `reservedStock`:
 *
 * - Pancake CÓ tự trừ: số giảm đúng bằng đơn của ta ⇒ giữ chỗ nhả hết ⇒ `stock` = số Pancake.
 *   Không trừ hai lần.
 * - Pancake KHÔNG tự trừ: số đứng yên ⇒ giữ chỗ còn nguyên ⇒ `stock` = số Pancake − đơn của ta.
 *   Không hồi sinh hàng đã bán.
 *
 * Nếu kho bán lẻ ngoài app làm số Pancake giảm vì lý do khác, phần nhả đó chỉ là tạm lạc quan
 * trong đúng một chu kỳ rồi tự hội tụ — và vẫn luôn tốt hơn hành vi cũ (ghi đè tuyệt đối).
 *
 * ## Vì sao dùng SQL thô
 *
 * Ba cột phải đổi cùng lúc theo giá trị CŨ của chính chúng. Đọc-rồi-ghi bằng Prisma tạo khoảng
 * hở để một lượt checkout xen vào giữa và bị ghi đè. Trong một câu `UPDATE`, mọi vế phải đều
 * đọc giá trị cũ của hàng nên phép tính nhất quán và nguyên tử.
 */

/** Client hoặc transaction client — helper chạy được ở cả hai. */
export type StockExecutor = Pick<Prisma.TransactionClient, '$executeRaw'>;

/**
 * Giữ chỗ `quantity` đơn vị cho một đơn: `stock -= q`, `reservedStock += q`.
 *
 * Trả `true` nếu còn đủ hàng. Điều kiện `stock >= quantity` nằm TRONG câu UPDATE nên hai đơn
 * cùng tranh đơn vị cuối cùng chỉ một đơn thắng (chống oversell) — giữ đúng ngữ nghĩa cũ của
 * `updateMany({ where: { stock: { gte } } })`.
 */
export async function reserveVariationStock(
  tx: StockExecutor,
  variationId: string,
  quantity: number,
): Promise<boolean> {
  // Phòng thủ chiều sâu: số âm sẽ CỘNG kho thay vì trừ, và số 0 luôn "thành công" mà không giữ
  // chỗ gì. DTO đã chặn ở tầng ngoài, nhưng đây là đường tiền — không tin đầu vào của người gọi.
  if (!Number.isInteger(quantity) || quantity <= 0) return false;
  const affected = await tx.$executeRaw`
    UPDATE "variations"
       SET "stock" = "stock" - ${quantity},
           "reservedStock" = "reservedStock" + ${quantity}
     WHERE "id" = ${variationId} AND "stock" >= ${quantity}
  `;
  return affected > 0;
}

/**
 * Trả hàng về kho khi huỷ/hoàn đơn: `stock += q`, `reservedStock -= q` (không xuống dưới 0).
 *
 * Kẹp ở 0 là bắt buộc: giữ chỗ có thể đã được nhả bởi một lượt đồng bộ trước đó (Pancake đã
 * phản ánh đơn). Để `reservedStock` âm thì lần đồng bộ sau tính `stock = pancakeStock − (số âm)`
 * ⇒ thổi phồng tồn kho, đúng loại lỗi ta đang đi sửa.
 */
export async function releaseVariationStock(
  tx: StockExecutor,
  variationId: string,
  quantity: number,
): Promise<void> {
  // Số âm ở đây là TRỪ kho khi đang hoàn đơn — im lặng và rất khó lần ra. Bỏ qua thì an toàn hơn.
  if (!Number.isInteger(quantity) || quantity <= 0) return;
  await tx.$executeRaw`
    UPDATE "variations"
       SET "stock" = "stock" + ${quantity},
           "reservedStock" = GREATEST(0, "reservedStock" - ${quantity})
     WHERE "id" = ${variationId}
  `;
}

/**
 * Áp số tồn kho Pancake vừa đọc được cho variation (theo `pancakeId`).
 *
 * - Chưa có mốc (`pancakeStock IS NULL`): CHỈ ghi mốc, không đụng `stock`. Nhờ vậy lần deploy
 *   đầu tiên không có cú đặt lại tồn kho hàng loạt, và variation của merchant tự tạo (không
 *   thuộc Pancake) không bao giờ bị ảnh hưởng vì không bao giờ được đồng bộ.
 * - Đã có mốc: nhả phần giảm khỏi `reservedStock` rồi đặt `stock = số mới − giữ chỗ còn lại`.
 */
export async function applyPancakeStock(
  tx: StockExecutor,
  pancakeVariationId: string,
  pancakeStock: number,
): Promise<void> {
  // Một câu duy nhất cho cả hai nhánh: mọi vế phải đọc giá trị CŨ của hàng nên phép tính nhất
  // quán, và không có khoảng hở giữa hai lệnh để một lượt checkout xen vào.
  await tx.$executeRaw`
    UPDATE "variations"
       SET "reservedStock" = CASE
             WHEN "pancakeStock" IS NULL THEN "reservedStock"
             ELSE GREATEST(0, "reservedStock" - GREATEST(0, "pancakeStock" - ${pancakeStock}))
           END,
           "stock" = CASE
             WHEN "pancakeStock" IS NULL THEN "stock"
             ELSE GREATEST(0, ${pancakeStock} - GREATEST(0, "reservedStock" - GREATEST(0, "pancakeStock" - ${pancakeStock})))
           END,
           "pancakeStock" = ${pancakeStock}
     WHERE "pancakeId" = ${pancakeVariationId}
  `;
}

/**
 * Lối thoát CÓ CHỦ ĐÍCH cho admin: tin tuyệt đối số Pancake, xoá mọi giữ chỗ.
 * Dùng khi tồn kho local đã lệch thật và cần đặt lại — không dùng trong luồng tự động.
 */
export async function forcePancakeStock(
  tx: StockExecutor,
  pancakeVariationId: string,
  pancakeStock: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "variations"
       SET "stock" = ${pancakeStock}, "reservedStock" = 0, "pancakeStock" = ${pancakeStock}
     WHERE "pancakeId" = ${pancakeVariationId}
  `;
}
