# PE-1b — Miniapp: chống bấm đôi trang Vườn, Idempotency-Key khi góp quỹ cây, cảnh báo React `key` trùng

Chỉ sửa `apps/miniapp` (trang Vườn, `components/game`, `services/game-api.ts`). Không đụng `apps/api`, không đụng `apps/web`. Gói PE-1a (BE đọc header `Idempotency-Key`) chạy song song, chưa có trong nhánh này.

| Mục | Trạng thái | Commit |
| --- | --- | --- |
| 1. Khoá chống chạm đúp cho mọi nút ghi của trang Vườn | XONG | 5c6d46c2 |
| 2. `Idempotency-Key` cho `POST /game/tree/buy` theo từng hộp xác nhận | XONG | cba9a281 |
| 3. Cảnh báo `key` trùng: phân loại, sửa phần do mã | XONG | f5f7510e |

## Mục 1 — chạm đúp ở trang Vườn

Nguyên nhân: nút chỉ khoá bằng `disabled={mutation.isPending}`, mà cờ này chỉ đúng sau lần dựng lại kế tiếp. Hai cú chạm trong cùng một khung hình đều thấy nút còn bật nên gọi API hai lần. Test cũ ("chạm lần 2 khi chưa phản hồi") không bắt được vì `fireEvent.click` bọc `act` và dựng lại sau từng cú chạm.

Đã làm: hook mới `components/game/use-locked-mutation.ts` bọc `useMutation`, `mutate` bỏ qua cú gọi khi cùng đích còn đang chạy (khoá bằng ref đồng bộ), nhả ở `onSettled` nên lỗi mạng không làm nút chết. Áp cho 11 thao tác ghi trong `use-game-actions.ts`: điểm danh, hứng sương, mua vé giữ lửa, hồi sinh chuỗi, tưới cây, mở lô, tưới lô, tặng nước, nhận nhiệm vụ, trả lời quiz, nhận thưởng Chặng Mùa.

Quyết định thiết kế:
- Khoá chia theo đích thao tác (`keyOf`): lô đất theo `plotId`, tặng nước theo `recipientId`, nhiệm vụ theo `code`, Chặng Mùa theo `tier:track`, quiz theo `id`. Trước đây tưới lô A không khoá nút lô B; giữ nguyên điều đó, chỉ cú lặp vào cùng đích bị bỏ qua.
- Hook không trả `mutateAsync` để không ai vô tình đi vòng qua khoá.
- Vòng quay đã có `lockRef` trong `components/wheel.tsx` (và test chạm đúp trong `wheel.spec.tsx`), không đổi.
- Góp quỹ cây không dùng hook này: khoá nằm ở `TreeActions` vì ở đó cần biết kết quả (xem mục 2).

Test: `pages/game-busy-lock.spec.tsx`, 18 ca. Mỗi ca dồn hai lần `click()` vào MỘT `act` (tái hiện đúng chạm đúp cùng khung hình) rồi đếm lời gọi API: 11 thao tác + hai đáp án quiz khác nhau + góp quỹ + tưới hai lô khác nhau vẫn gọi song song + tặng nước hai bạn vẫn song song + nhả khoá sau lỗi/sau thành công. Đỏ trước khi sửa: `17 failed | 1 passed` đều với lý do "called 1 times, but got 2 times" (ca góp quỹ xanh sẵn vì `TreeActions` đã có ref). Xanh sau khi sửa: `18 passed`.

## Mục 2 — Idempotency-Key khi góp quỹ cây

- `services/game-api.ts`: `buyTree(idempotencyKey)` gửi header `Idempotency-Key`, không body.
- `components/game/tree-actions.tsx`: mỗi lần mở hộp xác nhận sinh key mới bằng `newIdempotencyKey()` có sẵn (`utils/idempotency.ts`: `crypto.randomUUID()` UUID v4 nguyên dạng có gạch; WebView thiếu thì `idk-<thời gian>-<ngẫu nhiên>`; cả hai khớp hợp đồng 8–128 ký tự `[A-Za-z0-9_-]`, test kiểm cả hai nhánh bằng regex của hợp đồng).
- `onBuy(key)` trả `Promise<boolean>` (true = thành công). Thành công thì đóng hộp và bỏ key; lỗi thì hộp ở lại và "Xác nhận" gửi lại đúng key cũ; huỷ rồi mở lại hoặc góp xong rồi mở lại thì key mới.
- `pages/game.tsx` truyền `buyTreeM.mutateAsync(key).then(() => true, () => false)`; thông báo lỗi vẫn do `onError` của hook phát như trước.

Thay đổi hiển thị cần chủ dự án biết: trước đây hộp xác nhận đóng ngay khi bấm "Xác nhận". Giờ hộp ở lại (nút "Xác nhận" quay) tới khi có kết quả, đóng khi thành công, ở lại khi lỗi để thử lại. Đang gửi thì "Huỷ", nút X, bấm nền và vuốt đóng đều bị chặn. Đây là điều kiện để "thử lại sau lỗi mạng với cùng key" có nghĩa: nếu hộp đóng ngay thì mọi lần thử lại đều là hộp mới, tức key mới, và key không còn bảo vệ được ca "server đã trừ điểm nhưng phản hồi bị mất".

Test: `components/game/tree-actions.spec.tsx` (10 ca, viết lại theo hợp đồng mới), `services/game-api.spec.ts` (1 ca), 2 ca ở `pages/game-behavior.spec.tsx` (key đúng hợp đồng; lỗi mạng giữ hộp và gửi lại cùng key, thành công đóng hộp, mở lại ra key khác). Đỏ trước khi sửa: `1 failed` ở `game-api.spec.ts` (header không có), `6 failed | 4 passed` ở `tree-actions.spec.tsx` (key là `undefined`, hộp đóng sớm). Xanh sau khi sửa.

## Mục 3 — cảnh báo React "two children with the same key"

Cách tái hiện: chạy bộ giả `scripts/uiux/lib/fabricate.mjs` trên lược đồ trong `scripts/uiux/generated/*.json`, dựng component bằng vitest/jsdom và đếm `console.error` có "same key" (spec tạm, đã xoá, không commit).

| Nơi | Khoá | Nguồn lỗi | Xử lý |
| --- | --- | --- | --- |
| `components/game/weekly-leaderboard.tsx`, bục top 3 | `r.rank` lẫn `idx` | **Do mã, dữ liệu thật**: BE đánh `rank = i + 1`; chỉ 2 người thì ô hạng 2 (key "2") va ô trống thứ ba (`idx` 2). | Sửa: key theo vị trí ô. Hiển thị không đổi. Test bắt `console.error`, đỏ rồi xanh. |
| `season-leaderboard.tsx`, bảng top góp nước mùa; `weekly-leaderboard.tsx`, hạng 4+ | `r.rank` | Dữ liệu giả: bộ giả sinh `rank` từ `[2,5,12]` nên lặp (12, 2, 5, 12). BE trả 1..N. | Không sửa mã. |
| `season-pass.tsx` | `t.tier` | Dữ liệu giả: `tier` lặp như trên. BE `tier = i` (chỉ số). Thêm nữa khối này đang tắt bằng cờ `SEASON_PASS_ENABLED`. | Không sửa mã. |
| `pages/loyalty.tsx`, 7 ô điểm danh | `r.day` | Dữ liệu giả: `day` lặp (12, 2, 5, 12). BE trả 1..7. | Không sửa mã. |
| `apps/web` admin-config, "Tất cả tham số" | `${key}:${JSON.stringify(value)}` | Dữ liệu giả: mọi dòng `key` = "Nội dung mẫu", `value` = null. Cột `key` của `SystemConfig` là khoá chính, nên dữ liệu thật không lặp. | Không sửa mã, không sửa `apps/web`. |

Số đo bộ giả (cảnh báo "same key"): trạng thái `normal`: bảng mùa 1, Chặng Mùa 1, loyalty 1, admin-config 3 (trên 4 dòng). Trạng thái `long`: bảng tuần 22, bảng mùa 25, Chặng Mùa 25, loyalty 25, admin-config 27 (trên 28 dòng). Bảng tuần chỉ phát ở `long` vì hạng 4+ chỉ có 1 dòng ở `normal`.

Test giữ lại (không đổi hành vi): `components/game/weekly-leaderboard.spec.tsx` (1, 2, 3, 4, 7 người không cảnh báo; 2 người vẫn xếp 🥈 🥇 và không có 🥉), một ca ở `game-behavior.spec.tsx` dựng mọi danh sách của trang Vườn bằng dữ liệu đúng hình API (bảng tuần 2 người, bảng mùa, nhiệm vụ, rừng, sổ tay, bạn bè, lô đất, Chặng Mùa) và một ca ở `loyalty-behavior.spec.tsx` (mã giảm giá, 7 ô điểm danh, hạng, quà, lịch sử) đều khẳng định không có cảnh báo key. Ca loyalty và các danh sách khác xanh ngay vì không có lỗi mã ở đó.

Việc nên làm riêng (ngoài nhóm file của gói): sửa `scripts/uiux/lib/fabricate.mjs` để `rank`, `day`, `tier` và `key` lấy theo chỉ số phần tử, thì bộ chụp hết nhiễu cảnh báo này.

## Lệnh kiểm chứng (chạy trong `apps/miniapp`, PATH Node 22.23.3)

| Lệnh | Exit | Kết quả |
| --- | --- | --- |
| `npx vitest run` cho `src/pages/game-*.spec.tsx`, `loyalty-behavior/layout/loyalty.spec`, `format-guard`, `src/components/game`, `wheel.spec`, `services/game-api.spec`, `utils/idempotency.spec`, 4 spec `ds-*` quét mã | 0 | 18 file, 463 ca xanh |
| `npx tsc --noEmit` | 0 | không lỗi |
| `npx eslint --max-warnings=0` trên 12 file `.ts/.tsx` đã đổi (luật `tubu-ds` có trong cấu hình) | 0 | sạch |

Ghi chú môi trường: `tsc` cần `packages/shared-types/dist`; mình chạy `pnpm build` trong `packages/shared-types` (thư mục `dist` bị git bỏ qua, không vào commit).

## Chưa verify

- Không chạy Playwright, không chạy full suite, không chạy `pnpm build`/`vite build` của miniapp (điều phối viên chạy sau).
- Chưa thử trên Zalo thật: hộp xác nhận ở lại trong lúc gửi, hoạt ảnh đóng của `Sheet`, và nhánh WebView thiếu `crypto.randomUUID` mới được kiểm bằng jsdom (`Sheet` giả ở `tree-actions.spec`, `Sheet` thật ở `game-behavior.spec`).
- Chưa chạy với BE PE-1a: hợp đồng header (8–128 ký tự, replay cùng body) lấy theo đề bài, chưa kiểm hai đầu nối với nhau.
- `apps/web` không đổi nên không chạy lại test web.

## Rủi ro còn lại

- Thử lại với cùng key trong cùng hộp áp dụng cho mọi loại lỗi, kể cả lỗi nghiệp vụ như thiếu Điểm Xanh. Nếu PE-1a lưu cả phản hồi lỗi dưới key thì khách vừa nạp điểm rồi bấm lại trong cùng hộp sẽ nhận lại lỗi cũ; đóng hộp mở lại là có key mới. Cần PE-1a xác nhận chỉ lưu phản hồi thành công, hoặc báo lại để mình đổi sang giữ key chỉ với lỗi mạng/timeout/5xx.
- Nhánh dự phòng của `newIdempotencyKey` dùng `Math.random` (hàm có sẵn, ngoài nhóm file nên không đổi). Hợp lệ theo hợp đồng và đủ để phân biệt các lượt góp của cùng một khách; không dùng cho mục đích bảo mật.
- Khoá chống chạm đúp là theo từng thể hiện trang: thoát trang rồi vào lại giữa lúc yêu cầu đang bay thì khoá mới trống. Chặn tiếp ở tầng này cần BE (PE-1a) làm cho các lệnh ghi còn lại idempotent; gói này chỉ có key cho góp quỹ cây.
