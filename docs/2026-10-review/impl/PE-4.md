# PE-4 — Dọn tham chiếu /beta còn sót sau PE-2

Nhánh `hz14/PE-4`, base `03293ee5`. Không đụng tiền, loyalty, checkout, logic nghiệp vụ. Không push, không deploy, không ghi DB nào, không dùng Docker/Postgres (cổng 5595 không dùng).

## Mục 1 — script audit và uiux (commit 4a2ce658)

Đã làm:
- `scripts/audit/routes.json` và bộ dựng của nó trong `seed-audit-personas.ts` (`buildRoutes`): gỡ mẫu `/beta`. `routes.json` là file sinh ra từ seed nên sửa cả hai nơi; so danh sách `pattern` trong `buildRoutes` với `routes.json` thấy trùng nhau (42 mẫu miniapp). Không sinh lại bằng seed vì cần DB audit.
- Cùng chỗ đó ghi chú "41 paths + `*` = 42 `<Route>`" của `app.tsx` sai một đơn vị sau khi `/beta` bị xoá (đếm `<Route ` trong `apps/miniapp/src/components/app.tsx` ra 41 gồm cả `*`), sửa thành "40 paths + `*` = 41".
- `seed-audit-personas.ts`: bỏ khối gieo `betaTester` x2 và `betaFeedback` x1 (comment `// Beta.`), bỏ `cfg('beta.features', ...)`, bỏ chữ "beta" trong tiêu đề mục 9.
- `scripts/uiux/scorecard.mjs`: bỏ dòng `beta:` trong bảng điểm thủ công `M`. Dòng này chỉ được dùng khi kết quả chụp có id `beta`, mà `scripts/uiux/routes.mjs` không còn trang đó.
- Rà `grep -rniI beta scripts apps/e2e apps/miniapp/src apps/web/src`: chỗ còn lại chỉ là các spec chặn (`apps/miniapp/src/beta-removed.spec.ts`, `settings.spec.tsx`) và phần dọn trong `cleanup()` nói dưới. `apps/e2e`, `apps/web/src` không nhắc beta. `scripts/uiux/generated/*.json` đã sạch từ PE-2. `docs/2026-10-review/04-uiux.md` là tài liệu audit lịch sử nên giữ.

Quyết định thiết kế:
- Gỡ hết phần gieo dữ liệu beta: bảng `beta_testers`, `beta_feedbacks` còn nhưng không code nào đọc, gieo vào chỉ để một trang đã xoá có dữ liệu để chụp, giữ lại chỉ làm audit DB phình thêm dòng chết.
- Gỡ `cfg('beta.features')`: khoá nằm trong `DEAD_CONFIG_KEYS` (PE-2), không còn nơi đọc. Dòng gốc trong DB do migration `20260625040000_beta_tester` tạo (giá trị `[]`) nên audit DB vẫn có dòng, không phụ thuộc seed audit.
- GIỮ hai dòng `deleteMany` của `betaFeedback`, `betaTester` trong `cleanup()`, thêm một câu giải thích lý do. Cleanup có hợp đồng "xoá mọi thứ audit user từng sở hữu"; DB audit dựng từ bản seed cũ có thể còn dòng beta của persona, và xoá chúng không rủi ro (bảng còn, không DROP). Gỡ phần này mới là chỗ rủi ro hơn: dòng cũ nằm lại vĩnh viễn. (FK đều `onDelete: Cascade` nên không gây lỗi ràng buộc dù giữ hay gỡ; lý do giữ là dọn sạch, không phải để tránh lỗi.)
- Không đụng schema, bảng `BetaFeedback`/`BetaTester` giữ nguyên.

Test (viết trước, thấy đỏ đúng lý do): mới `apps/api/src/common/beta-removed-audit.spec.ts` (5 ca), đọc thẳng `scripts/audit/**` và `scripts/uiux/**` (cùng kiểu spec `dead-config-keys.spec.ts` đã đọc `prisma/seed.ts`). Chặn: không file nào nhắc `'/beta'`; `routes.json` không có mẫu miniapp `/beta`; seed không còn `prisma.betaTester|betaFeedback.create` hay `'beta.features'` (deleteMany vẫn được phép); `scorecard.mjs` không còn dòng `beta:`; ca dò đúng để chắc không quét rỗng. Trước khi sửa: 4/5 ca đỏ (ca "quét đủ file" xanh), mỗi ca đỏ chỉ đúng dòng sót. Sau khi sửa: 5/5 xanh.

## Mục 2 — endpoint-inventory dựng từ đồ thị AppModule (commit 043018de)

Chọn phương án (a): gọn vì `beta-removed.spec.ts` của PE-2 đã có sẵn logic đi đồ thị module.

Đã làm:
- Mới `apps/api/src/common/route-graph.ts` (không phải spec, không phụ thuộc `AppModule`): `collectControllers(root)`, `routesOf(controller)`, `guardsOf(controller)`, chuyển nguyên logic từ `beta-removed.spec.ts`. Format route của hai spec cũ giống nhau (`GET /orders/:code/cancel`), nên không đổi hành vi.
- `beta-removed.spec.ts` dùng helper chung, bỏ phần tự định nghĩa; logic kiểm giữ nguyên.
- `endpoint-inventory.spec.ts`: bỏ 14 import controller viết tay, `joinPath`, `routesOf` riêng; `ROUTES = collectControllers(AppModule).flatMap(routesOf)`. Thêm `jest.mock('../config/env.validation')` giống `beta-removed.spec.ts` (ConfigModule validate ngay lúc import AppModule), và một ràng buộc `ROUTES.size > 100` để biết dò đúng. Cả 4 mục REMOVED `/beta/*` giữ nguyên, các bảng REMOVED/KEPT_WITHOUT_FE khác giữ nguyên và vẫn xanh trên đồ thị đầy đủ (nên mọi controller trong danh sách tay cũ đều nằm trong AppModule).
- `docs/2026-10-review/impl/PE-2.md`: sửa đúng một câu về `endpoint-inventory.spec.ts` (câu cũ nói 4 mục REMOVED chặn việc thêm lại route, thực tế chúng không bao giờ đỏ). Câu về `scripts/audit` "giữ nguyên" của PE-2 là ghi lại việc PE-2 đã làm nên không sửa; PE-4 là nơi ghi phần dọn.

Bằng chứng đột biến (tạm thêm `@Controller('beta')` giả vào `WishlistModule`, một module nằm ngoài danh sách 14 controller cũ, rồi gỡ):
- Spec cũ (danh sách tay) với 1 route giả `GET /beta/me`: `endpoint-inventory.spec.ts` XANH (đúng lỗ hổng review PE-2 chỉ ra), `beta-removed.spec.ts` đỏ 2 ca.
- Spec mới, 1 route giả: `endpoint-inventory.spec.ts` đỏ đúng ca `GET /beta/me đã gỡ, không còn handler`.
- Spec mới, đủ 4 route giả (`GET me`, `POST join|leave|feedback`): `endpoint-inventory.spec.ts` đỏ 4/4 mục REMOVED `/beta/*`; `beta-removed.spec.ts` đỏ 5 ca (1 ca đồ thị, 4 ca HTTP 404).
- Gỡ đột biến (xoá đúng đoạn đã thêm ở controller và module; `git diff` của `apps/api/src/modules` rỗng): cả ba spec xanh, 36/36 ca.

## Lệnh kiểm và kết quả thật

```
apps/api: npx jest src/common/beta-removed-audit.spec.ts   (trước sửa)   4 failed, 1 passed
apps/api: npx jest src/common/beta-removed-audit.spec.ts   (sau sửa)     exit 0 | 5 passed
apps/api: npx jest src/common src/modules/system-config    exit 0 | Test Suites 24 passed | Tests 344 passed
apps/api: npx tsc --noEmit -p tsconfig.json                exit 0
apps/api: npx eslint --max-warnings=0 route-graph.ts endpoint-inventory.spec.ts beta-removed.spec.ts beta-removed-audit.spec.ts   exit 0
node -e JSON.parse(routes.json)                            exit 0
node --check scripts/uiux/scorecard.mjs                    exit 0
tsc transpileModule (chỉ cú pháp) seed-audit-personas.ts   0 chẩn đoán cú pháp
```

## Chưa verify (unverified)

- Chưa chạy `seed-audit-personas.ts` thật (cần DB `tubutree_audit` cô lập và `.audit/api.env`): chỉ kiểm cú pháp và đối chiếu `buildRoutes` với `routes.json`. Chưa kiểm kiểu TypeScript đầy đủ của file này (chạy bằng `tsx`, không nằm trong `tsc` của package nào). Phần xoá khối seed chỉ gỡ lệnh, không đổi biến dùng chung (`A`, `CTV`, `at` vẫn được dùng ở chỗ khác).
- Chưa chạy `scripts/uiux/scorecard.mjs` (cần `results/*.jsonl` sinh ra từ lượt chụp), chỉ `node --check`.
- Không chạy Playwright, full suite jest/vitest, vitest của miniapp/web (không sửa gì ở đó), `nest build`.
- `routes.json` sửa tay theo đúng khối mà bộ dựng không còn sinh; trường `generatedAt` giữ nguyên (không sinh lại).

## Rủi ro còn lại

- `route-graph.ts` nằm trong `src/common` nên được `nest build` biên dịch vào `dist` (tsconfig.build chỉ loại `*.spec.ts`). Nó chỉ dùng `reflect-metadata` và hằng số `@nestjs/common`, không import `AppModule`, không có tác dụng lúc chạy. Nếu muốn tách khỏi bản build thì cần đổi tsconfig.build, ngoài nhóm file của gói.
- `endpoint-inventory.spec.ts` giờ import cả `AppModule` nên chậm hơn lúc nạp (cỡ hai giây) và đỏ theo nếu `AppModule` không import được; đổi lại bảng ROUTES phản ánh app thật. Module khai báo bằng Promise (`import()` động) bị bỏ qua khi đi đồ thị vì không đọc được metadata; grep không thấy module nào của `src` khai báo kiểu đó (`BullModule.forRootAsync` trả DynamicModule thường, đi được). Nếu sau này có, controller sau nó sẽ không được dò.
- Ngoài phạm vi, không sửa: một số dòng ở `docs/` và migration cũ vẫn nhắc beta (lịch sử). Tên route/seed beta trong `04-uiux.md` là bản ghi audit.
