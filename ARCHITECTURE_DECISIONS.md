# ARCHITECTURE DECISIONS — phiên 2026-06-10

## AD-001: Sửa token palette về đúng màu logo (orange primary)
**Bối cảnh:** `tokens.css` dùng green #2E7D4F làm primary CTA. Spec §7.1 có warning rõ:
"Màu chính xác từ logo thật (eyedropped): Primary = cam #E08C1C, Secondary = xanh lá #509018.
Toàn bộ token đã cập nhật theo đúng màu logo." M2 Design System prototype xác nhận scale:
orange {50:#FDF3E3, 100:#FBE4C4, 600:#E08C1C, 700:#B86A10}, green {50:#EEF7D9, 400:#95D222, 600:#509018, 700:#3C6D12}.
**Quyết định:** Migrate token sang palette logo. Giữ alias `--green-*` cũ trỏ sang scale mới
để không phá code cũ trong 1 đêm, nhưng mọi code mới dùng `--primary-*`/`--leaf-*`.
**Trade-off:** App đổi diện mạo (cam thay xanh) — đây là SỬA SAI, không phải redesign.

## AD-002: i18n strings module thay vì hard-code
**Bối cảnh:** Spec §7.5 yêu cầu "Tạo file i18n + dùng key tham chiếu, không hard-code chuỗi vào JSX".
Code hiện tại hard-code 100%.
**Quyết định:** `src/i18n/vi.ts` — object const typed (không cần lib i18next vì chỉ 1 ngôn ngữ,
tiết kiệm bundle). Mọi copy đi qua đây để enforce Voice & Tone.

## AD-003: Error normalization tập trung ở API layer
**Bối cảnh:** Mọi `onError` hiện lấy `Error.message` → user thấy "Request failed with status code 500".
**Quyết định:** `getErrorMessage(e)` trong `services/api.ts`: ưu tiên message backend
(`error.response.data.message` — NestJS BadRequestException trả message Việt sẵn),
fallback theo loại lỗi (timeout/network/5xx) với copy từ i18n. Component không bao giờ
tự diễn dịch AxiosError.

## AD-004: Client-generated Idempotency-Key cho place-order
**Bối cảnh:** Backend đã hỗ trợ idempotencyKey (Order.idempotencyKey unique, service check trùng)
nhưng FE không gửi → double-tap hoặc retry sau timeout có thể tạo 2 đơn.
**Quyết định:** FE sinh UUID khi vào trang checkout (useRef — giữ nguyên suốt phiên checkout,
refresh khi đặt thành công), gửi qua header `Idempotency-Key`. Retry sau lỗi mạng dùng lại key cũ
→ backend trả về đơn đã tạo thay vì tạo mới.

## AD-005: Optimistic update cho cart với rollback + cancel queries
**Bối cảnh:** Cart update hiện chờ server, tap nhanh nhiều lần → các response đua nhau,
UI nhảy số. Spec §7.7 yêu cầu optimistic UI cho add to cart.
**Quyết định:** `onMutate` cancel queries + snapshot + setQueryData ngay;
`onError` rollback snapshot; `onSettled` invalidate. Stepper disable khi giá trị đạt min/max.
Xóa item: optimistic + toast "Hoàn tác" 3.5s (undo = add lại).

## AD-006: Giữ single-page checkout thay vì 3 màn
Xem DESIGN_IMPROVEMENTS.md #2 — quyết định UX, không phải kỹ thuật.

## AD-007: Không thêm animation library
**Bối cảnh:** Bundle limit 1MB. Framer-motion ~30KB gzip + runtime cost trên Samsung A53.
**Quyết định:** CSS keyframes + transitions (compositor-friendly: transform/opacity only)
+ zmp-ui có sẵn AnimationRoutes. Confetti success = CSS particles nhẹ (12 phần tử).
