# Program plan — Retention batch 2 (A+B+C) + Deploy/UAT

> Ngày: 2026-07-05. Chốt với user: làm **tất cả A+B+C tuần tự**, rồi **deploy + UAT 1 lần**.
> Chat AI dùng **DeepSeek + Gemini** (provider-agnostic, key cắm lúc deploy).
> Nếp: mỗi feature 1 branch off main → design → TDD (BE) / typecheck+build (FE) → gate → merge main + push.
> Nền: nhiều thứ đã có sẵn (mua kèm, subscription pause/cancel, referral 2 chiều) — luôn kiểm trước khi build.

## Phase A — Quick wins tự chứa
- **A1. Feed "Dành cho bạn"** — gợi ý cá nhân hoá ở home (rule-based: danh mục đã xem/mua gần đây + bán chạy; loại SP đã mua gần đây). Endpoint `GET /products/for-you`; FE section home. Không cần ML.
- **A2. "Nhắc tôi" flash sale** — model `FlashSaleReminder(userId, flashSaleItemId, notified)`; endpoint đăng ký/huỷ; cron (hoặc hook khi sale mở) notify `FLASH_STARTING`. FE nút "Nhắc tôi" ở card flash + PDP.
- **A3. Point-expiry cron + reminder** — điểm có `expiresAt` nhưng chưa trừ. Cron FIFO: replay ledger/user → phần điểm hết hạn CHƯA tiêu → tạo `POINTS_EXPIRED` (âm) + giảm balance atomic; giữ bất biến `pointsBalance == Σdelta`. Reminder "điểm sắp hết hạn" (tái dùng remarketing/notify). Cẩn trọng: không claw-back điểm đã tiêu.

## Phase B — Chat AI + CSKH
- **B1. Chat AI tư vấn (DeepSeek + Gemini)** — interface `AiProvider` + adapter DeepSeek (OpenAI-compatible) + Gemini (Google Generative Language) + registry (giống CashbackProvider). Nâng `ai-advisor` thành chat hỏi-đáp sản phẩm (context: catalog). Config chọn provider chính + fallback. Key qua env (`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`); test bằng mock; gate bằng env (không key → provider disabled, trả lời fallback tĩnh). FE: màn chat/ai-advisor.
- **B2. Quick-reply/auto-reply CSKH** — kho mẫu tin nhanh (admin cấu hình) + auto-reply/greeting; phía Zalo OA. Trong app: model `QuickReplyTemplate` + admin CRUD + (nếu khả thi) tích hợp OA webhook auto-reply. Phạm vi hạn chế bởi nền tảng Zalo (ghi rõ).

## Phase C — Lớn
- **C1. Season/Battle Pass** — phủ lên `Season` (Vườn Xanh): track nhiệm vụ mùa 2 tuyến (free + premium theo hạng/subscriber), tier reward, tiến độ. Model `SeasonPass`/`SeasonPassTier`/`UserSeasonPass` + claim. FE track mùa.
- **C2. CTV Content Kit** — thư viện per-SP: ảnh/video/caption mẫu/USP/FAQ; nút "Sao chép / Share Zalo". Model `ProductContentKit` (hoặc field trên Product) + admin nhập + FE storefront-builder/affiliate.
- **C3. CTV Lên đơn hộ** — CTV nhập thông tin khách → tạo đơn thay (COD/VietQR) → gắn hoa hồng CTV. Tái dùng checkout + affiliate attribution. Endpoint `POST /affiliate/orders`.
- **C4. CTV Academy** — khoá học nhẹ: bài/video + quiz + chứng nhận onboarding. Tái dùng `feed`/`GameQuiz`. Model `Course`/`Lesson`/`UserCourseProgress`.

## Phase D — Deploy + UAT (1 lần)
- **Tôi làm:** gộp toàn bộ migration mới + seed (config/template), build BE+FE, **UAT tự động trên DB dev** (drive e2e mọi feature mới), viết **runbook deploy** + **checklist UAT Zalo**.
- **User làm:** `prisma migrate deploy` + `prisma db seed` (prod) + `zmp deploy` (miniapp) + deploy web + cắm keys (DEEPSEEK/GEMINI/ZNS) + **UAT trực quan trên Zalo thật**.

## Quyết định đã chốt
- Phạm vi: A+B+C đầy đủ. Chat AI: DeepSeek + Gemini (provider-agnostic, key sau).
- Mỗi feature merge main + push khi gate xanh (nếp dự án).

## Rủi ro/ghi chú
- Chương trình lớn — làm tuần tự, báo tiến độ theo phase.
- Point-expiry money-adjacent → review kỹ (FIFO, không claw-back điểm đã tiêu).
- Lên đơn hộ money-adjacent (hoa hồng) → review kỹ.
- CSKH auto-reply + Chat AI bị giới hạn nền tảng Zalo / cần key → phần "chạy thật" phụ thuộc ops.
