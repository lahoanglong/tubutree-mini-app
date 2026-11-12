/** Bảng SKU Fuwa3e dùng chung cho kịch bản câu chuyện (app-core) và chữ dự phòng (shared-types, api, web, Mini). Thuần dữ liệu, không phụ thuộc React hay DOM. */

/**
 * Kịch bản theo SKU cho 6 sản phẩm Pineboo và 39 sản phẩm Fuwa3e còn hàng trên PROD (ảnh chụp catalog 12/11/2026) chưa có kịch bản riêng ở `LAUNCH_STORY_PRESETS` (app-core).
 * Nguồn: tên sản phẩm và chữ in trên ảnh bao bì của từng SKU, đã đối chiếu. Bao bì Pineboo và Fuwa3e in eco-enzyme lên men từ vỏ dứa; KHÔNG có
 * thân tre hay sợi tre nào (mô tả Pineboo là tre/tăm bông/khăn giấy là sai). Ảnh vài SKU lệch tên (ảnh "nước rửa chén 100ml" mang tiêu đề bồn cầu)
 * nên chữ chỉ lấy khi khớp tên SKU. Câu bao bì cần giấy tờ (diệt khuẩn kèm %, chứng chỉ, Vegan, "an toàn", xua đuổi côn trùng) không chép lại:
 * `story-presets-launch.spec.ts` chặn bằng `copy-claims-guard.ts`. Muối rửa chén cho máy 2kg cố ý không có kịch bản riêng vì bao bì không nêu enzyme;
 * nó nhận kịch bản cấp nhãn (`brand-story.ts`).
 *
 * Hàng bảng Fuwa3e: [loại hàng như trong tên, quy cách, bậc, hương]. Bậc 2 = bao bì ghi enzyme lên men từ vỏ dứa; bậc 1 = chỉ thấy logo Enzyme Cleaner
 * hay "Eco-enzyme làm nền tảng"; bậc 0 = SKU chưa có ảnh bao bì để đối chiếu nên chỉ nói đúng điều tên đã nêu (thương hiệu, loại hàng, quy cách).
 * Hương lấy từ tên SKU, hoặc từ dòng "HƯƠNG ..." in trên nhãn đúng loại hàng đó.
 */
export type FuwaRow = readonly [type: string, size: string, tier: 0 | 1 | 2, scent?: string];
export const FUWA3E_SKUS: Record<string, FuwaRow> = {
  'refill-nuoc-rua-tay-dang-bot-fuwa3e-10l': ['Refill Nước rửa tay dạng Bọt', '10L', 0],
  'lau-noi-that-o-to-fuwa3e-300ml': ['Lau nội thất ô tô', '300ml', 0],
  'xit-khu-mui-o-to-fuwa3e-150ml': ['Xịt khử mùi ô tô', '150ml', 0],
  'xit-thom-huong-xuan-fuwa3e-300ml': ['Xịt thơm hương Xuân', '300ml', 0, 'Xuân'],
  'refill-nuoc-lau-san-que-fuwa3e-10l': ['Refill Nước lau sàn Quế', '10L', 2, 'Quế'],
  'nuoc-lau-san-sa-chanh-fuwa3e-100ml': ['Nước lau sàn Sả chanh', '100ml', 2, 'Sả chanh'],
  'nuoc-ngam-rua-thuc-pham-fuwa3e-100ml': ['Nước ngâm rửa thực phẩm', '100ml', 2],
  've-sinh-nha-tam-va-toilet-fuwa3e-100ml': ['Vệ sinh nhà tắm và toilet', '100ml', 2],
  'refill-nuoc-giat-bac-ha-fuwa3e-10l': ['Refill nước giặt Bạc hà', '10L', 2, 'Bạc hà'],
  'nuoc-giat-huong-bac-ha-fuwa3e-3-5l': ['Nước giặt hương Bạc hà', '3,5L', 2, 'Bạc hà'],
  'nuoc-giat-huong-bac-ha-fuwa3e-500ml': ['Nước giặt hương Bạc hà', '500ml', 1, 'Bạc hà'],
  'nuoc-giat-huong-bac-ha-fuwa3e-100ml': ['Nước giặt hương Bạc hà', '100ml', 2, 'Bạc hà'],
  'nuoc-giat-huong-cam-fuwa3e-500ml': ['Nước giặt hương Cam', '500ml', 2, 'Cam'],
  'nuoc-giat-huong-cam-fuwa3e-100ml': ['Nước giặt hương Cam', '100ml', 2, 'Cam'],
  'nuoc-rua-tay-dang-bot-fuwa3e-3-8l': ['Nước rửa tay dạng Bọt', '3,8L', 2, 'Quýt'],
  'nuoc-rua-tay-dang-bot-fuwa3e-300ml': ['Nước rửa tay dạng Bọt', '300ml', 2, 'Quýt'],
  'refill-nuoc-rua-tay-dang-gel-fuwa3e-10l': ['Refill Nước rửa tay dạng Gel', '10L', 2],
  'gel-rua-chen-cho-may-fuwa3e-500ml': ['Gel rửa chén cho máy', '500ml', 1, 'Cam'],
  'gel-rua-chen-cho-may-fuwa3e-100ml': ['Gel rửa chén cho máy', '100ml', 2, 'Cam'],
  'lau-da-nang-fuwa3e-2l': ['Lau đa năng', '2L', 2, 'Nhu'],
  've-sinh-nha-tam-va-toilet-fuwa3e-2l': ['Vệ sinh nhà tắm và toilet', '2L', 2, 'Khuynh diệp'],
  'nuoc-rua-tay-dang-gel-fuwa3e-300ml': ['Nước rửa tay dạng Gel', '300ml', 2, 'Quýt'],
  'nuoc-lau-ban-tho-fuwa3e-500ml': ['Nước lau bàn thờ', '500ml', 1, 'Quế'],
  'nuoc-giat-do-lot-fuwa3e-500ml': ['Nước giặt đồ lót', '500ml', 2, 'Chanh vàng'],
  'refill-nuoc-ngam-rua-thuc-pham-fuwa3e-10l': ['Refill Nước ngâm rửa thực phẩm', '10L', 2],
  'refill-nuoc-lau-san-sa-chanh-fuwa3e-10l': ['Refill Nước lau sàn Sả chanh', '10L', 2, 'Sả chanh'],
  'refill-nuoc-giat-cam-fuwa3e-10l': ['Refill nước giặt Cam', '10L', 2, 'Cam'],
  'refill-nuoc-rua-chen-fuwa3e-10l': ['Refill Nước rửa chén', '10L', 2],
  'nuoc-ngam-rua-thuc-pham-fuwa3e-1l': ['Nước ngâm rửa thực phẩm', '1L', 2],
  'nuoc-lau-da-nang-fuwa3e-500ml': ['Nước lau đa năng', '500ml', 2, 'Nhu'],
  'nuoc-lau-san-sa-chanh-fuwa3e-1l': ['Nước lau sàn Sả chanh', '1L', 1, 'Sả chanh'],
  'nuoc-rua-tay-dang-gel-fuwa3e-3-8l': ['Nước rửa tay dạng Gel', '3,8L', 2, 'Quýt'],
  'nuoc-ngam-rua-thuc-pham-fuwa3e-3-8l': ['Nước ngâm rửa thực phẩm', '3,8L', 2],
  'nuoc-ho-tro-xa-lam-bong-fuwa3e-500ml': ['Nước hỗ trợ xả & làm bóng', '500ml', 1],
  'refill-ve-sinh-bon-cau-fuwa3e-10l': ['Refill Vệ sinh bồn cầu', '10L', 2],
  'refill-gel-rua-chen-cho-may-fuwa3e-10l': ['Refill Gel rửa chén cho máy', '10L', 2],
  'refill-lau-da-nang-fuwa3e-10l': ['Refill Lau đa năng', '10L', 2],
  've-sinh-nha-tam-va-toilet-fuwa3e-500ml': ['Vệ sinh nhà tắm và toilet', '500ml', 2],
  'nuoc-giat-huong-cam-fuwa3e-3-5l': ['Nước giặt hương Cam', '3,5L', 1, 'Cam'],
};
