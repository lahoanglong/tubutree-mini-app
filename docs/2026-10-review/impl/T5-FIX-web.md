# T5-FIX-web: sửa 3 lỗi reviewer độc lập (nhánh hz12/web-copy)

| Mục | Commit | Test đỏ → xanh | tsc / eslint |
|---|---|---|---|
| 1. Nhãn "Dùng N Điểm Xanh" ở /thanh-toan | e2370edb | `points-label.spec.tsx`: đỏ (nhãn cũ "Dùng 500...") → xanh; kèm coupon.spec, bank-transfer-panel.spec: 21/21 | sạch / sạch |
| 2. Chi tiết đơn: hotline/email, Zalo OA chỉ khi có cấu hình (Q-17) | e9f10560 | `page.spec.tsx` 3 ca (không OA / có OA / lỗi cấu hình) + `public-support.spec.ts` 1 ca: đỏ 4/4 → xanh; kèm site-footer.spec: 22/22 | sạch / sạch |
| 3. README, DEMO_SCRIPT | d93a08bb | không cần test | không áp dụng |

Lệnh: `npx vitest run <file>`, `npx tsc --noEmit`, `npx eslint <file> --max-warnings=0` trong apps/web.

Ghi chú:
- Mục 1: chưa tick ghi "Bạn có N Điểm Xanh" với N = điểm dùng được của hai lô (không gồm phần bị khoá, đã có dòng lockNote riêng). Đã tick và có quote ghi "Dùng {pointsUsed} Điểm Xanh — giảm X".
- Mục 2: `SupportContact.zaloOaName` là trường tuỳ chọn, chỉ có khi admin cấu hình; DEFAULT_SUPPORT không đổi.
- Mục 3: module backend `beta` vẫn còn (PD-2 xử lý endpoint), nên README ghi "chỉ còn API; trang Beta Tester đã bỏ" thay vì xoá khỏi danh sách.
