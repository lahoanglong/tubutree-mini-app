# Hướng dẫn nội dung 5 game mini

Tài liệu cho người soạn và người duyệt nội dung của Đúng Thùng (`sort`), Đố Xanh (`daily_quiz`), Ghép Cặp (`match`), Đoán Xuất Xứ
(`origin`) và Giỏ Đúng Việc (`basket`). Nguyên tắc chung: **thà ít mà đúng**. Mục không kiểm được nguồn thì tắt (`active: false`) và
ghi lý do, không bịa nguồn, không viết lại câu chỉ để đủ số lượng.

Cả 5 game nằm sau cờ `game.mini.*` (mặc định TẮT). **Người có chuyên môn phải duyệt nội dung trước khi PO bật cờ.** Một game có ít hơn
10 mục bật sẽ tự ẩn (`MINI_MIN_ACTIVE_ITEMS`).

## 1. File nội dung

Thư mục `apps/api/prisma/reference-data/game-mini/`:

| File | Nội dung |
|---|---|
| `sort.json`, `daily-quiz.json`, `match.json`, `origin.json`, `basket.json` | `{ game, items: [...] }`, mỗi mục là một dòng `game_content_items` |
| `sources.json` | Bảng nguồn: mã, URL, hạng, đơn vị phát hành, tiêu đề, ghi chú, ngày kiểm |
| `legacy-quiz-sources.json` | Nguồn gắn cho câu đố cũ trong `game_quizzes` (chỉ câu tìm được nguồn) |
| `products-snapshot.json` | Ảnh chụp danh sách sản phẩm (slug, tên, còn hàng) dùng để kiểm `productSlug` và đề Giỏ Đúng Việc |

Một mục:

```json
{
  "id": "gm-quiz-vi-du",
  "active": true,
  "version": 1,
  "payload": { "prompt": "…?", "options": ["…", "…", "…"], "answer": 1 },
  "explanation": "Một đến hai câu, tiếng Việt, ≤ 220 ký tự.",
  "sourceUrl": "https://…",
  "sourceRef": "S7: tên trang, đoạn hay mục đã đối chiếu",
  "sourceCheckedAt": "2026-11-17",
  "productSlug": "slug-san-pham-neu-co",
  "inactiveReason": "chỉ khi active=false"
}
```

- `id` ổn định, chữ thường gạch nối, tiền tố theo game: `gm-sort-`, `gm-quiz-`, `gm-match-`, `gm-origin-`, `gm-basket-`. Không đổi
  `id` của mục đã nạp: đổi `id` là tạo mục mới, mục cũ vẫn nằm trong DB.
- `payload` theo luật của từng game (`apps/api/src/modules/game/mini/games/`):
  - Đúng Thùng `{ label, bin, emoji? }`, `bin` là `recycle | food | other | hazardous`;
  - Đố Xanh và Đoán Xuất Xứ `{ prompt, options (2–4), answer }`, `answer` là chỉ số trong `options` (0 là lựa chọn đầu);
  - Ghép Cặp `{ ingredient, use }`;
  - Giỏ Đúng Việc `{ task, correct: [3 slug], wrong: [3 { slug, reason }] }`.
- `sourceRef` ghi mã nguồn trong `sources.json` và chỗ đã đối chiếu (mục, bảng, câu), để người duyệt mở đúng chỗ.
- `sourceCheckedAt` là ngày mở trang nguồn và thấy trang còn nói đúng điều mục khẳng định.

## 2. Hạng nguồn

| Hạng | Loại nguồn | Dùng thế nào |
|---|---|---|
| A | Văn bản pháp luật, cơ quan nhà nước (Bộ TN&MT, Bộ Công Thương, cổng tỉnh, US EPA, NOAA, US DOE) | Dùng trực tiếp |
| B | Tổ chức khoa học, bài bình duyệt, cơ quan báo chí nhà nước, tổ chức quốc tế | Dùng trực tiếp |
| C | Bách khoa thứ cấp (Wikipedia), báo tổng hợp | Chỉ cho kiến thức phổ thông; **chuyên gia phải duyệt** trước khi bật cờ; mục mới chỉ thêm từ A/B |
| label | Nhãn hoặc mô tả sản phẩm trên trang sản phẩm Tubu | **Chỉ** cho Giỏ Đúng Việc, và chỉ nói công dụng ghi trên nhãn |

Luật nguồn:

- `sourceUrl` là trang gốc, `https`, mở được, và có nói điều mục khẳng định. Không mở được hoặc không khớp thì tắt mục và ghi lý do.
- Không dùng blog bán hàng, trang của hãng tự quảng cáo, hay diễn đàn.
- Không dùng trang Tubu làm nguồn cho khẳng định khoa học. Trang sản phẩm Tubu chỉ là nguồn nhãn cho Giỏ Đúng Việc.
- Mỗi `sourceUrl` của game khoa học phải có trong `sources.json` (spec chặn nếu thiếu).
- Bài PMC: URL chuẩn là `pmc.ncbi.nlm.nih.gov`; trang này chặn trình đọc tự động, nên có thể kiểm bản Europe PMC cùng mã PMC.
- Quy định phân loại rác (Công văn 9368/BTNMT-KSONMT, S1) là hướng dẫn chung. **Địa phương có thể khác**: lời giải thích của Đúng
  Thùng nên nhắc người chơi xem quy định nơi mình ở khi vật dễ gây tranh cãi.

## 3. Luật câu chữ

Căn cứ: Luật Quảng cáo 2012 Điều 8 (khoản 9, 10, 11, 14), Điều 19, Điều 20 khoản 4. Game là kênh quảng cáo của cửa hàng, nên mọi chữ
người chơi thấy (câu hỏi, lựa chọn, nhãn, lý do sai, lời giải thích) đều theo luật này.

### 3.1. Cụm cấm

Không dùng các cụm sau, trừ khi nguồn là giấy phép hoặc nhãn đã đăng ký và có trích dẫn:

| Cụm cấm | Vì sao |
|---|---|
| "diệt khuẩn", "diệt virus", "diệt côn trùng", "diệt nấm" | Điều 20 khoản 4 điểm c: cần giấy chứng nhận đăng ký lưu hành của Bộ Y tế |
| "99,9%" | Thường đi kèm "diệt khuẩn"; không có nguồn đo độc lập |
| "chữa", "trị", "điều trị" | Điều 20 khoản 4 điểm a: công dụng thuốc. Cho phép "sửa chữa", "giá trị", "quản trị", "trị số" |
| "ngừa bệnh", "phòng bệnh", "phòng dịch" | Công dụng y tế |
| "an toàn tuyệt đối", "an toàn 100%", "an toàn hoàn toàn" | Điều 8 khoản 9; S4, S9, S10 cho thấy nguyên liệu thực vật vẫn có cảnh báo |
| "không hoá chất", "không chứa hoá chất" | Mọi thành phần, kể cả nước, đều là hoá chất |
| "100% tự nhiên", "100% thiên nhiên", "100% hữu cơ" | Không kiểm chứng được |
| "kháng khuẩn", "sát khuẩn", "khử trùng", "kháng viêm", "kháng nấm" | Công dụng y tế; S4 chỉ thấy in vitro |
| "vô hại" | S4: một số saponin có hại với cá; S10: limonene độc với sinh vật dưới nước |
| "chống muỗi", "đuổi muỗi", "xua côn trùng" | Chế phẩm diệt côn trùng cần giấy phép |
| "thân thiện (với) môi trường" | Không kèm giới hạn là tuyên bố xanh gây hiểu lầm |
| "phân huỷ (sinh học) hoàn toàn" | Không kèm điều kiện là tuyên bố xanh gây hiểu lầm |
| "tốt nhất", "an toàn nhất", "xanh nhất", "duy nhất", "số một" | Điều 8 khoản 11 |

Bộ lọc so trên chữ thường, chuẩn hoá Unicode, chấp nhận cả hai kiểu đặt dấu ("hoá"/"hóa", "thuỷ"/"thủy"). Danh sách đầy đủ ở
`BANNED_PHRASES` trong `apps/api/prisma/seed-game-mini.ts`; thêm cụm mới thì thêm cả ca thử ở spec.

Nên dùng: "gốc thực vật", "thành phần từ…", "theo [nguồn]…", "tuỳ điều kiện", "đọc nhãn trước khi dùng".

### 3.2. Con số yếu (không đưa vào game)

| Con số | Vì sao |
|---|---|
| Chai nhựa phân huỷ 450 năm | Không có nguồn khoa học đã xem |
| Việt Nam tái chế 33% trên 3,9 triệu tấn nhựa | Chưa mở được nguồn gốc |
| Refill giảm 44% hay 90% nhựa | Số do hãng thuê đo, không có đánh giá vòng đời độc lập |
| "Nhựa số 1, 2, 5 tái chế được" | Mã nhựa chỉ cho biết loại nhựa, không nói khả năng tái chế; tuỳ cơ sở địa phương |
| Tỷ lệ EPR (PET 22%…) | Nguồn mâu thuẫn, đã có nghị định sửa đổi |
| CMC của bồ hòn (0,032–1,7 wt%) | Nguồn tự mâu thuẫn |
| Axit axetic trong eco-enzyme (0,81–1,08%, 3,32%, 4,8 g/ml) | Các nguồn lệch nhau; nếu dùng phải ghi "tuỳ mẫu" |

Bộ lọc chỉ bắt 33%, 44%, 90%, 22% khi đứng gần chữ về nhựa, tái chế, bao bì hay EPR, để không chặn con số đúng nguồn ở ngữ cảnh khác
(ví dụ tỷ lệ tinh dầu trong vỏ quế). Mọi con số khác phải có nguồn A/B và ghi trong `sourceRef` chỗ có con số đó.

### 3.3. Độ dài và giọng

- Lời giải thích 1–2 câu, tiếng Việt, **tối đa 220 ký tự** (`MINI_EXPLANATION_MAX`), không thừa khoảng trắng đầu cuối.
- Không thuật ngữ; tên chất cần thiết thì giải thích bằng chữ thường ngày (ví dụ "chất tạo bọt trong quả bồ hòn").
- Không khuyến khích trẻ tự trộn hoá chất hay dùng tinh dầu (Điều 8 khoản 14).
- Không nêu mức phạt tiền khi chưa đối chiếu văn bản gốc.

## 4. Giỏ Đúng Việc

- Mỗi đề: một việc trong nhà (ví dụ "Rửa bình sữa"), **3 sản phẩm đúng và 3 sản phẩm sai**, 6 slug khác nhau.
- Mỗi món sai có `reason`: lý do chỉ nói **công dụng ghi trên nhãn hoặc mô tả sản phẩm** (ví dụ "Nhãn ghi dùng để giặt quần áo"), không
  nêu công dụng y tế, không chê sản phẩm.
- Cả 6 sản phẩm phải đang bán và còn hàng. Lõi chỉ phát đề khi đủ 6 món còn hàng (nếu chỉ đòi 3 món đúng còn hàng, thẻ "hết hàng"
  sẽ lộ đáp án sai). Spec kiểm theo `products-snapshot.json`; trên PROD, đề có món hết hàng tự tạm ngưng tới khi có hàng lại.
- `sourceUrl` là trang sản phẩm Tubu của một món đúng (nguồn hạng label).
- Cần ít nhất 12 đề bật.

## 5. Seed và `version`

Lệnh (chạy trong `apps/api`):

```bash
pnpm exec tsx prisma/seed-game-mini.ts
```

Lệnh không nhận tham số. Lệnh kiểm cả gói trước; gói có lỗi thì không ghi dòng nào. Sau đó:

1. **Tạo mới theo `id`**: mục chưa có trong DB được tạo với `active` như trong file.
2. **Không đè sửa tay của admin**: mục đã có chỉ được cập nhật khi `version` trong file **lớn hơn** `version` trong DB. Màn admin tăng
   `version` mỗi lần sửa, nên chạy lại seed không đè sửa tay.
3. Khi cập nhật theo `version`: mục trong file đang bật thì **giữ nguyên** trạng thái bật/tắt trong DB (admin đã tắt thì vẫn tắt); mục
   trong file đang tắt thì DB tắt theo.
4. Câu cũ `game_quizzes`: chỉ gắn `sourceUrl` khi cột còn trống. Không sửa câu, không xoá câu. Câu không có nguồn không vào Đố Xanh
   (lõi chỉ lấy câu có `sourceUrl` https).

Lưu ý khi nâng `version` trong file: nếu admin đã sửa mục đó ít lần hơn số bạn nâng (ví dụ admin sửa một lần thành `version` 2, file
nâng lên 3), seed sẽ **đè** bản admin. Trước khi nâng `version`, xem mục đó trong DB (`version`, `updatedAt`) và hỏi người duyệt.

Seed chưa nằm trong `tools/deploy/deploy.sh`. Sau khi deploy bản có thay đổi nội dung, chạy tay trên VPS (image API chứa sẵn thư mục
`prisma/reference-data`):

```bash
cd /opt/tubutree && docker compose -f docker-compose.vietnix.yml run --rm --no-deps api pnpm exec tsx prisma/seed-game-mini.ts
```

## 6. Thêm hoặc sửa mục

1. Tìm nguồn hạng A/B. Mở trang, đối chiếu đúng câu hoặc bảng nói điều mục khẳng định.
2. Nguồn mới thì thêm vào `sources.json` (mã, URL, hạng, đơn vị, tiêu đề, ghi chú, `checkedAt`).
3. Thêm mục vào file của game: `id` mới, `version: 1`, `sourceRef` ghi mã nguồn và chỗ đối chiếu, `sourceCheckedAt` là ngày mở trang.
4. Gắn sản phẩm (`productSlug`, đề Giỏ Đúng Việc) thì cập nhật `products-snapshot.json` từ `GET https://api.tubutree.com/api/products`
   (đủ các trang) và kiểm slug còn bán.
5. Sửa mục đã nạp: sửa trong file **và** nâng `version` (xem lưu ý ở mục 5), hoặc sửa trên màn admin.
6. Bỏ mục: đặt `active: false`, ghi `inactiveReason`, nâng `version`. Không xoá mục khỏi file (giữ lịch sử, giữ ván đã phát chấm được).
7. Chạy kiểm:

```bash
cd apps/api
pnpm exec jest src/modules/game/mini/game-mini-content-pack
```

Spec kiểm: nguồn https có trong `sources.json`, không cụm cấm và con số yếu, đáp án nằm trong lựa chọn, không trùng `id`, slug có
trong ảnh chụp, đề Giỏ Đúng Việc đủ 3 đúng + 3 sai còn hàng, giải thích ≤ 220 ký tự, số mục bật mỗi game (ghi cứng: thêm hay tắt mục
phải sửa số trong spec), và mỗi game chơi trọn một ván bằng nội dung thật. Seed trên Postgres thật:
`test/integration-race/game-mini-content-seed.race-spec.ts`.

## 7. Trước khi bật cờ

Người có chuyên môn (môi trường, hoá học tiêu dùng, pháp chế quảng cáo) duyệt:

1. Mọi mục bật có nguồn hạng C (Wikipedia): giữ, sửa sang nguồn A/B, hay tắt.
2. Mọi mục đang tắt và lý do tắt: có nguồn thay thế thì bật lại (nâng `version`).
3. Lời giải thích các mục Đúng Thùng dễ gây tranh cãi theo quy định địa phương.
4. Lý do sai của từng đề Giỏ Đúng Việc so với nhãn sản phẩm hiện tại.

Sau khi duyệt, PO bật từng game bằng cờ `game.mini.<game>.enabled` (`sort`, `daily_quiz`, `match`, `origin`, `basket`) và cờ tổng
`game.mini.enabled` trên màn admin.
