# PE-2 — Gỡ /beta/* và rà nhãn CO₂ (PD-2 / Q-19, PD-1)

Nhánh `hz13/PE-2`, base `6739ca0a`. Không đụng tiền, game, loyalty, checkout. Không push, không deploy, không ghi DB nào.

## Mục 1 — gỡ 4 route /beta/* (commit b839aa99)

Đã làm:
- Xoá `apps/api/src/modules/beta/` (controller, module, service, spec) và import/đăng ký `BetaModule` trong `app.module.ts`. 4 route `GET /beta/me`, `POST /beta/join`, `POST /beta/leave`, `POST /beta/feedback` không còn.
- Giữ bảng `beta_testers`, `beta_feedbacks`, không migration xoá. `BetaFeedback` đã có `/// @deprecated` từ trước, lượt này sửa lại lời chú thích cho đúng hiện trạng (không còn code đọc hay ghi, gỡ route). Thêm `/// @deprecated` cho `BetaTester` vì cùng tình trạng. Chỉ đổi comment, `prisma validate` đạt, `prisma format` không sinh thêm khác biệt so với base (base vốn đã lệch 250 dòng định dạng, không phải do gói này).
- `schema-deprecated.spec.ts`: `BetaFeedback` từ `writes: ['create']` xuống `writes: []`, thêm `BetaTester`, thêm `beta_testers` vào danh sách bảng không được gọi SQL thô.
- `endpoint-inventory.spec.ts`: 4 route beta thêm vào bảng REMOVED. Ở lượt này 4 mục đó chưa có tác dụng thật: bảng ROUTES của spec dựng từ danh sách tay 14 controller không có controller nào đăng ký `/beta`, nên thêm lại route `/beta` ở controller ngoài danh sách thì spec vẫn xanh (review độc lập chỉ ra). Chỗ chặn thật ở PE-2 chỉ là `beta-removed.spec.ts`. PE-4 đã dựng ROUTES từ đồ thị `AppModule` qua helper chung `common/route-graph.ts`, mục REMOVED nay đỏ khi bất kỳ controller nào đăng ký lại.
- Khoá cấu hình `beta.features` mất nơi đọc duy nhất nên `dead-config-keys.spec.ts` sẽ đỏ ("mọi khoá được seed đều có code đọc"). Đưa khoá vào `DEAD_CONFIG_KEYS` (admin bị chặn ghi, UI hiện nhãn "Không dùng") và bỏ khỏi `prisma/seed.ts`. Dòng trong DB (do migration `20260625040000_beta_tester` tạo) giữ nguyên.
- `scripts/uiux/generated/miniapp-endpoints.json` sinh lại bằng `node scripts/uiux/extract-endpoints.mjs miniapp`: không còn `/beta`. So tập (method, path) với bản cũ: mất 4 route beta cùng `GET /me/coins`, `POST /wallet/convert-xu` (PD-3 đã gỡ khỏi miniapp, file cũ chỉ là chưa sinh lại); thêm 7 route miniapp mới từ các gói PC trước. Diff dòng lớn vì file chưa được sinh lại từ lúc audit, không riêng do gói này. `web-endpoints.json` không có `/beta`, không sinh lại. Chạy lại lệnh sinh lần nữa cho kết quả y hệt (idempotent).
- `apps/miniapp/src/beta-removed.spec.ts`: logic giữ nguyên (miniapp không có trang, client, route, lối vào beta), chỉ sửa chú thích đầu file vì API đã gỡ. Chạy vẫn xanh. `apps/e2e` và `apps/web` không nhắc beta.
- `scripts/audit/seed-audit-personas.ts` và `scripts/audit/routes.json` giữ nguyên: script seed ghi thẳng vào bảng còn tồn tại (`betaTester`, `betaFeedback`, cấu hình `beta.features`) nên vẫn chạy được, và không nằm trong nhóm file của gói.

Test (viết trước, thấy đỏ đúng lý do):
- Mới `apps/api/src/common/beta-removed.spec.ts`. Danh sách controller lấy từ đồ thị import thật của `AppModule` (đệ quy `imports`), không phải danh sách viết tay. Kiểm (a) không route nào dưới `/beta`; (b) dựng app Nest với đúng các controller đó (guard thay bằng cho qua, dependency mock) rồi gọi HTTP thật `GET /beta/me`, `POST /beta/join`, `POST /beta/leave`, `POST /beta/feedback` đều trả 404; (c) đối chứng `GET /orders` không trả 404, để bộ dựng không làm mọi đường thành 404.
- Đỏ trước khi gỡ: 5/7 ca đỏ (route còn trong đồ thị; 4 lời gọi HTTP trả 201/200 thay vì 404). Hai ca đối chứng xanh. Xanh sau khi gỡ.

## Mục 2 — nhãn CO₂ ở thẻ Tác động xanh (commit fcd20621)

Kết quả rà: HEAD không còn chữ nào về CO₂ ở thẻ này. Ô "CO₂ hấp thụ/năm (ước tính)" (`treesPlanted * 21`) đã bị bỏ ở PD-1 sau review lượt 1 (commit `fee8f36e`, là tổ tiên của base), mạnh hơn việc đổi nhãn thành "ước tính". `tree-fund-copy.spec.ts` đã cấm `CO₂|CO2|hấp thụ` trong toàn bộ mã miniapp (trừ spec), `game-behavior.spec.tsx` đã khoá "không CO₂/kg" ở nhánh chưa góp cây. Dòng ở `00-ROADMAP.md` ghi PD-1 "đổi nhãn thành ước tính" nên coi là đã thoả bằng phương án "ẩn". Quyết định: không thêm lại bất kỳ số CO₂ nào, kể cả có chữ "ước tính", vì sẽ đảo ngược guard hiện có và công thức/số không được đổi.

Đã làm: thêm một ràng buộc vào ca "đóng góp của tôi" (7 cây góp quỹ, nhánh có chứng nhận từng cây, nơi dễ bị thêm lại số kg/cây nhất): `textContent` không khớp `CO₂|CO2|hấp thụ|kg`. Kiểm bằng đột biến: tạm gắn lại ô "~63kg / CO₂ hấp thụ/năm" vào `eco-impact.tsx` thì ca mới và cả hai guard cũ đỏ (3 ca), gỡ ra thì xanh. Mã `eco-impact.tsx` không đổi. Không có bước "đỏ rồi sửa mã" vì không có lỗi để sửa.

`apps/web`: không có thẻ tương tự (không còn chữ CO₂/hấp thụ/carbon trong `apps/web/src`), không thêm guard.

Giữ nguyên, ngoài phạm vi: `apps/api/prisma/seed-game-quiz.ts` còn câu quiz kiến thức chung "Một cây xanh trưởng thành hấp thụ khoảng bao nhiêu CO₂ mỗi năm? ... ~21 kg" (và vài câu khác về CO₂). Đó là nội dung giáo dục về cây nói chung, không nói về cây của khách, và thuộc nhóm game nên không sửa.

## Lệnh kiểm và kết quả thật

```
apps/api: npx jest src/common/beta-removed.spec.ts src/common/schema-deprecated.spec.ts src/common/endpoint-inventory.spec.ts src/modules/system-config src/modules/admin
  exit 0 | Test Suites 16 passed | Tests 328 passed
apps/api: npx tsc --noEmit -p tsconfig.json            exit 0 (đã build packages/shared-types/dist, thư mục bị gitignore)
apps/api: npx eslint --max-warnings=0 <6 file đã sửa>  exit 0
apps/api: DATABASE_URL=<giả> npx prisma validate        exit 0
apps/miniapp: npx vitest run src/pages/game-behavior.spec.tsx src/i18n/tree-fund-copy.spec.ts src/beta-removed.spec.ts src/pages/game-layout.spec.tsx src/pages/settings.spec.tsx
  exit 0 | Test Files 5 passed | Tests 110 passed
apps/miniapp: npx tsc --noEmit                          exit 0
apps/miniapp: npx eslint --max-warnings=0 <3 file>      exit 0
node scripts/uiux/extract-endpoints.mjs miniapp         exit 0 | grep -c "/beta" miniapp-endpoints.json = 0
```

## Chưa verify (unverified)

- Không chạy Playwright, không chạy full suite jest/vitest, không chạy `nest build` hay khởi động API thật (cần DB/Redis). Việc "404 qua HTTP" được kiểm bằng app Nest dựng từ đúng bộ controller của `AppModule` với guard và dependency được thay thế, không phải server thật.
- Không có race spec vì gói không đụng ghi DB; không dùng Postgres/Docker (cổng 5593 không dùng).
- Chưa kiểm `prisma migrate diff` với DB thật; chỉ đổi comment trong `schema.prisma`, và `prisma validate` đạt.
- `apps/web` không chạy vitest (không sửa gì).

## Rủi ro còn lại

- Client cũ của miniapp đã phát hành (trước PD-1) nếu còn gọi `/beta/*` sẽ nhận 404 thay vì dữ liệu; PD-1 đã xoá trang nên chỉ người chưa cập nhật bản. Không ảnh hưởng chức năng khác.
- Bảng `beta_testers` và `beta_feedbacks` giữ dữ liệu khách từ trước mà không còn đường đọc; xoá hẳn cần migration DROP riêng khi chủ dự án quyết.
- `miniapp-endpoints.json` sinh lại từ mã HEAD của nhánh này: các gói khác đổi `apps/miniapp/src/services/**` song song sẽ lệch số dòng (`file:line`) và có thể xung đột khi gộp file sinh ra này; cách xử lý là chạy lại lệnh sinh sau khi gộp.
- Dấu `/// @deprecated` mới trên `BetaTester` đi kèm một dòng trong bảng bằng chứng của `schema-deprecated.spec.ts`: nếu sau này có code dùng `betaTester`, spec đó sẽ đỏ và phải gỡ dấu thay vì sửa spec.
