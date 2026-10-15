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
export type StockExecutor = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;

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
 * Số tồn kho Pancake này tới từ đâu — quyết định so với mốc nào trước khi áp.
 *
 * - `webhook`: `eventAt` = `updated_at` của Pancake (có thể vắng), `receivedAt` = lúc Tubu nhận webhook
 *   (`PancakeWebhookEvent.receivedAt`, giờ máy chủ).
 * - `sync`: `readAt` = lúc lượt đồng bộ danh mục bắt đầu đọc trang Pancake chứa biến thể (giờ máy chủ).
 *
 * Mỗi phép so chỉ so hai mốc cùng một đồng hồ: `updated_at` với `updated_at` (webhook với webhook), giờ máy chủ với giờ máy
 * chủ (webhook với đồng bộ). `updated_at` của Pancake không mang múi giờ và Node đọc nó theo múi giờ của tiến trình (production
 * đặt TZ=Asia/Ho_Chi_Minh), nên so nó với đồng hồ máy chủ lệch nhiều giờ: webhook mới hơn bị bỏ hoặc lượt đồng bộ bị chặn.
 */
export type PancakeStockOrigin =
  | { kind: 'webhook'; receivedAt: Date; eventAt?: Date }
  | { kind: 'sync'; readAt: Date };

/**
 * Phần SET thêm và điều kiện WHERE theo nguồn số — ghép vào CÙNG câu UPDATE áp tồn kho.
 * Webhook nhận đúng mili giây lượt đồng bộ bắt đầu đọc thua lượt đồng bộ ở cả hai thứ tự xử lý: Pancake đọc số sau lúc yêu cầu
 * đi, nên số đồng bộ không cũ hơn số webhook mang theo.
 */
function stockOriginSql(origin: PancakeStockOrigin | undefined): { set: Prisma.Sql; guard: Prisma.Sql } {
  if (!origin) return { set: Prisma.empty, guard: Prisma.empty };
  if (origin.kind === 'sync') {
    const { readAt } = origin;
    return {
      set: Prisma.sql`, "pancakeStockSyncReadAt" = ${readAt}`,
      guard: Prisma.sql`
       AND ("pancakeStockWebhookReceivedAt" IS NULL OR "pancakeStockWebhookReceivedAt" <= ${readAt})
       AND ("pancakeStockSyncReadAt" IS NULL OR "pancakeStockSyncReadAt" <= ${readAt})`,
    };
  }
  const { receivedAt, eventAt } = origin;
  return {
    set: eventAt
      ? Prisma.sql`, "pancakeStockEventAt" = ${eventAt},
           "pancakeStockWebhookReceivedAt" = GREATEST("pancakeStockWebhookReceivedAt", ${receivedAt})`
      : Prisma.sql`, "pancakeStockWebhookReceivedAt" = GREATEST("pancakeStockWebhookReceivedAt", ${receivedAt})`,
    guard: eventAt
      ? Prisma.sql`
       AND ("pancakeStockSyncReadAt" IS NULL OR "pancakeStockSyncReadAt" < ${receivedAt})
       AND ("pancakeStockEventAt" IS NULL OR "pancakeStockEventAt" <= ${eventAt})`
      : Prisma.sql`
       AND ("pancakeStockSyncReadAt" IS NULL OR "pancakeStockSyncReadAt" < ${receivedAt})`,
  };
}

/**
 * Áp số tồn kho Pancake vừa đọc được cho variation (theo `pancakeId`).
 *
 * - Chưa có mốc (`pancakeStock IS NULL`): CHỈ ghi mốc, không đụng `stock`. Nhờ vậy lần deploy
 *   đầu tiên không có cú đặt lại tồn kho hàng loạt, và variation của merchant tự tạo (không
 *   thuộc Pancake) không bao giờ bị ảnh hưởng vì không bao giờ được đồng bộ.
 * - Đã có mốc: nhả phần giảm khỏi `reservedStock` rồi đặt `stock = số mới − giữ chỗ còn lại`.
 *
 * Số tuyệt đối cũ hơn số đã áp là số đã lỗi thời — áp vào là lùi tồn kho (R4-SYNC-2, R5-SYNC-3):
 * - webhook mang `updated_at` cũ hơn webhook đã áp thì không áp;
 * - webhook NHẬN trước lúc lượt đồng bộ đã áp bắt đầu đọc Pancake (hàng đợi chậm, Redis sập rồi xử lý sau) thì không áp;
 * - lượt đồng bộ bắt đầu đọc trước lúc nhận một webhook đã áp thì không ghi đè (webhook có thể mới hơn số nó đọc).
 * Webhook Pancake tự gửi muộn (nhận sau lần đọc nhưng `updated_at` cũ hơn) vẫn được áp: không có mốc cùng đồng hồ nào nói nó
 * cũ hơn, và webhook mới hơn của cùng biến thể hoặc lượt đồng bộ sau sẽ kéo lại.
 * Điều kiện so mốc nằm trong chính câu UPDATE nên hai sự kiện xử lý song song không cùng qua được rồi ghi đè nhau. Không kèm
 * `origin` thì áp vô điều kiện, không đọc/ghi mốc. Trả `false` khi không dòng nào được ghi (không có biến thể, hoặc số cũ hơn số
 * đã áp).
 */
export async function applyPancakeStock(
  tx: StockExecutor,
  pancakeVariationId: string,
  pancakeStock: number,
  origin?: PancakeStockOrigin,
): Promise<boolean> {
  // Một câu duy nhất cho cả hai nhánh: mọi vế phải đọc giá trị CŨ của hàng nên phép tính nhất
  // quán, và không có khoảng hở giữa hai lệnh để một lượt checkout xen vào.
  const { set, guard } = stockOriginSql(origin);
  const affected = await tx.$executeRaw`
    UPDATE "variations"
       SET "reservedStock" = CASE
             WHEN "pancakeStock" IS NULL THEN "reservedStock"
             ELSE GREATEST(0, "reservedStock" - GREATEST(0, "pancakeStock" - ${pancakeStock}))
           END,
           "stock" = CASE
             WHEN "pancakeStock" IS NULL THEN "stock"
             ELSE GREATEST(0, ${pancakeStock} - GREATEST(0, "reservedStock" - GREATEST(0, "pancakeStock" - ${pancakeStock})))
           END,
           "pancakeStock" = ${pancakeStock}${set}
     WHERE "pancakeId" = ${pancakeVariationId}${guard}
  `;
  return affected > 0;
}

/**
 * Lối thoát CÓ CHỦ ĐÍCH cho admin: tin tuyệt đối số Pancake, xoá mọi giữ chỗ.
 * Dùng khi tồn kho local đã lệch thật và cần đặt lại — không dùng trong luồng tự động.
 * `readAt` (lúc bắt đầu đọc trang Pancake, giờ máy chủ): mốc đọc chỉ tiến, không lùi — webhook nhận trước lần đọc mà xử lý sau
 * không ghi đè số vừa đặt lại.
 */
export async function forcePancakeStock(
  tx: StockExecutor,
  pancakeVariationId: string,
  pancakeStock: number,
  opts: { readAt?: Date } = {},
): Promise<void> {
  const { readAt } = opts;
  if (readAt) {
    await tx.$executeRaw`
    UPDATE "variations"
       SET "stock" = ${pancakeStock}, "reservedStock" = 0, "pancakeStock" = ${pancakeStock},
           "pancakeStockSyncReadAt" = GREATEST("pancakeStockSyncReadAt", ${readAt})
     WHERE "pancakeId" = ${pancakeVariationId}
  `;
    return;
  }
  await tx.$executeRaw`
    UPDATE "variations"
       SET "stock" = ${pancakeStock}, "reservedStock" = 0, "pancakeStock" = ${pancakeStock}
     WHERE "pancakeId" = ${pancakeVariationId}
  `;
}

/**
 * Giữ chỗ TỐI ĐA có thể (`min(stock hiện có, quantity)`), không bao giờ throw vì thiếu hàng.
 * Trả về số đơn vị THỰC SỰ giữ được — 0 nếu hết sạch, bằng `quantity` nếu đủ.
 *
 * Dùng cho đơn ĐẠI LÝ được phép đặt trước (backorder): phần `quantity - đã giữ` ghi vào
 * `OrderItem.backorderedQty` thay vì từ chối cả đơn. Đơn thường (checkout/CTV/subscription)
 * vẫn dùng `reserveVariationStock` — tất-cả-hoặc-không, không đổi hành vi.
 *
 * Một câu UPDATE duy nhất (CTE `old` khoá đúng 1 dòng qua `FOR UPDATE`) để "số giữ được" và
 * "số trừ đi" luôn khớp nhau dưới tải đồng thời — không có khoảng hở đọc-rồi-ghi.
 */
export async function reserveAvailableVariationStock(
  tx: StockExecutor,
  variationId: string,
  quantity: number,
): Promise<number> {
  if (!Number.isInteger(quantity) || quantity <= 0) return 0;
  const rows = await tx.$queryRaw<{ reserved: number }[]>`
    WITH old AS (SELECT "stock" FROM "variations" WHERE "id" = ${variationId} FOR UPDATE)
    UPDATE "variations" v
       SET "stock" = old."stock" - LEAST(old."stock", ${quantity}),
           "reservedStock" = v."reservedStock" + LEAST(old."stock", ${quantity})
      FROM old
     WHERE v."id" = ${variationId}
    RETURNING LEAST(old."stock", ${quantity})::int AS reserved
  `;
  return rows[0]?.reserved ?? 0;
}
