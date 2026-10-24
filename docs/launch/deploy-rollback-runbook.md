# Triển khai và quay lại (rollback) trên VPS Vietnix, bản có migration đánh giá nhiều lần

Dành cho chủ shop và người giúp việc gõ lệnh theo từng bước. Không cần biết lập trình: mỗi bước ghi rõ gõ gì, thấy gì thì đúng, thấy gì khác thì DỪNG và gọi người.

Phạm vi: lần phát hành đưa PROD từ bản đang chạy lên SHA đã chốt. Ba migration `20261014213300_r6_admin_orders_recipient_search`, `20261015070000_r8_refill_locations_table`, `20261015150000_r8_multi_reviews_unique_per_order` là phần cuối của đợt (cùng `20261015160000_r9_sync_stock_same_clock_markers`, `20261015170000_r10_legacy_returns_received` và `20261020000000_waste_exchange` của Đổi rác lấy quà), nhưng danh sách migration thật phải áp phụ thuộc bản PROD đang chạy và có thể dài hơn rất nhiều (hàng chục cái nếu PROD còn ở bản cũ). Vì vậy việc đầu tiên là mục 1.0: xác định bản đang chạy và đếm đủ migration chờ áp. Kịch bản thử đơn thật sau khi lên bản mới nằm ở [pilot-order-playbook.md](pilot-order-playbook.md).

## 0. Đọc trước

### 0.1 Vì sao KHÔNG dùng `bash tools/deploy/deploy.sh` cho lần này

`deploy.sh` áp migration trong lúc API cũ vẫn đang chạy. Lần này không được, vì migration `20261015150000` đổi khoá duy nhất của bảng đánh giá, trong khi API cũ vẫn ghi đánh giá theo khoá cũ. Vì vậy lần này làm tay theo thứ tự dưới đây: dừng API cũ, sao lưu, migrate, bật web mới, bật API mới. Các lần phát hành sau mà không có migration kiểu này có thể quay lại dùng `deploy.sh`. (Nếu lỡ chạy `deploy.sh` khi migration đó còn chờ áp và API cũ còn chạy, script tự dừng ngay, thoát mã 2, chưa build hay migrate gì.)

### 0.2 Năm ràng buộc của tech lead (đã gài vào các bước)

1. Bật API mới TRƯỚC khi phát hành bản Zalo Mini App mới (màn đánh giá của Mini App cần dữ liệu `can-review` mới từ API).
2. DỪNG API cũ TRƯỚC khi chạy `prisma migrate deploy` (migration đổi chỉ mục duy nhất của bảng đánh giá).
3. Web mới lên CÙNG LÚC hoặc TRƯỚC API mới. Tab admin đã mở từ trước deploy phải được tải lại (xem mục 5, bước 12).

   Đừng để web mới chạy cạnh API cũ khi API đã nhận request: web admin mới gửi thêm `expectedAmount` khi duyệt và chi lệnh rút, mà `ValidationPipe` của API bật `forbidNonWhitelisted` nên API cũ trả 400 và admin không duyệt hay chi được. Thứ tự ở mục 5 vẫn đúng vì API đang dừng từ bước 5 tới bước 9 (không có request nào tới API cũ); sau bước 9 cả hai đều là bản mới. Nếu API mới chưa lên được mà phải bật tạm API cũ, quay luôn web về image cũ (7.4). Ngược lại (web cũ, API mới) thì không sao vì `expectedAmount` là tuỳ chọn.
4. Migration `20261014213300` khoá bảng `orders` (khoảng 14 giây cho mỗi 300.000 đơn, khoảng 2 giây dưới 50.000 đơn). Nếu PROD còn ở bản cũ, danh sách chờ áp còn có các migration nặng khác trên `orders` và `users` (bảng ở mục 1.0). Cách chọn giờ nằm ở mục 3.
5. Quay lại bằng image chỉ hợp lệ khi schema sau migrate vẫn tương thích với image cũ (mục 7.0). Nếu danh sách chờ áp có BẤT KỲ migration nào ngoài sáu migration của đợt (ba chính: r6, r8 điểm nhận vỏ, r8 đánh giá; hai nhỏ thêm sau: r9 mốc tồn kho, r10 hàng trả cũ; một mới: Đổi rác lấy quà `20261020000000_waste_exchange`) thì đường quay lại duy nhất là khôi phục bản backup (7.3). Bản nhánh UAT ngày 2026-10-20 (nền `main` sau PR #20, #21, #22, cộng mười một migration thêm trong đợt UAT 2026-10-20 đến 2026-10-22: `20261020010000_waste_item_warehouse_only`, `20261020100000_best_answer_reward_note_template`, `20261020100000_review_return_reversal`, `20261020110000_coupons_admin_list_index`, `20261020120000_dealer_bonus_topup_template`, `20261020120000_groupbuy_success_template_percent`, `20261020120000_notification_template_tone_style`, `20261020120000_pit_threshold_description`, `20261020120000_q19_reversal_effects_marker`, `20261022100000_payout_tax_refunded`, `20261022110000_dealer_quarter_bonus_tiers`) có 218 thư mục migration và thêm 32 migration ngoài sáu migration của đợt (mọi `20261018*` tới `20261022*` trừ `20261020000000_waste_exchange`; đếm lại bằng `ls apps/api/prisma/migrations | grep -E '^2026101[89]|^2026102[0-2]' | grep -vc waste_exchange`, con số đổi mỗi khi thêm migration), nên lần deploy bản đó chỉ quay lại được bằng 7.3. Mười một migration thêm trong đợt UAT cố ý KHÔNG đưa vào danh sách tương thích image (`IMAGE_COMPATIBLE_MIGRATIONS` trong `db-checks.ts`): chưa xét riêng việc image cũ chạy trên chúng, nên giữ đường quay lại an toàn là 7.3.

### 0.3 Hạ tầng hiện tại (đọc kỹ)

- Chạy trên VPS Vietnix `14.225.207.177`, chung với ChoDeli và WordPress. Thư mục `/opt/tubutree`, file compose `docker-compose.vietnix.yml`. Chi tiết nền: [ops/README-vietnix-deploy.md](../../ops/README-vietnix-deploy.md).
- **Máy ảo GCP cũ đã đóng.** Ba secret GitHub `VM_HOST`, `VM_USER`, `VM_SSH_KEY` vẫn trỏ vào máy đó. Hệ quả: các workflow `deploy.yml` và `ops.yml` (audit, backup, gin, set-env, crontab, grant-admin) sẽ lỗi ở bước SSH cho tới khi trỏ lại. Mục 2 nói cần trỏ lại những gì. Cho đến lúc đó, mọi việc làm tay qua SSH theo tài liệu này. Năm workflow VM (`deploy.yml`, `ops.yml`, `logs.yml`, `smoke.yml`, `smoke-purchase.yml`) còn có bước chặn đầu tiên: chúng dừng ngay ở đó cho tới khi biến repo `VM_WORKFLOWS_ENABLED` bằng `true` (đặt sau khi đã trỏ lại các secret SSH).
- Kể cả khi đã trỏ lại: KHÔNG chạy `deploy.yml` cho lần phát hành này (nó gọi `deploy.sh`, vi phạm ràng buộc 2; `deploy.sh` tự dừng với mã 2 khi migration `20261015150000` còn chờ áp mà API cũ còn chạy, nhưng đừng dựa vào đó). Cách quay lại của `deploy.yml` cũng là quay image theo mục 7, không phải checkout commit cũ.

### 0.4 Hai dòng gõ đầu mỗi cửa sổ SSH

Mỗi lần mở cửa sổ SSH mới, gõ lại cả khối này:

```bash
cd /opt/tubutree
export DC="docker compose -f docker-compose.vietnix.yml"
PGUSER=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- || true); PGUSER=${PGUSER:-tubu}
PGDB=$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- || true); PGDB=${PGDB:-tubutree}
psqlq() { $DC exec -T postgres psql -U "$PGUSER" -d "$PGDB" "$@"; }
```

Từ đây `$DC` thay cho `docker compose -f docker-compose.vietnix.yml`, và `psqlq` mở psql vào đúng DB của Tubu Tree.

### 0.5 Ai làm gì

| Vai | Việc |
|---|---|
| Chủ shop | Quyết định giờ deploy, quyết định rollback, nhận báo kết quả |
| Người gõ lệnh | Gõ từng bước, dán kết quả vào nhóm chat khi gặp điểm DỪNG |
| Tech lead | Gọi khi gặp điểm DỪNG trong mục 6 |
| Người theo dõi màn admin | Mở Quản trị, Sức khoẻ hệ thống suốt lúc deploy và 1 giờ sau |

Điền số điện thoại trước ngày deploy: Chủ shop ____________, Tech lead ____________, Người giữ quyền root VPS ____________.

## 1. Việc phải xong TRƯỚC ngày deploy (T-2 đến T-1)

Tick từng ô. Chưa tick hết thì chưa chọn giờ deploy. Làm 1.0 TRƯỚC mọi mục khác: kết quả của nó quyết định cửa sổ bảo trì (mục 3) và đường quay lại (mục 7).

### 1.0 Việc đầu tiên: biết chính xác PROD đang chạy bản nào và sẽ áp những migration nào

Không suy ra từ trí nhớ hay tài liệu cũ. `docs/2026-10-review/HANDOFF.md` (ghi ngày 2026-10-11) nói PROD chạy `cb92dc8` (115 migration); nhánh `main` hiện là `c7bfbdcd` (132 migration); SHA đã chốt cho lần này có nhiều hơn nữa (đếm lại bằng lệnh dưới; ngày 2026-10-15 là 181). Trong repo không có bằng chứng `main` đã được deploy sau ngày 2026-10-11, nên có thể 48 đến 65 migration sẽ được áp, không phải chỉ sáu cái của đợt nêu ở đầu tài liệu. Mọi con số về cửa sổ (mục 3) và về quay lại (mục 7) phải tính từ danh sách thật.

Chủ dự án xác nhận ngày 2026-10-15: bản trên VPS vẫn chỉ là bản thử, không có dữ liệu khách thật (giữ giả định ngày 2026-10-11). Vẫn làm Phần A và B bên dưới để ghi số migration thật cho cửa sổ và đường quay lại; không cần thêm cổng bảo vệ số dư, đơn, điểm của khách thật. Nếu trước ngày deploy có khách thật dùng bản thử, quyết định này hết hiệu lực và phải làm lại mục này.

Đơn ký gửi `MCH_` đã giao trước ngày deploy KHÔNG được đối soát bù (chủ dự án chốt 2026-10-15, OPS-9): chỉ đơn giao sau khi bản này chạy mới sinh khoản đối soát tự động cho đối tác. Không viết script backfill.

Nếu máy chủ đã có dòng điểm `RETURN_REVERSED:%` (điểm tích bị thu khi trả một phần), đếm chúng trước khi deploy: `SELECT count(*) FROM points_transactions WHERE reason LIKE 'RETURN_REVERSED:%';`. Bản này ghép các dòng đó vào lô điểm của đơn thay vì ăn FIFO, nên với dòng cũ cron hết hạn có thể trừ điểm ngay đêm đầu sau deploy. Bằng 0 thì bỏ qua.

Phần A. Ghi lại image đang chạy và DB đang ở đâu:

```bash
docker inspect -f 'image={{.Image}} container tạo lúc {{.Created}}' "$($DC ps -q api)"
docker image inspect -f 'image build lúc {{.Created}}' "$(docker inspect -f '{{.Image}}' "$($DC ps -q api)")"
git log -1 --format='mã đang checkout trên máy chủ: %H %cd %s' --date=iso
docker exec "$($DC ps -q api)" sh -c 'ls prisma/migrations | grep -c "^[0-9]"'
psqlq -tAc "SELECT count(*), max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"
```

Dòng thứ 4 là số migration nằm TRONG image đang chạy, dòng thứ 5 là số migration đã áp xong trong DB. Hai số phải bằng nhau: khi đó image khớp DB, và số đó nhận ra bản PROD (115 là `cb92dc8`, 132 là `c7bfbdcd`; số khác thì đếm bằng `git ls-tree -r --name-only <sha> -- apps/api/prisma/migrations | grep -c migration.sql`). Mã checkout ở dòng thứ 3 CÓ THỂ khác image đang chạy (từng pull mà chưa build lại): coi image và DB là sự thật, không coi checkout là sự thật. Hai số lệch nhau: DỪNG, gọi Tech lead (image và DB không cùng một bản, chưa biết quay lại về đâu).

Ghi: số migration của PROD ______ , bản PROD (SHA hoặc "không rõ") ______ .

Phần B. Liệt kê TẤT CẢ migration sẽ áp. Cần SHA đã chốt có sẵn trên máy chủ (chỉ phần `git fetch` của mục 5 bước 1, CHƯA merge):

```bash
SHA=<SHA đã chốt>
git ls-tree -r --name-only "$SHA" -- apps/api/prisma/migrations | sed -nE 's#.*/migrations/([^/]+)/migration\.sql$#\1#p' | LC_ALL=C sort > /tmp/migrations_moi.txt
psqlq -tAc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL" | LC_ALL=C sort > /tmp/migrations_da_ap.txt
wc -l < /tmp/migrations_moi.txt
LC_ALL=C comm -13 /tmp/migrations_da_ap.txt /tmp/migrations_moi.txt | tee /tmp/pending-migrations-1.0.txt | wc -l
cat /tmp/pending-migrations-1.0.txt
```

Số đầu là tổng migration của SHA đã chốt; số thứ hai là số migration CHỜ ÁP; file `/tmp/pending-migrations-1.0.txt` giữ bản nháp danh sách để đối chiếu (danh sách CHÍNH THỨC dùng cho bước 7 và mục 7 là `.pending-migrations`, do mục 5 bước 4 tạo từ image mới; hai danh sách phải khớp). `comm -13` chỉ in các tên có ở SHA mới mà DB chưa có; nếu DB có tên mà SHA mới không có (DB đi trước mã) thì dòng đó nằm ở `/tmp/migrations_da_ap.txt` chứ không hiện ở đây: kiểm `LC_ALL=C comm -23 /tmp/migrations_da_ap.txt /tmp/migrations_moi.txt` phải trống, nếu không thì DỪNG, gọi Tech lead.

Ghi: số migration chờ áp ______ . Đối chiếu từng tên với bảng dưới.

| Migration (nếu có trong danh sách chờ áp) | Vì sao nặng hoặc nguy hiểm | Việc cần làm |
|---|---|---|
| `20261012110000_pd3_xu_to_points`, `20261012130000_pd3_freeze_coins` (PD-3) | Quy đổi số dư xu thành điểm (khoá `users` và `coin_transactions`), rồi thêm ràng buộc `coinsBalance = 0`. Migration DỪNG deploy nếu có user xu âm, xu lệch sổ, hoặc `loyalty.vnd_per_point_redeem` khác 1000. Một chiều | Chạy trước ba truy vấn kiểm ở dưới bảng; phải ra 0, 0 và (không dòng hoặc 1000) |
| `20261018210000_points_1d` (Điểm Xanh 1 điểm = 1đ) | Nhân 1.000 mọi số điểm (số dư, sổ điểm, giá quà, cấu hình, hạng thành viên) trong MỘT giao dịch, khoá nhiều bảng (gồm `orders`: `LOCK TABLE` rồi `UPDATE` ba cột điểm của mọi đơn có điểm, nên tính vào cửa sổ, go-live:check đếm nó vào `db.orders_lock`); thêm dòng lịch sử `sch_pts1d_*` làm dấu đã chạy. Một chiều. Dừng nếu `loyalty.vnd_per_point_redeem` đã là 1 mà DB có điểm nhưng không có dấu của chính migration này, hoặc nếu số nhân tràn INT4 | API phải DỪNG trước khi migrate (mục 5 làm tay đúng thứ tự này; `deploy.sh` chỉ dùng được khi mục 0.1 cho phép): khi API còn chạy, `deploy.sh` build image trước (API cũ vẫn phục vụ), rồi tự dừng API, migrate, chạy `prisma:seed:reference`, bật API mới. `deploy.sh` backup lại ngay sau khi dừng API (backup lỗi thì bật lại API, chưa migrate); backup chạy trước build vẫn nên có nhưng không đủ để khôi phục không mất dữ liệu: hoàn tác = khôi phục backup (mục 7.3), không có script đảo ngược |
| `20261014003644_p1_pancake_outbound_sync_state` (p1) | Viết lại MỌI đơn đã có `pancakeOrderId` (đặt `pancakePushStatus = 'SYNCED'`) và dựng 2 chỉ mục mới trên `orders` | Thời gian tỉ lệ số đơn đã đẩy Pancake; tính vào cửa sổ (mục 3) |
| `20261014150000_p4_admin_ops_search` (p4) | Điền `users.fullNameSearch` cho mọi user, dựng 2 chỉ mục GIN và 1 chỉ mục biểu thức trên `users`/`orders` | Tỉ lệ số user và số đơn; tính vào cửa sổ |
| `20261014003831_p8_seller_merchant_fulfilment` (p8) | Thêm cột, 3 chỉ mục, 2 khoá ngoại trên `orders`; đổi dữ liệu một chiều: hoa hồng PAID của lệnh rút REQUESTED hoặc APPROVED về APPROVED, `products.pancakeId` và `variations.pancakeId` cho phép NULL và đặt NULL cho mã `MCH_`, đơn cũ được gán gian hàng | Tính vào cửa sổ; sau khi chạy thì KHÔNG quay lại bằng image (7.0) |
| `20261014213300_r6_admin_orders_recipient_search` (r6) | Khoá `orders` và viết lại mọi đơn có tên người nhận, dựng chỉ mục GIN: khoảng 14 giây cho mỗi 300.000 đơn | Đã đo ở UAT (mục 3.1) |
| `20261010170000_orders_invoice_open_index`, `20261013172522_p2_pancake_inbound_attention`, `20261018170100_lr_orders_filter_indexes` | Dựng chỉ mục KHÔNG `CONCURRENTLY` trên `orders` (một chỉ mục từng phần theo hoá đơn; một chỉ mục `pancakeAttentionAt`; bốn chỉ mục `paymentStatus`, `type`, `platform`, `placedForCustomer` cùng `createdAt`): khoá chặn ghi `orders` suốt lúc dựng | Tính vào cửa sổ (mục 3); `go-live:check` đếm mỗi cái ngang r6 |
| `20261016210000_r11_delivered_effects_marker`, `20261013173621_p3_gomdon_order_note_cleanup` | r11 thêm cột `deliveredEffectsAt`, viết lại MỌI đơn đã giao hoặc đã trả (`UPDATE orders`) rồi dựng chỉ mục từng phần; p3 gomdon duyệt cả bảng `orders` theo `LIKE` trên `note` rồi viết lại các đơn có dòng "Gomdon webhook" hoặc "Tự huỷ" | Thời gian tỉ lệ số đơn; tính vào cửa sổ |
| `20261018140000_lr_reports_source_indexes` | Dựng `users_createdAt_idx` và `orders_userId_createdAt_idx` không `CONCURRENTLY`: khoá chặn ghi `users` và `orders` | Tính vào cửa sổ |
| `20261012100000_pd3_points_lot_schema`, `20261014090000_p5_refunds_returns_queue`, `20261018000100_n1_indexes`, `20261019100000_external_orders`, `20261020000000_waste_exchange`, `20261020100000_review_return_reversal` | Thêm ràng buộc CHECK (duyệt hết `points_transactions`, `users`) và chỉ mục (duy nhất từng phần, hoặc `userId, refId`) trên `points_transactions`, không `CONCURRENTLY`: khoá chặn ghi sổ điểm. Không đổi dữ liệu trên `points_transactions`; `pd3_points_lot_schema` đổi `community_events.rewardPoints` và p5 đặt `return_requests.fullReturn = true` (UPDATE một chiều, hoàn tác = backup), `waste_exchange` còn INSERT dữ liệu tham chiếu | Thời gian tỉ lệ số dòng sổ điểm; không tính vào `db.orders_lock` nhưng tính vào cửa sổ. `waste_exchange` còn tương thích image cũ (mục 7.0) |
| `20261019170000_chat_review1` | `UPDATE users SET phoneVerifiedAt = now()` cho mọi user có SĐT mà chưa xác minh | Thời gian tỉ lệ số user; tính vào cửa sổ |
| `20261020120000_q19_reversal_effects_marker` | Thêm cột `orders.reversalEffectsAt` (đánh dấu phần đảo sau huỷ/trả đã xong), `UPDATE orders` điền sẵn mốc cho mọi đơn đã `CANCELLED` hoặc `RETURNED` (để cron chạy lại không quét lịch sử), rồi dựng chỉ mục từng phần `orders_reversal_effects_pending_idx` không `CONCURRENTLY`: khoá chặn ghi `orders` lúc dựng. Cột mới nullable nên image cũ vẫn chạy, nhưng không ghi mốc: đơn huỷ/trả trong lúc chạy image cũ sẽ được cron của image mới chạy lại phần đảo (idempotent). Hoàn tác = khôi phục backup (7.3). Đi kèm `ReversalEffectsResyncCron`: 5 phút một lượt, quét đơn huỷ/trả thiếu mốc quá 5 phút và cập nhật trong 14 ngày, tối đa 200 đơn mỗi lượt | Thời gian tỉ lệ số đơn; tính vào cửa sổ và vào `db.orders_lock` |

Ba truy vấn kiểm PD-3 (chỉ cần khi danh sách có `pd3_xu_to_points`; chỉ đọc):

```bash
psqlq -tAc "SELECT count(*) FROM users WHERE \"coinsBalance\" < 0"
psqlq -tAc "SELECT count(*) FROM users u WHERE u.\"coinsBalance\" <> COALESCE((SELECT SUM(c.delta) FROM coin_transactions c WHERE c.\"userId\" = u.id), 0)"
psqlq -tAc "SELECT value FROM system_configs WHERE key = 'loyalty.vnd_per_point_redeem'"
```

Hai số đầu phải là `0`; dòng thứ ba phải không có dòng nào (mặc định 1000) hoặc `1000`. Khác đi: đối soát tay với Tech lead TRƯỚC ngày deploy (đây là điều kiện sửa được trước, không phải lý do dừng giữa lúc đang bảo trì).

Migration không có trong bảng trên chỉ thêm cột, bảng nhỏ hoặc dữ liệu tham chiếu (spec `db-checks.spec.ts` quét mọi migration sau bản PROD, gồm `LOCK TABLE` và SQL động, để bảng khớp danh sách nặng của `go-live:check`; migration thêm sau này mà vượt quy tắc quét thì spec đỏ cho tới khi được thêm vào danh sách). Khi danh sách có migration ngoài sáu cái của đợt, mục 7.0 bắt buộc: chỉ có thể quay lại bằng khôi phục bản backup (7.3).

- [ ] Đã ghi bản PROD đang chạy (image khớp DB) và số migration chờ áp
- [ ] Đã đối chiếu từng tên với bảng migration nặng; PD-3 (nếu có) đã kiểm 0, 0, 1000

### 1.1 Redis phải là `noeviction`

```bash
$DC exec -T redis redis-cli config get maxmemory-policy
```

Phải thấy dòng thứ hai là `noeviction`. Compose đang nằm trên máy chủ (bản cũ) vẫn đặt `allkeys-lru`, nên tạo lại container Redis lúc này bằng `$DC up -d redis` KHÔNG đổi được gì (nó đọc compose cũ). Làm hai việc:

1. Đổi ngay bằng lệnh nóng, không cần khởi động lại và không làm API lỗi, làm được cả ban ngày:

```bash
$DC exec -T redis redis-cli config set maxmemory-policy noeviction
$DC exec -T redis redis-cli config get maxmemory-policy
$DC exec -T redis redis-cli config get appendonly
```

Kỳ vọng: `OK`, `noeviction` và `yes`. Giá trị này mất nếu container khởi động lại trước deploy, nên kiểm lại ở mục 5 bước 4.

2. Đặt vĩnh viễn bằng cách tạo lại container Redis với compose MỚI: làm ở mục 5 bước 5, sau khi đã lấy mã mới về máy chủ (bước 1) và API đã dừng (dữ liệu nằm trong volume, không mất).

Vì sao: BullMQ giữ mọi job trong Redis, `allkeys-lru` có thể xoá âm thầm job đang chờ (huỷ vận đơn Gomdon, gửi lại ZNS). `go-live:check --phase=pre-deploy` chỉ báo WARN cho dòng này (compose cũ), còn sau deploy khác `noeviction` là FAIL.

- [ ] Redis `noeviction` (đã đổi nóng) và `appendonly yes`; việc đặt vĩnh viễn nằm ở mục 5 bước 5

### 1.2 Backup 6 giờ/lần, bản ngoài máy, và diễn tập khôi phục

Làm theo [tools/backup/README.md](../../tools/backup/README.md), các mục "Cài đặt trên VPS Vietnix", "Cài crontab (6 giờ/lần)" và "Diễn tập restore". Tóm tắt những gì phải có:

- `rclone config` đã tạo remote Google Drive tên `gdrive` (scope `drive.file`, xác thực bằng `rclone authorize` trên laptop; từng bước ở mục "Remote Google Drive" của README trên), thử được: `rclone lsd gdrive:`. Rồi bọc nó bằng remote **crypt** `tubucrypt` (mục "Mã hoá bản ngoài máy" của README trên): `backup-db.sh` từ chối đẩy lên remote không mã hoá. `BACKUP_ALLOW_PLAIN_REMOTE=1` chỉ là ngoại lệ tạm thời có chủ ý.
- Cron **6 giờ/lần** (00:17, 06:17, 12:17, 18:17; mẫu ở [ops/crontab.backup.example](../../ops/crontab.backup.example)) có `BACKUP_LABEL=cron BACKUP_KEEP_COUNT=120 RCLONE_REMOTE=tubucrypt: HEALTHCHECK_URL=...` trên MỘT dòng. Mất tối đa 6 giờ dữ liệu khi phải khôi phục (cron 02:00 một lần/ngày cũ là 24 giờ); sổ Ví, Điểm Xanh và hoa hồng chỉ nằm trong DB này. Dòng 02:00 cũ phải xoá (README ở trên có lệnh thay). Kiểm: `crontab -l | grep backup-db | sed -E 's#HEALTHCHECK_URL=[^ ]+#HEALTHCHECK_URL=***#'`; trên healthchecks.io đặt Period 6 giờ, Grace 1 giờ.
- Bản trước mỗi deploy: `bash ops/backup-predeploy.sh` (nhãn `predeploy`, giữ 10 bản, không ping check của cron). Bước 6 mục 5 vẫn dùng `backup-db.sh` như cũ (bản cuối khi API đã dừng).
- Một bản backup chạy tay thành công, và đã **diễn tập khôi phục** vào DB tạm rồi so số dòng:

```bash
COMPOSE_FILE=docker-compose.vietnix.yml POSTGRES_USER=$PGUSER POSTGRES_DB=$PGDB RCLONE_REMOTE=tubucrypt: bash tools/backup/backup-db.sh
F=$(ls -t /var/backups/tubutree/tubutree_*.sql.gz | head -1); echo "$F"
$DC exec -T postgres psql -U "$PGUSER" -d postgres -c 'CREATE DATABASE tubutree_drill'
gunzip -c "$F" | $DC exec -T postgres psql -q -v ON_ERROR_STOP=1 --single-transaction -U "$PGUSER" -d tubutree_drill > /dev/null
for db in "$PGDB" tubutree_drill; do
  $DC exec -T postgres psql -U "$PGUSER" -d $db -tAc "SELECT '$db', (SELECT count(*) FROM orders), (SELECT count(*) FROM users), (SELECT count(*) FROM _prisma_migrations)"
done
$DC exec -T postgres psql -U "$PGUSER" -d postgres -c 'DROP DATABASE tubutree_drill'
```

Kỳ vọng: hai dòng số khớp nhau (chênh vài đơn mới nếu đang có khách). Ghi lại thời gian chạy `backup-db.sh` (dùng `time` đứng trước lệnh): cần cho mục 3.

Diễn tập lần đầu nên lấy bản về TỪ NGOÀI MÁY (`rclone copy tubucrypt:<file> /tmp/`, rồi nạp file đó thay cho `$F`) và bấm giờ cả bước nạp: số đó là thời gian khôi phục thật (RTO). Khối lệnh có sẵn bấm giờ nằm ở mục "Diễn tập restore" của [tools/backup/README.md](../../tools/backup/README.md). Lặp lại mỗi tháng.

Về quyền chạy: hai script `tools/backup/backup-db.sh` và `restore-db.sh` đã được commit với quyền chạy (mode 755), nhưng bản mã đang nằm trên máy chủ có thể còn là bản cũ (644). Vì vậy mọi lệnh trong tài liệu này gọi chúng bằng `bash tools/backup/...`. KHÔNG `chmod` trên máy chủ: nó làm `git status` bẩn và bước 1 của mục 5 dừng. Dòng cron backup do `ops.yml` (hành động `crontab`, nay cài lịch 6 giờ/lần) hoặc `crontab -e` cài gọi thẳng đường dẫn script, không qua `bash`: nó chạy được từ khi máy chủ đã nhận bản mã mới ở bước 1 (mục 5). Nếu cron đã cài từ trước và đêm đó chưa có bản mã mới, xem `tail /var/log/tubutree-backup.log`: thấy `Permission denied` thì sửa tạm dòng cron thành `bash <đường dẫn script>` (`crontab -e`).

- [ ] Có remote rclone, cron 6 giờ/lần (không còn dòng 02:00 cũ), healthcheck
- [ ] Đã diễn tập khôi phục (bản lấy từ remote), số dòng khớp
- [ ] Thời gian một lần backup: ______ phút
- [ ] Thời gian khôi phục (RTO, bước nạp bản backup vào DB tạm): ______ phút

### 1.3 Biến môi trường trong `/opt/tubutree/.env`

Mở file bằng `nano .env` (hoặc, cho các khoá ghi được, trỏ lại GitHub Actions ở mục 2 rồi chạy `ops.yml`, hành động `set-env`; xem lưu ý dưới bảng, `set-env` KHÔNG thay được việc sửa tay cho vài khoá). Đối chiếu với [docs/GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md). Phải có, ngoài các khoá Pancake, Gomdon, Zalo đã có (`ACCESSTRADE_WEBHOOK_SECRET` nằm trong bảng dưới):

| Khoá trong `.env` | Ghi chú |
|---|---|
| `OPS_ALERT_WEBHOOK_URL` | URL webhook Slack, Google Chat hoặc n8n. Nên bắt đầu bằng `https://`; mã nhận cả `http://`, thiếu scheme thì API không khởi động |
| `OPS_ALERT_EMAIL_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Để trống cả bảy thì tắt kênh email. Đã đặt một biến thì chỉ bắt buộc `OPS_ALERT_EMAIL_TO`, `SMTP_HOST` và (`SMTP_FROM`, hoặc `SMTP_USER` là địa chỉ email để dùng thay); `SMTP_USER` và `SMTP_PASS` đi cặp; `SMTP_PORT`, `SMTP_SECURE` tuỳ chọn. Đặt dở thì API không khởi động |
| `OPS_ALERT_ENV_LABEL` | Ví dụ `production`. Tối đa 24 ký tự, không có `[` `]` |
| `CORS_ORIGINS` | Ví dụ `https://app.tubutree.com,https://tubutree.com` |
| `ACCESSTRADE_WEBHOOK_SECRET` | Bắt buộc ở production: rỗng thì API không khởi động và `go-live:check` FAIL. Chuỗi ngẫu nhiên (`openssl rand -hex 32`), dán y hệt vào header `x-accesstrade-token` bên Accesstrade |
| `AUTH_COOKIE_SAMESITE`, `AUTH_COOKIE_DOMAIN` | `lax` và (nếu cần chia sẻ phiên giữa subdomain) `.tubutree.com` |
| `THROTTLE_BYPASS_TOKEN` | Chuỗi ngẫu nhiên từ 32 ký tự (`openssl rand -hex 32`), CÙNG một giá trị cho `api` và `web` (xem ghi chú dưới) |

Lưu ý về `ops.yml`, hành động `set-env` (xem nhánh `set-env` trong `.github/workflows/ops.yml`): nó KHÔNG BAO GIỜ ghi `THROTTLE_BYPASS_TOKEN`, `AUTH_COOKIE_SAMESITE` và `AUTH_COOKIE_DOMAIN`, nên ba khoá này phải sửa tay bằng `nano .env` kể cả khi đã dùng `set-env` cho các khoá khác. Ngược lại, nó GHI ĐÈ `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `GEMINI_BASE_URL` và `GEMINI_MODEL` về giá trị cố định trong workflow mỗi lần chạy (bản sao `.env.bak.<giờ>` được tạo trước), nên nếu đã chỉnh tay các khoá đó thì đừng chạy `set-env`. Các khoá còn lại chỉ được ghi khi secret không rỗng; `CORS_ORIGINS` chỉ được thêm khi đang thiếu hoặc rỗng.

Ghi chú về `THROTTLE_BYPASS_TOKEN`: production nên đặt (xem [docs/2026-10-review/impl/PA-2.md](../2026-10-review/impl/PA-2.md)). Web render phía máy chủ gọi API từ một IP, nên không có token thì khi đông các lượt render cùng dính giới hạn 300 yêu cầu/phút cho mỗi route và khách thấy lỗi 429. Token dài dưới 32 ký tự thì API không khởi động. Không thêm tiền tố `NEXT_PUBLIC_` (sẽ lộ ra trình duyệt). `go-live:check` báo WARN khi chưa đặt, FAIL khi quá ngắn. Theo dõi 429 bằng `$DC logs --since 1h web | grep -c 429`.

- [ ] `.env` đủ khoá, `THROTTLE_BYPASS_TOKEN` đã đặt (≥ 32 ký tự, cùng giá trị cho api và web)

### 1.4 Chọn giờ (mục 3) và báo trước

- [ ] Đã chọn giờ theo mục 3 (tính từ danh sách chờ áp ở 1.0) và báo các admin (mẫu tin ở mục 5, bước 12)
- [ ] Bản Zalo Mini App mới đã build sẵn nhưng CHƯA phát hành (ràng buộc 1)
- [ ] Còn trống đĩa: `df -h /` còn ít nhất 3 lần dung lượng bảng orders (các migration viết lại mọi dòng và dựng chỉ mục): `psqlq -tAc "SELECT pg_size_pretty(pg_total_relation_size('orders'))"`. Nếu danh sách chờ áp có p4 (1.0) thì cộng thêm dung lượng bảng `users` (`pg_total_relation_size('users')`)

### 1.5 Thay đổi cấu hình hạ tầng đi kèm bản này (2026-10-18)

Tất cả tương thích ngược: không đổi cổng, tên service, volume hay thứ tự deploy ở mục 5. Chỉ cần biết chúng có hiệu lực lúc nào.

| Thay đổi | Nằm ở | Hiệu lực khi | Cách kiểm |
|---|---|---|---|
| API đặt `keepAliveTimeout` 125 s và `headersTimeout` 126 s (trước: mặc định 5 s, thỉnh thoảng 502 lẻ do Apache tái dùng kết nối Node vừa đóng) | mã API (`config/http-timeouts.ts`) | bước 9 (API mới chạy) | không cần làm gì; 502 lẻ `error reading status line` trong `/www/wwwlogs/api.tubutree.com-error_log` biến mất |
| Web đặt `KEEP_ALIVE_TIMEOUT=55000`, container web chạy user `node` (trước: root) | `docker-compose.vietnix.yml`, `apps/web/Dockerfile` | bước 3 (build) và bước 8 (web mới) | `$DC exec -T web id -un` ra `node`; `$DC logs --since 10m web \| grep -ci eacces` ra 0 |
| Trần CPU `cpus` cho api (1.0) và web (1.0) | `docker-compose.vietnix.yml` | web: bước 8, api: bước 9 (mỗi service nhận khi được tạo lại ở bước đó) | `docker inspect -f '{{.HostConfig.NanoCpus}}' "$($DC ps -q api)"` ra `1000000000` |
| Vhost Apache: `ProxyPass ... ttl=30` và `mod_deflate` (nén JSON/HTML/JS/CSS) | `ops/vietnix-vhost-*.conf.phase2` | khi dán lại hai file này (xem dưới), độc lập với deploy | `bash ops/check-edge.sh` dòng `nén:` có `content-encoding=gzip` |

Chỉnh CPU theo số vCPU thật của máy: chạy `nproc`. VPS của Tubu Tree có từ 8 vCPU nên khuyến nghị `API_CPUS=2` (và `WEB_CPUS=1`); máy ít lõi hơn thì đặt nhỏ hơn. Đặt trong `.env` (KHÔNG sửa compose: `git status` bẩn làm bước 1 dừng) `API_CPUS=2`, `WEB_CPUS=1` rồi tạo lại container tương ứng (`$DC up -d --no-deps <service>`). Mặc định cố ý không vượt 1 lõi vì Docker từ chối khởi động container có `cpus` lớn hơn số vCPU (lỗi `Range of CPUs is from 0.01 to 1.00` ở bước 8 hoặc 9: đặt `*_CPUS` nhỏ hơn rồi chạy lại lệnh `up -d`).

**Không đổi cấu hình `postgres` hoặc `redis` trong `docker-compose.vietnix.yml` kèm một bản deploy.** `tools/deploy/deploy.sh` bước 4 chạy `dc up -d --no-build api` KHÔNG có `--no-deps`; compose v2 hội tụ luôn các service phụ thuộc, nên mọi thay đổi cấu hình của postgres hoặc redis (`cpus`, `shm_size`, `command`, `healthcheck`...) khiến chúng bị tạo lại ngay giữa deploy: DB ngắt khoảng 10 giây, 5xx, BullMQ mất kết nối. Vì vậy bản này cố ý không đổi hai service đó. Khi thực sự cần đổi, tạo lại chủ động NGOÀI giờ cao điểm, TRƯỚC khi chạy deploy: `$DC up -d --no-deps postgres redis` (dữ liệu ở volume, không mất); sau đó deploy bình thường sẽ không còn gì để tạo lại.

Cập nhật vhost (chỉ khi đang dùng bản phase2, tức đã có chứng chỉ; còn phase1 thì làm theo [ops/README-vietnix-deploy.md](../../ops/README-vietnix-deploy.md) rồi dán phase2 mới. Làm ban ngày được, `graceful` không rớt kết nối đang có; backup lại hai file cũ trước):

```bash
TS=$(date +%Y%m%d-%H%M%S); V=/www/server/panel/vhost/apache; AP=/www/server/apache/bin/apachectl
for h in api app; do sudo cp $V/$h.tubutree.com.conf /root/$h.tubutree.com.conf.bak.$TS; done
sudo cp ops/vietnix-vhost-api.conf.phase2 $V/api.tubutree.com.conf
sudo cp ops/vietnix-vhost-app.conf.phase2 $V/app.tubutree.com.conf
if sudo $AP configtest; then
  sudo $AP -k graceful
else
  echo "configtest LỖI: chép lại hai file cũ, KHÔNG graceful" >&2
  for h in api app; do sudo cp /root/$h.tubutree.com.conf.bak.$TS $V/$h.tubutree.com.conf; done
  sudo $AP configtest
fi
$AP -M 2>/dev/null | grep -E 'deflate|filter|remoteip'
bash ops/check-edge.sh --local
```

`configtest` phải in `Syntax OK`. Apache này dùng chung với ChoDeli/WordPress nên khối lệnh tự chép hai file `.bak.$TS` về lại và KHÔNG `graceful` khi `configtest` lỗi (file lỗi để nguyên trên đĩa sẽ làm hỏng lần reload kế tiếp của aaPanel, kéo cả ChoDeli theo); lệnh `configtest` cuối khối phải in lại `Syntax OK`, nếu không thì dừng và báo. Không thấy `deflate_module` hoặc `filter_module` thì khối nén bị bỏ qua (không lỗi): nén vẫn có khi bật ☁ cam của Cloudflare. Quay lại sau khi đã áp dụng: chép hai file `.bak.*` về đúng chỗ rồi `configtest` và `graceful`. Nếu error_log vẫn có `error reading status line` lẻ, thêm `disablereuse=On` sau `ttl=30` ở dòng `ProxyPass` của vhost api (mỗi request một kết nối mới, tốn thêm chút độ trễ).

- [ ] Đã dán lại vhost phase2, `configtest` Syntax OK, `ops/check-edge.sh` không có FAIL
- [ ] `nproc` đã xem và `*_CPUS` trong `.env` phù hợp (hoặc để mặc định 1 lõi mỗi service)

### 1.6 Việc của chủ dự án quanh ngày ra mắt (cấu hình đã chốt 2026-10-18)

Các giá trị mặc định mới (hoa hồng giữ 10 ngày, freeship đơn đầu từ 199.000đ, bố cục khách mới, xem trước cộng đồng, duyệt gian hàng lần đầu, trần mã của nhân viên, tài khoản nhận tiền, SĐT kho Gomdon) đã nằm trong mã, dữ liệu nạp và migration `20261018200000_launch_owner_config`, không cần làm tay, TRỪ duyệt gian hàng (xem ngay dưới). Hạng thành viên, bậc đại lý, nhiệm vụ và 6 khoá kinh doanh (quyết định A8) nạp bằng `prisma:seed:reference --with-business-defaults` ở bước 7b, cũng không cần làm tay; `go-live:check` báo FAIL `db.membership_tiers` nếu thiếu. Việc dưới đây thì chủ dự án làm, theo thứ tự.

**Duyệt gian hàng lần đầu cần việc tay (B3).** `storefront.require_approval` nay mặc định `true`, và migration `20261018170000_lr_storefront_moderation` KHÔNG điền `approvedAt` cho gian hàng có sẵn. Vì vậy mọi gian hàng CTV đã đăng trước ngày deploy bị ẨN khỏi khách (và ngừng ghi nhận đơn cho CTV) cho tới khi admin duyệt. Trước deploy, đếm trên PROD:

```sql
SELECT count(*) FROM storefronts WHERE type='CTV' AND "isPublished" AND "approvedAt" IS NULL AND "takenDownAt" IS NULL AND NOT "isPartner";
```

Số khác 0 thì chọn một: (a) ngay sau deploy, vào Quản trị, tab "Gian hàng", lọc "Chờ duyệt" và duyệt từng gian hàng đáng tin; hoặc (b) tạm đặt `storefront.require_approval` = `false` ở tab Cấu hình để giữ nguyên hiện trạng, duyệt xong hàng loạt rồi bật lại `true`.

#### 1.6.1 Đồng bộ TOÀN BỘ sản phẩm Pancake sang Tubu Tree (A5)

Hệ thống chỉ có MỘT đường đưa sản phẩm từ Pancake sang: `PancakeSyncService` (`apps/api/src/modules/integrations/pancake/pancake-sync.service.ts`). Không có cờ bật/tắt riêng: có khoá Pancake trong `.env` là nó chạy.

1. **Khoá trong `/opt/tubutree/.env`** (xem [docs/GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md)): `PANCAKE_API_KEY`, `PANCAKE_SHOP_ID` (đúng shop có hàng bán), `PANCAKE_WEBHOOK_SECRET` (bắt buộc ở production), `PANCAKE_BASE_URL` để mặc định `https://pos.pages.fm/api/v1`. Thiếu `PANCAKE_API_KEY` hoặc `PANCAKE_SHOP_ID` thì đồng bộ im lặng bỏ qua (log `Pancake chưa cấu hình`). Đổi `.env` xong phải tạo lại container api (`$DC up -d --no-deps api`), vì chỉ đọc `.env` lúc khởi động.
2. **Thứ tự**: dọn demo (bước 7c) TRƯỚC khi API chạy với khoá Pancake. Sản phẩm demo có mã Pancake giả `seed-...`, nên quét toàn bộ coi chúng là "đã biến khỏi Pancake" và cũng tắt; đã tắt bằng lệnh dọn thì quét không đụng, và SKU đã đổi `DEMO-<sku>` nên không đụng SKU hàng thật.
3. **Lần quét đầu tiên (toàn bộ)** tự chạy khi API khởi động (chỉ replica giữ khoá cron). Chạy tay thì Quản trị, tab "Sức khoẻ hệ thống", nút "Đồng bộ danh mục Pancake" (hoặc `POST /api/admin/pancake/sync` bằng tài khoản ADMIN). KHÔNG chọn "ghi đè tồn kho" (`?withStock=1`) cho lần đầu: hàng mới được tạo với đúng tồn Pancake rồi, ghi đè chỉ dùng khi tồn kho đã lệch thật. Kết quả hiện số sản phẩm đã đồng bộ; log API: `Đã đồng bộ N sản phẩm từ Pancake`. 409 `CATALOG_SYNC_RUNNING` nghĩa là một lượt khác đang chạy: đợi vài phút.
4. **Sau đó tự chạy**: mỗi 15 phút (chỉ sản phẩm đổi từ lần trước) và mỗi đêm 03:30 (quét toàn bộ, có bước ngừng bán hàng đã xoá khỏi Pancake). Sau mỗi lần API khởi động lại, lượt 15 phút đầu tiên cũng là quét toàn bộ (mốc "lần trước" nằm trong bộ nhớ).
5. **Cái gì được sao chép**:
   - Tên, mô tả, ảnh (ảnh sản phẩm, rồi ảnh biến thể; Pancake không có ảnh thì giữ ảnh cũ), giá bán (`retail_price`), giá khuyến mãi (`sale_price`), cân nặng, SKU, thuộc tính biến thể. **Các trường này bị ghi đè mỗi lần đồng bộ**: sửa tên, mô tả, giá trong Quản trị sẽ mất; muốn đổi thì đổi ở Pancake.
   - Tồn kho đi theo chênh lệch và trừ phần đang giữ chỗ, nên quét toàn bộ không hồi sinh hàng vừa bán hết.
   - Sản phẩm mới tạo ra với nhãn `Tubu Tree`, phân khúc suy từ tên (`forSegment`), `isFeatured = false`, đã duyệt và ĐANG BÁN ngay: khách thấy toàn bộ hàng của shop Pancake ngay sau lần quét đầu. Có món không muốn bán trên app thì tắt tay trong Quản trị sau lần quét (tắt tay được giữ, đồng bộ không tự bật lại).
   - Biến thể chưa có giá hợp lệ: không mở bán tới khi Pancake có giá (`pancakeHold = NO_PRICE`), không hiện "0đ".
6. **Danh mục**: đồng bộ KHÔNG tự gán danh mục nếu chưa có bản đồ (bước 6b). Sản phẩm mới có `categoryIds` rỗng: vẫn thấy ở danh sách chung, tìm kiếm, trang sản phẩm và theo phân khúc, nhưng KHÔNG thấy trong trang từng danh mục, và danh mục không có sản phẩm đang bán bị Mini App ẩn (7 danh mục demo được giữ lại sẽ ẩn cho tới khi có hàng). Gán bằng Quản trị (ADMIN), không cần SQL:
   1. Quản trị, nhóm "Người bán", mục "Danh mục sản phẩm". Mặc định đã bật hai bộ lọc "Chưa có danh mục" và "Chỉ hàng Pancake"; gõ tên hoặc SKU để thu hẹp.
   2. Tick các sản phẩm (hoặc "Chọn tất cả ... đang hiện"; "Tải thêm" để đưa thêm sản phẩm vào danh sách), chọn danh mục ở ô "Chọn danh mục…", bấm "Gán danh mục", xác nhận. Tối đa 500 sản phẩm mỗi lần. "Gỡ danh mục" làm ngược lại. Gán thêm không xoá danh mục khác của sản phẩm.
   3. Đồng bộ Pancake không ghi đè danh mục đã gán. Danh mục Mini App được ghi nhớ khoảng một phút nên đợi hoặc tải lại.

   6b. **Tự gán theo nhóm hàng Pancake (tuỳ chọn)**. Pancake có nhóm hàng (`category_ids` của sản phẩm; danh sách ở `GET /shops/{SHOP_ID}/categories`). Mở "Danh mục sản phẩm", cuối trang bấm "Xem nhóm hàng Pancake và bản đồ tự gán" để thấy mã/tên nhóm của shop. Tab "Cấu hình", khoá `pancake.category_map` (nạp bởi bước 7b với giá trị `{}`): `{"<mã hoặc tên nhóm Pancake>": "<id danh mục Tubu>"}`; id danh mục lấy ở ô chọn danh mục (hoặc `GET /api/categories`). Bản đồ chỉ áp cho sản phẩm CHƯA có danh mục ở các lần đồng bộ sau (kể cả quét toàn bộ 03:30 hoặc nút "Đồng bộ danh mục Pancake"); sản phẩm đã có danh mục, kể cả do bản đồ gán trước đó, không bị đổi khi sửa bản đồ: muốn gán lại thì gỡ danh mục ở màn "Danh mục sản phẩm". Lần đầu chạy với dữ liệu thật: kiểm kết quả ở màn "Danh mục sản phẩm" (bộ lọc "Chưa có danh mục") và nếu GET sản phẩm của Pancake không trả `category_ids` thì bản đồ không có tác dụng, dùng gán tay.
7. **Ngừng bán hàng đã xoá khỏi Pancake (`deactivateMissing`) có thể ẩn nhầm không?** Chỉ chạy ở lần quét toàn bộ, và chỉ khi Pancake trả `total_pages`/`total_entries` và đọc đủ số trang, số sản phẩm; thiếu một trong hai thì lượt đó báo lỗi và KHÔNG tắt gì. Chỉ đụng sản phẩm, biến thể có mã Pancake (bỏ hàng đối tác tự giao, mã `MCH_...`, và hàng tắt tay). Nếu số bị loại vượt nửa số đang bán thì không tự tắt, chỉ ghi lỗi `vượt ngưỡng an toàn` vào log. Ẩn nhầm vẫn có thể xảy ra khi: đặt nhầm `PANCAKE_SHOP_ID` sang shop khác ít hàng hơn (dưới ngưỡng nửa), hoặc nhân viên lưu trữ/xoá sản phẩm trên Pancake. Hàng bị tắt kiểu này mang `pancakeHold = REMOVED` và tự bật lại ở lần quét sau khi Pancake trả lại; xem log `Ngừng bán vì không còn trên Pancake:` (liệt kê mã) và Quản trị, Sức khoẻ hệ thống, trạng thái đồng bộ danh mục.
8. **Kiểm sau lần quét đầu**: `psqlq -c "SELECT count(*) FILTER (WHERE \"isActive\") AS dang_ban, count(*) AS tong FROM products WHERE \"pancakeId\" NOT LIKE 'seed-%'"` khớp số sản phẩm trên Pancake; mở Mini App, tìm một món, thêm giỏ, xem giá và tồn đúng như Pancake.

#### 1.6.2 Backup lên Google Drive (A11)

Đã chốt lưu bản backup ngoài máy trên Google Drive. Làm theo [tools/backup/README.md](../../tools/backup/README.md), mục "Remote Google Drive" (tạo remote `gdrive` với scope `drive.file`, xác thực trên laptop bằng `rclone authorize`). Tóm tắt:

1. Laptop: `rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ=="`, đăng nhập Google, chép khối `{"access_token":...}`. VPS: `rclone config`, remote tên `gdrive`, loại `drive`, scope `drive.file`, "Use web browser to automatically authenticate" chọn `n`, dán khối JSON. `rclone config update gdrive use_trash false` để bản cũ bị xoá hẳn thay vì chiếm chỗ trong thùng rác.
2. Thử: `rclone mkdir gdrive:tubutree-backups && rclone lsd gdrive:`.
3. Bọc Drive bằng remote crypt (bản trần bị `backup-db.sh` từ chối; lệnh y như README, mục "Mã hoá bản ngoài máy", trỏ vào thư mục MỚI `tubutree-backups-enc`, không dùng lại thư mục có bản trần): `PASS1=$(openssl rand -base64 32); PASS2=$(openssl rand -base64 32); rclone config create tubucrypt crypt remote gdrive:tubutree-backups-enc filename_encryption standard directory_name_encryption true password "$(rclone obscure "$PASS1")" password2 "$(rclone obscure "$PASS2")"; echo "$PASS1"; echo "$PASS2"; unset PASS1 PASS2`. Chép cả hai mật khẩu vào password manager của chủ (ngoài VPS, thêm một bản ở nơi thứ hai) ngay lúc này: mất là mọi bản backup ngoài máy không đọc lại được. Rồi `chmod 600 ~/.config/rclone/rclone.conf`, thử `rclone listremotes --long` (có dòng `tubucrypt:  crypt`) và `echo test | rclone rcat tubucrypt:thu.txt && rclone cat tubucrypt:thu.txt && rclone delete tubucrypt:thu.txt`.
4. Cron mỗi 6 giờ, một dòng, có `RCLONE_REMOTE=tubucrypt:` và `REMOTE_KEEP_DAYS=90` (mẫu ở [ops/crontab.backup.example](../../ops/crontab.backup.example)): `17 */6 * * * COMPOSE_FILE=/opt/tubutree/docker-compose.vietnix.yml BACKUP_LABEL=cron BACKUP_KEEP_COUNT=120 RCLONE_REMOTE=tubucrypt: REMOTE_KEEP_DAYS=90 HEALTHCHECK_URL=<url> /opt/tubutree/tools/backup/backup-db.sh >> /var/log/tubutree-backup.log 2>&1`.
5. Trước mỗi deploy: `cd /opt/tubutree && COMPOSE_FILE=docker-compose.vietnix.yml RCLONE_REMOTE=tubucrypt: bash ops/backup-predeploy.sh`.
6. Diễn tập khôi phục MỘT lần trước ra mắt với bản lấy từ `tubucrypt:` (`rclone copy tubucrypt:<file> /tmp/`), khối lệnh ở mục 1.2 và README, ghi thời gian vào ô RTO.
7. Sau khi bản mã hoá đầu tiên đã kiểm (`rclone ls tubucrypt:` thấy file, diễn tập bước 6 qua): xoá bản trần cũ nếu có, `rclone purge gdrive:tubutree-backups` rồi dọn thùng rác Drive. Việc dọn bản cũ theo `REMOTE_KEEP_DAYS` chỉ chạy trên `tubucrypt:` nên không tự xoá chúng.

#### 1.6.3 Đợt thẻ hộp hàng sàn đầu tiên (A12)

Quản trị, tab Voucher, khung "Thẻ hộp hàng sàn (mã ẩn)" (chi tiết từng bước: [impl/claim.md](../2026-10-18-launch-review/impl/claim.md) mục 4). Điền đúng cấu hình đã chốt:

| Ô | Giá trị |
|---|---|
| Kiểu đợt | "Lô mã riêng (mỗi thẻ một mã)" |
| Tiền tố lô | một tiền tố riêng mỗi đợt, ví dụ `SHOPEE11` |
| Số thẻ | số thẻ sẽ in (tối đa 2.000 mỗi lô) |
| Loại và mức giảm | giảm tiền, 30.000đ |
| Đơn tối thiểu | 199.000đ |
| Ngày bắt đầu, hết hạn | hôm nay, và hôm nay cộng 60 ngày |
| Chỉ khách mới | bật (mặc định) |

Trước đó đặt một lần `app.miniapp_base_url` (Cấu hình, nhóm `app`) = `https://zalo.me/s/<appId>`, rồi bấm "Tạo lô và tải CSV" và gửi file cho nhà in. Freeship đơn đầu từ 199.000đ đã bật sẵn (`shipping.first_order_free_enabled`, `shipping.first_order_free_min_subtotal`) và cộng dồn với mã thẻ chỉ-khách-mới: đơn đầu vừa được giảm 30.000đ trên tiền hàng vừa được miễn phí giao kiện Tubu; mã FREESHIP của khách không bị tiêu cho đơn đó.

#### 1.6.4 Gian hàng CTV dạng `<mã>.tubutree.com` (B4)

Mã web đã sẵn sàng: `apps/web/src/middleware.ts` nhận host `<một nhãn>.<tên miền gốc>` rồi viết lại trang chủ sang `/s/<nhãn>`; các nhãn `www`, `admin`, `api`, `app`, `mail` là của hệ thống; API đã cho phép CORS cho mọi `*.tubutree.com`. Tên miền gốc lấy từ biến BUILD `NEXT_PUBLIC_TENANT_ROOT_DOMAIN`, mặc định `tubutree.com`; `docker-compose.vietnix.yml` truyền sẵn `${WEB_DOMAIN}`, nên chỉ cần dựng lại web khi `WEB_DOMAIN` không phải `tubutree.com`. Việc còn lại là hạ tầng, làm theo thứ tự và KHÔNG bật cờ trước khi bước 4 qua:

1. **DNS Cloudflare**: thêm bản ghi `A` tên `*` trỏ `14.225.207.177`. Các bản ghi riêng (`api`, `app`, `www`, `mail`, và `hello` của link-bio nếu trỏ chỗ khác) giữ nguyên, bản ghi riêng luôn thắng wildcard. Một nhãn nào còn rơi vào wildcard sẽ bị coi là gian hàng (vd `hello` sẽ thành `/s/hello`, 404).
2. **Chứng chỉ wildcard**, chọn MỘT trong hai:
   - Certbot DNS-01 với plugin Cloudflare (root): tạo token API Cloudflare quyền `Zone:DNS:Edit` cho zone `tubutree.com`, lưu `dns_cloudflare_api_token = <token>` vào `/root/.secrets/cloudflare.ini` (`chmod 600`), cài `python3-certbot-dns-cloudflare`, chạy `certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini --cert-name tubutree-wildcard -d '*.tubutree.com'`. Chứng chỉ nằm ở `/etc/letsencrypt/live/tubutree-wildcard/`, cron `certbot renew` hiện có tự gia hạn (kiểm `certbot renew --dry-run`).
   - Hoặc bật proxy ☁ cam cho bản ghi `*` và dùng Origin Certificate của Cloudflare (Cloudflare, SSL/TLS, Origin Server, host `*.tubutree.com`), chế độ SSL "Full (strict)".
3. **Vhost Apache cho wildcard** (file mới, ví dụ `ops/` bản sao đặt ở `/www/server/panel/vhost/apache/`; Apache chọn vhost khớp ĐẦU TIÊN theo thứ tự file, nên file này phải được nạp SAU hai vhost `app.` và `api.`, đặt tên file sắp xếp sau chúng): `ServerName` đặt `wildcard.tubutree.com`, `ServerAlias *.tubutree.com`, `SSLCertificateFile`/`SSLCertificateKeyFile` trỏ chứng chỉ ở bước 2, và đúng khối proxy của `ops/vietnix-vhost-app.conf.phase2` (`ProxyPreserveHost On`, `RequestHeader set X-Forwarded-Proto "https"`, `ProxyPass / http://127.0.0.1:14000/ ttl=30`, `ProxyPassReverse`). Cổng 80 chuyển hướng sang https. Chạy `apachectl configtest` rồi `apachectl -k graceful` (đừng restart: chung với ChoDeli/WordPress).
4. **Kiểm**: `dig +short thu.tubutree.com` ra `14.225.207.177`; `curl -sI https://<mã-gian-hàng-thật>.tubutree.com/` trả 200 (trang gian hàng), `curl -sI https://khong-co-gian-hang.tubutree.com/` trả 404 của web (không phải trang WordPress hay lỗi chứng chỉ); `https://app.tubutree.com` và `https://api.tubutree.com/api/health` vẫn bình thường.
5. **Bật cờ**: Quản trị, Cấu hình, `storefront.subdomain_enabled` = `true` (mặc định `false`). Từ lúc này trang gian hàng và trang quản lý của CTV mới hiện và chia sẻ link `<mã>.tubutree.com`. Nếu `WEB_DOMAIN` khác `tubutree.com` thì đặt `NEXT_PUBLIC_TENANT_ROOT_DOMAIN` đúng tên miền gốc, dựng lại web (`$DC build web` rồi `$DC up -d --no-deps web`) trước bước 4.

Sự cố: tắt lại cờ `storefront.subdomain_enabled` là link `/s/<mã>` hoạt động lại như cũ, DNS và chứng chỉ để nguyên được.

#### 1.6.5 Đăng ký website/ứng dụng với Bộ Công Thương

Nếu chưa làm: đăng ký website (và ứng dụng Mini App) thương mại điện tử với Bộ Công Thương tại https://online.gov.vn (thông báo website bán hàng, hoặc đăng ký website cung cấp dịch vụ TMĐT). Cần giấy phép kinh doanh, thông tin pháp nhân (CÔNG TY TNHH TUBU TREE, MST 0319585995) và địa chỉ website `https://app.tubutree.com`; sau khi được xác nhận, đưa biểu tượng "Đã thông báo Bộ Công Thương" vào chân trang. Đây là việc chủ dự án tự làm, mã không làm thay được.

### 1.7 AI tư vấn qua Antigravity gateway (tuỳ chọn, mặc định ẩn)

Quyết định của chủ dự án: AI tư vấn trong Mini App chạy trên cùng bộ Antigravity mà ChoDeli đang dùng. API Tubu KHÔNG tự chạy lệnh `agy`; nó gọi HTTP tới container `antigravity_gateway` (nằm ở `/opt/antigravity-gateway`, cùng VPS, compose project khác). Mini App chỉ hiện lối vào AI khi API báo `aiAdvisorEnabled: true` ở `GET /config/public`, tức là AI bật VÀ có đủ cấu hình; thiếu thì nút AI ở Trang chủ và mục "Trợ lý AI 24/7" ở Cá nhân tự ẩn, không có trang lỗi. Vì vậy có thể deploy bản này khi chưa có gateway: AI cứ ẩn.

**Biến trong `/opt/tubutree/.env`** (chỉ tên, giá trị do chủ gateway cấp; KHÔNG dán key vào chat hay repo):

| Khoá | Ý nghĩa |
|---|---|
| `ANTIGRAVITY_GATEWAY_URL` | Địa chỉ gateway mà API tới được, xem cách nối bên dưới. Phải có cả URL và KEY thì mới dùng |
| `ANTIGRAVITY_GATEWAY_KEY` | Key RIÊNG cho Tubu Tree (xin chủ gateway cấp, đừng dùng chung key của ChoDeli để thu hồi riêng được) |
| `ANTIGRAVITY_MODEL` | Mặc định `gemini-3.8-flash-high` (cùng ChoDeli). Gateway báo model bị gỡ thì API tự gọi lại một lần không kèm model |
| `ANTIGRAVITY_GATEWAY_TIMEOUT_MS` | Mặc định 45000. ChoDeli dùng 65000 vì phải lớn hơn timeout nội bộ 60 giây của agy; Tubu chọn ngắn hơn vì khách đang chờ, quá hạn thì khách thấy câu "đang phản hồi chậm" |
| `AI_ADVISOR_PROVIDER` | Trống = tự chọn antigravity > deepseek > gemini theo cái đã có khoá. Đặt `antigravity` để CHỈ dùng gateway (không rơi sang khoá cũ còn sót) |
| `AI_ADVISOR_ENABLED` | `false` (hoặc `0`, `off`, `no`) là tắt khẩn cấp. Trống hoặc `true` là bật |
| `AI_ADVISOR_GLOBAL_PER_MIN`, `AI_ADVISOR_MAX_CONCURRENT` | Trần toàn hệ thống, mặc định 40 lượt/phút và 3 lượt đồng thời. Mỗi lượt agy khởi động một tiến trình (khoảng 13 giây ở ChoDeli) và gateway có trần giờ/đồng thời của chính nó (trả 429 `circuit_open`), mà gateway dùng chung với ChoDeli: đừng nâng hai số này trước khi hỏi chủ gateway |

Giới hạn khác đã có trong mã: 10 lượt/phút/người (controller), 30 lượt/giờ/người (service, bộ đếm trong bộ nhớ của một instance API), câu hỏi tối đa 500 ký tự, lịch sử tối đa 6 lượt và 3000 ký tự. Lỗi gateway không bao giờ tới khách: khách chỉ thấy câu xin lỗi (chậm, bận hoặc tạm nghỉ) kèm gợi ý sản phẩm; nhật ký chỉ ghi nhà cung cấp, mã trạng thái và lý do, không ghi câu hỏi hay mã người dùng.

**Nối API tới gateway.** `api` nằm trên network `tubu` của compose Tubu, còn gateway ở compose khác, nên hai bên mặc định KHÔNG thấy nhau. Hai cách, ưu tiên cách A:

- Cách A (khuyến nghị), network ngoài dùng chung: tìm network của gateway (`docker inspect antigravity_gateway -f '{{json .NetworkSettings.Networks}}'`), rồi thêm network đó vào service `api` trong compose Tubu dưới dạng `external: true` (mục `networks` của service và của file). Khi đó `ANTIGRAVITY_GATEWAY_URL=http://antigravity-gateway:8097` (tên service và cổng theo mặc định ChoDeli; xác nhận bằng `docker inspect` trước khi tin). Gateway KHÔNG cần mở cổng ra host. Thử nhanh không sửa compose: `docker network connect <network-gateway> "$($DC ps -q api)"`; cách này mất khi container api bị tạo lại, nên chỉ để thử.
- Cách B, cổng host: gateway publish `127.0.0.1:8097:8097`. Container API KHÔNG tới được `127.0.0.1` của host, và cổng chỉ bind loopback cũng không tới được qua `host.docker.internal`. Muốn dùng cách này phải bind cổng vào IP bridge của Docker (thường `172.17.0.1`) hoặc `0.0.0.0` kèm tường lửa chặn từ ngoài, rồi `extra_hosts: ['host.docker.internal:host-gateway']` cho api. Phức tạp và dễ mở nhầm cổng ra Internet, chỉ dùng khi cách A không làm được.

Đừng sửa `docker-compose.vietnix.yml` kèm một bản deploy (xem mục 1.5): làm riêng, ngoài giờ cao điểm, rồi mới bật AI.

**Thử đường mạng bằng curl:** chạy từ BÊN TRONG container api để chứng minh đúng đường mà API sẽ đi. Key đọc từ môi trường container, không gõ vào dòng lệnh.

```bash
$DC exec -T api sh -c 'curl -sS -m 70 -X POST "$ANTIGRAVITY_GATEWAY_URL/v1/complete" \
  -H "Authorization: Bearer $ANTIGRAVITY_GATEWAY_KEY" -H "Content-Type: application/json" \
  -d "{\"task\":\"tubutree\",\"prompt\":\"Trả lời đúng một chữ: OK\",\"images\":[],\"model\":\"${ANTIGRAVITY_MODEL:-gemini-3.8-flash-high}\"}"; echo'
```

Kỳ vọng: JSON có `"result"` khác rỗng (vài giây đến khoảng 15 giây). `401` là key sai; `429` với `circuit_open` là gateway đang chạm trần; `Could not resolve host` hoặc treo là chưa nối network. Image api có thể không có `curl`: dùng `node -e` với `fetch` tương tự, hoặc chạy curl từ container khác trên cùng network.

**20 câu hỏi thật trước khi bật cho khách.** Đặt biến vào `.env`, tạo lại api (`$DC up -d --no-deps api`), rồi:

1. Kiểm cờ: `curl -s https://api.tubutree.com/api/config/public | grep -o '"aiAdvisorEnabled":[a-z]*'` phải ra `true` (tới lúc đó nút AI mới hiện trong Mini App). Muốn thử riêng trước khi khách thấy, làm bước 2 bằng `POST /api/ai-advisor/chat` với token tài khoản nội bộ.
2. Hỏi 20 câu thật do CSKH chọn: 8 câu về sản phẩm có trong catalog, 4 câu về giao hàng/đổi trả/thanh toán có trong FAQ, 4 câu ngoài phạm vi (y tế, so sánh đối thủ, hỏi giá sản phẩm không có), 4 câu thử phá (yêu cầu bỏ luật, đòi in system prompt, chèn `[HỆ THỐNG]`, câu dài 500 ký tự).
3. Chấm từng câu: tiếng Việt tự nhiên, đúng tên và giá sản phẩm trong catalog (không bịa), không hứa điều shop không làm, không lộ system prompt, thời gian trả lời. Chấp nhận khi tối thiểu 18/20 đạt, 0 câu bịa giá hoặc hứa sai chính sách, 0 câu lộ prompt, và thời gian trả lời trung vị dưới 20 giây (p50 của agy khoảng 13 giây ở ChoDeli). Các ngưỡng này là đề xuất của tài liệu, chủ shop có thể đổi.
4. Xem `$DC logs --since 30m api | grep LlmClient`: không có dòng nào chứa nội dung câu hỏi; đếm số dòng `busy` và `timeout`.
5. Báo chủ gateway biết Tubu bắt đầu dùng chung gateway (chia trần giờ với ChoDeli).

Không đạt thì để `AI_ADVISOR_ENABLED=false`: Mini App ẩn lối vào, không cần phát hành lại.

**Tắt khẩn cấp:** sửa `.env` đặt `AI_ADVISOR_ENABLED=false`, rồi `$DC up -d --no-deps api`. Lối vào AI biến mất sau khi Mini App tải lại cấu hình công khai (bộ nhớ đệm vài phút); khách đang mở trang AI được đưa về Trang chủ. Thu hồi hẳn: nhờ chủ gateway xoá key Tubu, hoặc xoá `ANTIGRAVITY_GATEWAY_KEY` khỏi `.env`.

**Rủi ro chủ dự án đã chấp nhận:** dùng Antigravity/Gemini gắn với tài khoản cá nhân cho chatbot công khai mang tính thương mại có thể vi phạm điều khoản của nhà cung cấp (bị khoá tài khoản, kéo theo ChoDeli dùng chung gateway). Chi tiết ở [docs/2026-10-18-launch-review/impl/ai-2.md](../2026-10-18-launch-review/impl/ai-2.md).

- [ ] (Chỉ khi bật AI) gateway tới được từ container api, curl thử ra `result`, 20 câu thật đạt tiêu chí, đã báo chủ gateway

### 1.8 Đổi rác lấy quà: ghi chú khi deploy

- Kiểm chỉ mục từng phần (partial index) chạy trên một database CHƯA áp `20261020000000_waste_exchange` (ví dụ PROD trước khi deploy) sẽ báo THIẾU năm chỉ mục của migration này: ba khoá chống cộng điểm hai lần của `points_transactions` (`points_transactions_recycle_ref_key`, `points_transactions_recycle_reverse_key`, `points_transactions_gift_refund_key`), rồi `waste_points_one_warehouse_key` và `waste_point_staff_one_owner_key`. Kiểm này còn báo thiếu các chỉ mục từng phần của migration khác đang chờ áp trên database đó (ví dụ ba chỉ mục của `20261019100000_external_orders` nếu nó đi cùng lần deploy này). Đó là đúng, vì kiểm đọc thư mục migration của mã đang chạy. Sau khi migrate nó phải báo không thiếu cái nào.
- Bộ test race (gồm `partial-unique-indexes` pin 26) chạy trong workflow `.github/workflows/race.yml` (PR vào main có đụng `apps/api`, và hằng đêm) và trong `docs/2026-10-review/handoff/verify-full.sh`. Check "Race suite" đỏ trên PR phát hành là chặn phát hành.
- Tắt khẩn cấp: đặt waste.enabled = false, rồi khởi động lại API (xoá bộ đệm cấu hình) và xoá bộ đệm proxy/CDN nếu có.
- Kiểm khoá mã giảm giá trùng lớp khoá Đổi rác (rủi ro đã chấp nhận, spec 10.1). Chạy sau mỗi lần tạo mã có giới hạn mỗi khách:

  ```bash
  psqlq -c "SELECT id, code FROM coupons WHERE \"perUserLimit\" > 0 AND hashtext(id) IN (731001,731002,731003,731004)"
  ```

  Kỳ vọng: 0 dòng. Có dòng: tắt mã đó (isActive = false) và tạo mã mới (id mới).

### 1.9 Lần deploy đầu từ bản thử `cb92dc8` (đã diễn tập trên máy dev 2026-10-24)

Áp dụng khi mục 1.0 cho thấy PROD là bản thử dựng 2026-09-12 và đang ở `cb92dc8`: bảng `_prisma_migrations` có 115 dòng đã xong, dòng cuối trùng tên với `git ls-tree -d --name-only cb92dc8 apps/api/prisma/migrations/ | tail -1`. Ngày 2026-10-24 bản thử vẫn trả `{"status":"ok","db":"up"}` ở `/api/health` khi gọi thẳng `http://14.225.207.177` kèm `Host: api.tubutree.com`, nên bước 2 của mục 5 làm bình thường. Bản thử khác `cb92dc8` thì không dùng các số dưới đây.

Cách diễn tập: Postgres 16 tạm, `prisma migrate deploy` rồi `prisma:seed` bằng mã `cb92dc8` (như lúc dựng bản thử), thêm 2 khách có điểm; sau đó dùng mã main `0b578bce` chạy bước 7, 7b, 7c và 10 theo đúng runbook. Kết quả:

- Bước 7: áp 103 migration, in `All migrations have been successfully applied.`; `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code` in `No difference detected.`. DB gần như rỗng nên 3 giây không phải thời gian thật: vẫn phải làm mục 3.4 trên bản sao backup PROD.
- `points_1d` nhân đúng một lần: số dư 120 thành 120000, giao dịch 150 và -30 thành 150000 và -30000, `loyalty.vnd_per_point_redeem` từ 1000 thành 1.
- Bước 7b in khác DB mới, và như vậy là đúng: `system_configs` thêm 71 (99 có sẵn), `business_configs` đủ sẵn (6), `notification_templates` thêm 3, `community_categories` thêm 5, `game_quizzes` đủ sẵn (43), mốc quỹ "đã có mốc, giữ nguyên". Truy vấn xác minh của bước 7b cho `chu_de` 11, `quiz` 49, `loai_cay` 10, `mau_tin` 123, `moc_quy` 1, `hang`, `bac_dai_ly`, `nhiem_vu` cùng 4; `system_configs` tổng 249 dòng (DB mới là 216). Bốn chủ đề cây cảnh còn bật: ẩn bằng SQL như bước 7b.
- Bước 7c: bản xem trước gắn `KIỂM TAY TRƯỚC KHI APPLY` cho cả 44 sản phẩm. Lý do: `prisma:seed` của bản thử ghi lại sản phẩm demo sau mốc nạp 2026-06-15, nên `updatedAt` của cả 44 đều muộn hơn mốc đó. Nếu mọi `updatedAt` trong danh sách nằm trong cùng một phút (lúc chạy seed) thì đó là do seed, không phải người sửa: đưa danh sách cho chủ shop xác nhận không có hàng thật rồi chạy `--apply`. Sản phẩm nào có `updatedAt` lệch khỏi phút đó là có người sửa qua ứng dụng: xử lý theo điểm dừng của bước 7c. Mục 4 có đúng 3 mã (`WELCOME30`, `FREESHIP`, `XANH10`), không có dòng `[do seed tạo]`. Sau `--apply`: tắt 44 sản phẩm và 48 biến thể, không tắt mã nào; chạy lại thì không đổi dòng nào.
- Bước 10 (env giả): chỉ 2 FAIL, đều đúng dự kiến: `db.admin_user` (chưa cấp quyền admin, làm `grant-admin`) và `backup.cron` (máy dev không có cron). `db.demo_products`, `db.membership_tiers`, `db.dealer_tiers`, `db.bank_account` đều PASS; tài khoản nhận chuyển khoản do migration `20261018200000_launch_owner_config` ghi.
- Quay lại: lần này có migration không đảo được (`points_1d` nhân 1.000 mọi số điểm), nên ở mục 7.0 chỉ còn đường 7.3 (khôi phục bản backup của bước 6). Không dùng 7.2.

Chưa diễn tập được (cần SSH và bản backup PROD): thời gian migrate trên dữ liệu thật, PD-3 và p4 trên `users`, `orders` thật, go-live check `--phase=pre-deploy`, các kiểm `backup.*`, cấu hình Redis thật, cấp quyền admin.

## 2. Trỏ lại GitHub Actions (máy ảo GCP đã đóng)

Việc của người giữ quyền admin repo GitHub (Settings, Secrets and variables, Actions). Không cần làm trước deploy tay, nhưng phải làm trước khi dùng lại `ops.yml`.

| Loại | Tên | Giá trị cần trỏ lại |
|---|---|---|
| Secret | `VM_HOST` | `14.225.207.177` (VPS Vietnix), KHÔNG phải IP GCP cũ |
| Secret | `VM_USER` | Tài khoản SSH trên VPS Vietnix |
| Secret | `VM_SSH_KEY` | Private key MỚI; public key tương ứng nằm trong `~/.ssh/authorized_keys` của tài khoản đó. Không dùng lại key của máy GCP |
| Variable | `DEPLOY_DIR` | `/opt/tubutree` (mặc định đã đúng) |
| Variable | `COMPOSE_FILE` | `docker-compose.vietnix.yml` (mặc định đã đúng) |
| Variable | `VM_WORKFLOWS_ENABLED` | Đặt `true` CHỈ SAU KHI đã trỏ `VM_HOST`, `VM_USER`, `VM_SSH_KEY` sang VPS Vietnix. Chưa đặt (hoặc khác `true`) thì năm workflow VM dừng ở bước chặn đầu tiên |

Các biến báo động vận hành (secret trừ khi ghi khác), dùng bởi `ops.yml` hành động `set-env`:

| Loại | Tên |
|---|---|
| Secret | `OPS_ALERT_WEBHOOK_URL` |
| Secret | `OPS_ALERT_EMAIL_TO` |
| Secret | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| **Variable** (không phải secret) | `OPS_ALERT_ENV_LABEL` |

Và cho backup (hành động `crontab`): variable `BACKUP_RCLONE_REMOTE`, secret `BACKUP_HEALTHCHECK_URL`. Cho cấp admin đầu tiên: secret `ADMIN_PHONE`. Các khoá tích hợp (Pancake, Gomdon, Zalo, ZaloPay, Accesstrade) đã liệt kê ở `ops.yml`.

Lưu ý khi dùng lại `ops.yml`: các hành động `backup`, `gin`, `crontab`, `grant-admin` tự chạy `git pull --ff-only origin main` trên máy chủ trước, nên máy chủ phải pull được từ origin và nhánh `main` phải là nhánh đang chạy. Nếu deploy bằng `git bundle` từ nhánh khác thì đừng dùng các hành động đó, làm tay.

## 3. Chọn giờ deploy

### 3.1 Đếm đơn và ước tính thời gian khoá

```bash
psqlq -tAc 'SELECT count(*) FROM orders'
```

Quy tắc ước tính (khớp với `go-live:check`) cho MỘT migration nặng trên `orders` (đo ở UAT với r6): dưới 50.000 đơn khoảng 2 giây; từ đó trở lên khoảng 14 giây cho mỗi 300.000 đơn (`số đơn × 14 / 300.000`, làm tròn lên). Chính migration viết lại mọi đơn có tên người nhận và dựng chỉ mục tìm kiếm, nên thời gian tỉ lệ với số đơn.

Nhưng r6 chỉ là một trong các migration nặng. Nếu danh sách chờ áp (1.0) có thêm p1, p4, p8 hay các migration orders khác ở bảng 1.0, mỗi cái cũng viết lại hoặc dựng chỉ mục trên `orders` (p4 còn điền cả bảng `users`), và PD-3 khoá `users`. Chưa có số đo riêng cho từng cái; `go-live:check --phase=pre-deploy` (dòng `db.orders_lock`) lấy số trên nhân với số migration nặng trên `orders` còn chờ áp (r6, p1, p4, p8, r11, p2, p3 gomdon, chỉ mục hoá đơn, `lr_reports_source_indexes`, `lr_orders_filter_indexes`, `points_1d`, `q19_reversal_effects_marker`: tối đa 12), coi mỗi cái ngang r6. Dùng số đó làm "ước tính khoá" ở 3.2, hoặc tốt hơn là đo thật ở 3.4.

| Số đơn | Khoá `orders` ước tính (một migration nặng, như r6) |
|---|---|
| dưới 50.000 | khoảng 2 giây |
| 300.000 | khoảng 14 giây |
| 600.000 | khoảng 28 giây |
| 1.000.000 | khoảng 47 giây |

Vì API đã dừng lúc migrate (ràng buộc 2) nên khoá này không chặn khách mà chỉ kéo dài thời gian ngừng phục vụ.

### 3.2 Cửa sổ nên xin

```
cửa sổ (phút) = 10 + thời gian backup đo ở mục 1.2 + 5 × (tổng thời gian migrate, tính ra phút), làm tròn lên bội số của 15, tối thiểu 30
```

"Tổng thời gian migrate" là thời gian của TOÀN BỘ danh sách chờ áp (1.0), không chỉ r6: lấy số đo thật của diễn tập ở 3.4 nếu có; không thì lấy "ước tính khoá" ở 3.1 (đã nhân theo số migration nặng) và xin gấp đôi cửa sổ tính ra, vì phần PD-3, p4 trên `users` và p8 chưa được đo.

10 phút là: dừng API 30 giây, bật lại và chờ khoẻ 3 phút, kiểm tra khói 5 đến 7 phút. Hệ số 5 là biên an toàn vì máy dùng chung với ChoDeli nên chậm hơn lúc đo. Ví dụ 200.000 đơn, backup 2 phút, PROD còn ở bản cũ (cả 12 migration nặng trên `orders` cùng chờ, ước tính 12 × 10 giây = 120 giây, tức 2 phút): 10 + 2 + 5 × 2 = 22, tròn lên 30 phút, rồi gấp đôi vì chưa đo: xin 60 phút. Ví dụ chỉ có các migration của đợt (chỉ r6 nặng), 200.000 đơn (một migration nặng, 10 giây, tức 0,17 phút): 10 + 2 + 5 × 0,17 = 12,8, nên xin 30 phút.

### 3.3 Chọn giờ vắng nhất

Đếm đơn theo giờ trong ngày (giờ Việt Nam) trong 14 ngày qua, chọn giờ có ít đơn nhất:

```bash
psqlq -c "SELECT extract(hour FROM \"createdAt\" AT TIME ZONE 'Asia/Ho_Chi_Minh') AS gio, count(*) FROM orders WHERE \"createdAt\" > now() - interval '14 days' GROUP BY 1 ORDER BY 2, 1"
```

Tránh: giờ có flash sale hoặc chiến dịch, và lúc có đơn thu gom Gomdon đang chạy. Webhook của Gomdon chỉ thử lại 3 lần cách nhau 30 giây (xem [docs/integrations/gomdon.md](../integrations/gomdon.md)); sự kiện nào đến lúc API đang dừng quá lâu sẽ mất. Webhook Pancake và các cron đối soát (đẩy đơn mỗi 15 phút, sự kiện mỗi 10 phút) sẽ bù lại sau khi API chạy lại.

### 3.4 Đo thật bằng diễn tập migrate trên bản sao (bắt buộc khi danh sách chờ áp có migration ngoài sáu cái của đợt)

Các migration ngoài r6 chưa được đo riêng, và PD-3 có thể dừng giữa chừng vì dữ liệu. Cách duy nhất biết chắc là chạy toàn bộ `migrate deploy` lên một bản sao của DB thật, bằng image MỚI. Cần mã mới và image mới đã có trên máy chủ: làm bước 1, bước 2 và bước 3 của mục 5 vào buổi tối trước (chúng không đổi container đang chạy; bước 2 đứng trước bước 3 để image cũ vẫn được ghi và gắn thẻ `rollback`), rồi diễn tập ngoài giờ cao điểm vì máy dùng chung và phải có chỗ đĩa cho một bản DB nữa:

```bash
F=$(ls -t /var/backups/tubutree/tubutree_*.sql.gz | head -1); echo "$F"
$DC exec -T postgres psql -U "$PGUSER" -d postgres -c 'CREATE DATABASE tubutree_drill'
gunzip -c "$F" | $DC exec -T postgres psql -q -v ON_ERROR_STOP=1 --single-transaction -U "$PGUSER" -d tubutree_drill > /dev/null
time POSTGRES_DB=tubutree_drill $DC run --rm --no-deps api pnpm exec prisma migrate deploy
POSTGRES_DB=tubutree_drill $DC run --rm --no-deps -T api pnpm exec prisma migrate status 2>&1 | tail -3
$DC exec -T postgres psql -U "$PGUSER" -d postgres -c 'DROP DATABASE tubutree_drill'
```

`POSTGRES_DB=tubutree_drill` đứng trước `$DC` làm compose nối chuỗi kết nối của API tới DB `tubutree_drill` thay vì DB thật (biến của shell thắng giá trị trong `.env`), nên DB thật không bị chạm. Kỳ vọng: `All migrations have been successfully applied.`, dòng `status` cuối nói "Database schema is up to date", và `time` cho "tổng thời gian migrate" dùng ở 3.2 (dùng số `real`). Nếu migrate báo lỗi trên bản sao (kể cả thông báo dừng của PD-3 "PD-3: ..."), sửa nguyên nhân với Tech lead TRƯỚC ngày deploy: lỗi này sẽ lặp lại đúng như vậy lúc deploy thật. Xoá DB diễn tập xong mới đi tiếp.

- [ ] Diễn tập migrate xong, tổng thời gian migrate: ______ phút (hoặc đã dùng ước tính nhân đôi vì không diễn tập được)

## 4. Bảng điểm dừng (đọc trước khi bắt đầu)

| Nếu thấy | Làm | Gọi |
|---|---|---|
| `check-env` hoặc `go-live:check` báo FAIL (trừ các WARN đã nêu ở bước 4) trước khi dừng API | DỪNG, chưa dừng API. Sửa `.env` rồi chạy lại | Tech lead nếu không tự sửa được |
| Backup lỗi, file `.sql.gz` không qua `gunzip -t`, hoặc nhỏ bất thường so với bản hôm qua | DỪNG. Không migrate khi chưa có bản backup tốt | Tech lead |
| Số migration chờ áp ở bước 4 (`migrate status`) khác số ghi ở mục 1.0, hoặc image/DB không cùng một bản (mục 1.0) | DỪNG, chưa dừng API. Tính lại cửa sổ và đường quay lại từ danh sách mới | Tech lead |
| Migrate báo lỗi (bất kỳ dòng `Error`) hoặc chạy quá 5 lần "tổng thời gian migrate" (mục 3.2) | DỪNG. Làm mục 7.1. Không bật API | Tech lead, Chủ shop |
| `_prisma_migrations` có dòng `finished_at IS NULL` | DỪNG. Làm mục 7.1 (đọc kỹ điểm 2, 4 và 6 của 7.1: không bật lại API cũ trước khi xử lý dòng dở) | Tech lead |
| `prisma:seed:reference` (bước 7b) báo lỗi hoặc số đếm xác minh sai | Chưa bật API. Lệnh chạy lại an toàn: đọc lỗi, chạy lại một lần; vẫn lỗi thì DỪNG | Tech lead |
| API mới không `healthy` sau 5 phút | Xem log, quyết định trong 15 phút: quay lại theo mục 7 | Chủ shop quyết, Tech lead |
| Smoke test (bước 11) có mục FAIL | Quay lại theo mục 7, hoặc sửa tiến nếu chỉ là lỗi giao diện và schema ổn | Chủ shop, Tech lead |
| `go-live:check` sau deploy có FAIL | Không mở bán, không phát hành Mini App. Sửa rồi chạy lại | Tech lead |
| Email báo "Cần xử lý" ồ ạt hoặc màn Sức khoẻ hệ thống đỏ trong 1 giờ đầu | Làm theo hướng dẫn từng dòng; nếu không giải thích được trong 15 phút, quay lại | Tech lead, Chủ shop |

## 5. Trình tự deploy (ngày D)

Ghi giờ bắt đầu từng bước vào cột bên phải của bản in hoặc nhóm chat.

### Bước 1. Lấy mã mới về máy chủ

```bash
git fetch origin            # nếu máy chủ pull được từ origin
git status --short          # phải trống
git merge --ff-only <SHA đã chốt>
git log -1 --format='%h %s'
```

Nếu máy chủ không pull được từ origin, dùng `git bundle`: trên máy dev `git bundle create /tmp/tubutree.bundle <nhánh>`, chép lên máy chủ bằng `scp`, rồi trên máy chủ `git fetch /tmp/tubutree.bundle <nhánh>` và `git merge --ff-only FETCH_HEAD`.

Kỳ vọng: `git log -1` in đúng mã SHA đã chốt. Nếu `git status` không trống hoặc `--ff-only` từ chối: DỪNG, gọi Tech lead. Các file `.rollback-images`, `.rollback-dump`, `.last-deployed-sha`, `.pending-migrations` mà chính tài liệu này ghi ở gốc repo đã được `.gitignore` nên không làm `git status` bẩn (thấy file lạ khác thì DỪNG); và đừng `chmod` script trên máy chủ (mục 1.2). Làm xong bước này máy chủ đã có compose mới trên đĩa; các container đang chạy vẫn là bản cũ cho tới khi bị tạo lại.

### Bước 2. Ghi lại image đang chạy và giữ một bản để quay lại

Làm TRƯỚC khi build, vì build sẽ đổi tên image sang bản mới.

```bash
API_ID=$(docker inspect -f '{{.Image}}' "$($DC ps -q api)"); API_NAME=$(docker inspect -f '{{.Config.Image}}' "$($DC ps -q api)")
WEB_ID=$(docker inspect -f '{{.Image}}' "$($DC ps -q web)"); WEB_NAME=$(docker inspect -f '{{.Config.Image}}' "$($DC ps -q web)")
printf 'API_ID=%s\nAPI_NAME=%s\nWEB_ID=%s\nWEB_NAME=%s\n' "$API_ID" "$API_NAME" "$WEB_ID" "$WEB_NAME" | tee .rollback-images
docker tag "$API_ID" "${API_NAME%%:*}:rollback"
docker tag "$WEB_ID" "${WEB_NAME%%:*}:rollback"
docker images | grep -E 'rollback'
```

Kỳ vọng: bốn dòng `API_ID=sha256:...`, và hai dòng image có thẻ `rollback`. Thẻ này giữ cho `docker image prune` không xoá mất image cũ. Nếu `$DC ps -q api` trống (API không chạy) thì DỪNG: không có gì để quay lại, báo Tech lead.

### Bước 3. Build image mới (container cũ vẫn phục vụ khách)

```bash
$DC build api web
```

Mất vài phút và ăn RAM máy chủ dùng chung; nên chạy ngoài cửa sổ deploy, vào buổi tối hôm trước, rồi chỉ chạy lại ở ngày D (nhanh nhờ cache). Container đang chạy không bị đổi cho tới bước 5.

### Bước 4. Kiểm cấu hình và go-live check bằng image MỚI (API cũ vẫn chạy)

```bash
$DC run --rm --no-deps api node dist/config/check-env.js
$DC run --rm --no-deps -v /var/backups/tubutree:/var/backups/tubutree:ro api pnpm run go-live:check -- --phase=pre-deploy
```

(`npm run go-live:check -- --phase=pre-deploy` cũng chạy được; lệnh `go-live:check` nằm trong `apps/api/package.json`.)

Rồi lấy danh sách migration chờ áp từ chính image MỚI (lệnh duy nhất in đủ mọi tên; `go-live:check` chỉ in 4 tên đầu):

```bash
$DC run --rm --no-deps -T api pnpm exec prisma migrate status 2>&1 | tr -d '\r' | grep -E '^[0-9]{14}_' | tee .pending-migrations | wc -l
```

Kỳ vọng:
- `check-env` in `Cấu hình môi trường hợp lệ.` và thoát 0.
- `go-live:check` thoát 0 (không FAIL). Các dòng WARN được phép ở bước này, đều là việc deploy sẽ làm: `db.shipping_eta`, `db.company_identity`, `db.migrations_pending`, `db.pending_scope` (nếu danh sách có migration ngoài sáu cái của đợt) và `db.required_migrations` ("sẽ được áp khi deploy"); `db.orders_lock` (nếu từ 50.000 đơn); `redis.policy` ("đang là allkeys-lru") nếu chưa đổi nóng ở mục 1.1, vì compose cũ còn đặt `allkeys-lru` tới bước 5 bên dưới; `db.demo_products`, `db.demo_coupons` ("sẽ dọn ở runbook mục 5, bước 7c"); `db.membership_tiers` và `db.dealer_tiers` khi DB còn mới (hạng và bậc đại lý nạp ở bước 7b); và các dòng backup `không kiểm được` (xem ghi chú). `db.waste_point` là PASS khi `waste.enabled` chưa có (trước deploy; bảng `waste_points` do migration `20261020000000_waste_exchange` tạo) và không nằm trong các WARN được phép. Mọi WARN khác phải đọc và chốt "chấp nhận" hoặc sửa trước.
- Số dòng in ra của lệnh `migrate status` ở trên PHẢI bằng số "migration chờ áp" ghi ở mục 1.0, và bằng số trong dòng `db.migrations_pending` (`N cái sẽ được áp khi deploy`). Khác nhau: DỪNG (bảng điểm dừng, mục 4). `.pending-migrations` giờ là danh sách chính thức mà bước 7 sẽ áp; nó có sáu migration của đợt, và có thể còn nhiều cái khác. Ghi lại số lượng: ______.
- Dòng `db.pending_scope` (chỉ có khi có migration ngoài sáu cái của đợt) nêu tên các migration nặng: đối chiếu với bảng ở mục 1.0 và với cửa sổ đã xin.
- Dòng `db.orders_lock` cho số đơn và ước tính (đã nhân theo số migration nặng trên `orders`). Đối chiếu với mục 3.

Ghi chú về các dòng backup: lệnh này chạy BÊN TRONG container nên không nhìn thấy crontab và rclone của máy chủ (kết quả là WARN "không kiểm được", không phải FAIL). Gắn thêm `-v ...:ro` như trên cho dòng `backup.recent` (tuổi bản backup gần nhất) kiểm được. Hai việc còn lại kiểm tay trên máy chủ:

```bash
crontab -l | grep backup-db | sed -E 's#HEALTHCHECK_URL=[^ ]+#HEALTHCHECK_URL=***#'
rclone listremotes
```

Phải thấy dòng cron có `RCLONE_REMOTE=` khác rỗng và tên remote có trong `rclone listremotes`.

Nếu `go-live:check` báo `env.throttle_bypass` WARN (chưa đặt) hoặc FAIL (ngắn hơn 32 ký tự): đặt `THROTTLE_BYPASS_TOKEN` đủ dài, cùng giá trị cho api và web (xem mục 1.3).

### Bước 5. Bắt đầu cửa sổ: dừng API cũ

Báo vào nhóm: "Bắt đầu bảo trì lúc HH:MM". Rồi:

```bash
date '+%H:%M:%S'
$DC stop api
$DC ps
```

Kỳ vọng: `api` ở trạng thái `exited` (dừng êm trong tối đa 30 giây nhờ `stop_grace_period`). `web` vẫn chạy nhưng sẽ báo lỗi vì không gọi được API: đó là trạng thái bảo trì bình thường. Từ giờ phút này khách không đặt hàng được.

Ngay sau đó, khi API đã dừng (không ai nối vào Redis), tạo lại Redis bằng compose MỚI để `noeviction` thành vĩnh viễn (mục 1.1). Dữ liệu nằm trong volume và `appendonly yes` nên job đang chờ vẫn còn:

```bash
$DC up -d --no-deps redis
sleep 10
$DC ps redis
$DC exec -T redis redis-cli config get maxmemory-policy
$DC exec -T redis redis-cli config get appendonly
```

Kỳ vọng: `redis` ở trạng thái `healthy` (hoặc `Up`, vài giây sau là `healthy`), rồi `noeviction` và `yes`. Điểm dừng: không healthy sau 1 phút, hoặc policy vẫn là `allkeys-lru` (compose chưa phải bản mới: kiểm lại bước 1); xem `$DC logs --tail 50 redis`, gọi Tech lead. Nếu 7.1 bên dưới được dùng để bật lại API cũ thì nó nối vào Redis `noeviction` này: đó là điều BullMQ cần, không phải lỗi.

### Bước 6. Sao lưu lần cuối và đếm số dòng (điểm quay lại)

Làm SAU khi API đã dừng, để bản này chứa mọi dữ liệu và không còn ai ghi vào DB:

```bash
COMPOSE_FILE=docker-compose.vietnix.yml POSTGRES_USER=$PGUSER POSTGRES_DB=$PGDB RCLONE_REMOTE=tubucrypt: bash tools/backup/backup-db.sh
ROLLBACK_DUMP=$(ls -t /var/backups/tubutree/tubutree_*.sql.gz | head -1)
echo "$ROLLBACK_DUMP" | tee .rollback-dump
ls -lh "$ROLLBACK_DUMP" && gunzip -t "$ROLLBACK_DUMP" && echo "gunzip OK"
psqlq -tAc "SELECT (SELECT count(*) FROM orders), (SELECT count(*) FROM users), (SELECT count(*) FROM reviews), (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)"
```

Kỳ vọng: backup in `OK`, `gunzip OK`, dung lượng cùng cỡ bản hôm qua. Ghi bộ 4 số đếm: orders ______ users ______ reviews ______ migrations đã áp xong ______ (chỉ đếm dòng `finished_at IS NOT NULL AND rolled_back_at IS NULL`, cùng cách đếm với mục 1.0 phần A, 7.1 điểm 2 và mục 7.3). Điểm dừng: lỗi hoặc file quá nhỏ.

### Bước 7. Migrate bằng image MỚI

```bash
date '+%H:%M:%S'
time $DC run --rm --no-deps api pnpm exec prisma migrate deploy
date '+%H:%M:%S'
```

Kỳ vọng: liệt kê các migration "Applying migration `...`" gồm MỌI tên trong `.pending-migrations` (kể cả sáu migration của đợt), kết thúc bằng `All migrations have been successfully applied.` Thời gian khớp "tổng thời gian migrate" ở mục 3.2 (cho phép gấp vài lần vì máy dùng chung). Điểm dừng: bất kỳ lỗi nào (mục 7.1).

Xác minh sau migrate:

```bash
psqlq -tAc "SELECT count(*) AS da_ap_xong FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"
psqlq -c "SELECT migration_name, finished_at IS NOT NULL AS xong FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 6"
psqlq -c "SELECT count(*) AS dang_do FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL"
psqlq -c "SELECT count(*) AS huy_tra_thieu_moc FROM orders WHERE status IN ('CANCELLED', 'RETURNED') AND \"reversalEffectsAt\" IS NULL"
psqlq -c "SELECT indexname FROM pg_indexes WHERE tablename='reviews' AND indexname LIKE 'reviews_userId_productId%'"
psqlq -c "SELECT count(*) FILTER (WHERE \"kind\" = 'WAREHOUSE') AS kho, count(*) AS diem_doi_rac FROM waste_points"
psqlq -c "SELECT count(*) AS thieu_tim_kiem FROM orders WHERE COALESCE(\"shippingAddress\" ->> 'recipient','') <> '' AND \"recipientSearch\" = ''"
```

Kỳ vọng: `da_ap_xong` bằng (số "migrations" ghi ở bước 6) cộng (số chờ áp ở bước 4); sáu migration mới nhất (bản 2026-10-20: `20261020120000_q19_reversal_effects_marker`, `20261020120000_groupbuy_success_template_percent`, `20261020110000_coupons_admin_list_index`, `20261020100000_review_return_reversal`, `20261020100000_best_answer_reward_note_template`, `20261020010000_waste_item_warehouse_only`; thêm migration mới thì danh sách này đổi theo) đều `xong = t`; `dang_do = 0`; `huy_tra_thieu_moc = 0` (migration điền sẵn mốc cho mọi đơn đã huỷ/trả; con số tăng sau khi API mới chạy là đơn đang huỷ/trả dở, cron sẽ xử lý trong vài phút); chỉ còn đúng một chỉ mục `reviews_userId_productId_orderId_key` (chỉ mục cũ `reviews_userId_productId_key` đã mất); lần deploy đầu: `kho = 0`, `diem_doi_rac = 0` (admin tự nhập kho trước khi bật waste.enabled); `thieu_tim_kiem = 0`.

### Bước 7b. Nạp dữ liệu tham chiếu (lần deploy đầu, hoặc DB mới)

`prisma migrate deploy` chỉ tạo bảng và một phần cấu hình, mẫu thông báo. Các thứ app cần để chạy đủ tính năng nằm ở file seed và KHÔNG có trong migration: bảy chủ đề cộng đồng, 43 câu quiz Vườn Xanh, mười loài cây, mốc quỹ trồng cây, 28 mẫu thông báo (gồm "đơn đã giao", "đơn bị huỷ", "mã giảm giá chào mừng"), 122 khoá cấu hình để admin thấy ở tab Cấu hình, cùng (với cờ ở dưới) hạng thành viên, bậc đại lý, nhiệm vụ và 6 khoá có giá trị kinh doanh. Lệnh `prisma:seed` bị chặn ở production (nó ghi đè sản phẩm và tài khoản ngân hàng), nên có một lệnh riêng, an toàn cho prod:

```bash
$DC run --rm --no-deps api pnpm run prisma:seed:reference --with-business-defaults
```

Cờ `--with-business-defaults` là bắt buộc ở lần deploy đầu (chủ dự án đã chốt chạy có cờ, quyết định A8 trong `docs/2026-10-18-launch-review/03-cau-hoi-sang.md`). Thiếu cờ thì DB mới không có hạng thành viên (mọi khách bị hệ số điểm x1 thay vì x1,2, x1,5, x2, và không có freeship theo hạng), không có bậc đại lý (admin không duyệt được hồ sơ đại lý hay cấp vai trò DEALER), vòng quay báo "chưa cấu hình" và Vườn Xanh không có nhiệm vụ. `go-live:check` báo FAIL `db.membership_tiers` nếu quên.

Chạy ngay sau bước 7, khi API vẫn đang dừng, trước bước 8. Lệnh chỉ TẠO dòng còn thiếu: không ghi đè giá trị admin đã chỉnh, không đụng sản phẩm, người dùng, mã giảm giá hay tài khoản ngân hàng, nên chạy lại bao nhiêu lần cũng an toàn (nên chạy lại sau mỗi lần phát hành có thêm mẫu thông báo hoặc khoá cấu hình mới). KHÔNG chạy `prisma:seed` và KHÔNG đặt `ALLOW_PROD_SEED=1` trên VPS.

Bốn khoá `legal.dieu-khoan`, `legal.bao-mat`, `legal.doi-tra`, `legal.van-chuyen` cũng được nạp (giá trị rỗng) để tab Cấu hình có chỗ dán nội dung điều khoản. Chủ dự án dán nội dung pháp lý đã duyệt vào bốn khoá này trước ngày ra mắt; đến lúc đó các trang `/chinh-sach/...` trên web hiện bản nháp có biển "BẢN NHÁP — chờ Tubu Tree duyệt" và chưa được lập chỉ mục.

Kỳ vọng: thoát 0 và in mỗi nhóm một dòng `[seed-reference] <nhóm>: ...`. Lần đầu trên DB mới (đo thật 2026-10-22 trên DB trống sau `migrate deploy`, nhánh UAT `uat/q8-bac-admin`, đã gồm khoá `dealer.quarterly_bonus_tiers`) các dòng là `system_configs: +131 mới`, `business_configs: +6 mới`, `membership_tiers: +4 mới`, `dealer_tiers: +4 mới`, `missions: +4 mới`, `notification_templates: +28 mới`, `community_categories: +7 mới`, `game_quizzes: +43 mới`, `plant_species: +10 mới`, `community_goals: +1 mới`; lần chạy sau đều `đủ sẵn`. Dòng `seasons` luôn là "bỏ qua: mùa mẫu đã hết hạn" cho tới khi chủ dự án chốt mùa mới (Vườn Xanh không hiện banner mùa trong lúc đó). Chạy KHÔNG cờ thì lệnh in dòng cuối `chưa nạp: ... (thiếu --with-business-defaults; A8 yêu cầu chạy có cờ ở lần deploy đầu)` và bỏ qua hạng thành viên, bậc đại lý, nhiệm vụ và 6 khoá cấu hình (vòng quay, thưởng mốc giới thiệu, bậc Subscribe & Save, freeship theo hạng, thưởng chuỗi 7 ngày, Season Pass): dòng đó là dấu hiệu đã chạy thiếu cờ ở lần deploy đầu, không phải trạng thái đúng ý.

Thứ tự bắt buộc khi danh sách chờ áp có `points_1d`: build image, kiểm .env, dừng API, backup (sau khi dừng, không thì khôi phục sẽ mất mọi ghi trong lúc build), `prisma migrate deploy`, `prisma:seed:reference`, bật API. `deploy.sh` làm đúng thứ tự này (từ build trở đi) khi thấy API đang chạy mà `points_1d` chưa áp, nên khi mục 0.1 cho phép dùng `deploy.sh` thì chỉ cần chạy nó, không phải dừng API hay backup tay; nó tự truyền `--with-business-defaults` cho seed (đặt `SEED_REFERENCE_ARGS=` rỗng khi chạy `deploy.sh` nếu DB đã có sẵn hạng, bậc đại lý, nhiệm vụ và muốn bỏ cờ). Nếu `20261015150000` còn chờ áp mà API cũ còn chạy, `deploy.sh` tự dừng với mã 2: làm tay theo mục 5, thứ tự ở đó đã đúng như trên (vẫn nên có bản backup đầu cửa sổ); `deploy.sh` backup ngay trước migrate khi BẤT KỲ migration nào còn chờ (hỏi `prisma migrate status` bằng image mới; không nối được DB thì dừng mã 2, chưa backup, chưa migrate). Với migration không phải `points_1d`, API cũ vẫn phục vụ trong lúc backup, nên mọi ghi sau bản backup sẽ MẤT nếu phải khôi phục theo 7.3. Khi `points_1d` còn chờ, `deploy.sh` backup sau khi dừng API, kể cả khi API đã tắt sẵn hoặc chạy lại sau lần lỗi (backup lỗi thì không migrate, và chỉ bật lại API nếu chính script đã dừng nó). `prisma:seed:reference` chạy mỗi lần API đang tắt hoặc `points_1d` còn chờ, nên chạy lại sau khi seed lỗi vẫn nạp đủ. Build lỗi thì API cũ vẫn chạy; dừng API, backup, migrate hoặc seed lỗi thì thoát mã 2; backup lỗi thì API được bật lại, migrate hoặc seed lỗi thì API vẫn tắt. `prisma:seed:reference` từ chối chạy nếu `points_1d` chưa xong (nạp khoá cấu hình giá trị cũ trước migrate sẽ bị nhân 1.000 lần nữa).

Bước 6/6 của `deploy.sh`: build và thay `zalo-bridge`, CHỈ khi container đang chạy lúc bắt đầu deploy (bridge chưa từng bật hoặc đã dừng chủ ý thì bị bỏ qua, ghi một dòng log; bật lần đầu bằng tay: `docker compose -f docker-compose.vietnix.yml up -d --build zalo-bridge`). Mã thoát: 3 = api hoặc web không healthy; 4 = bridge lỗi (api và web đã chạy bản mới, chỉ chat Zalo cá nhân ngưng).

Cờ chỉ tạo dòng còn thiếu (hạng, bậc đại lý, nhiệm vụ, 6 khoá) và an toàn chạy lại; bảng giá trị nằm ở mục 3.2 của `docs/2026-10-18-launch-review/impl/refseed.md` (chủ dự án đã duyệt, A8). Cờ gõ sai thì lệnh báo "Tham số không hợp lệ" và không ghi gì. Đã lỡ chạy không cờ ở lần deploy đầu thì chạy lại lệnh có cờ ngay (không cần dừng API): hạng được nạp, và job đêm tính lại hạng sẽ gán hạng cho khách đã có đơn giao trước đó (xem `recalcAllTiers`); hạng được gán ở lần chạy 03:15 của job đêm hoặc ở đơn giao kế tiếp của khách, trong lúc đó khách vẫn nhận điểm ×1; không có lệnh tính lại ngay.

Xác minh sau lệnh:

```bash
psqlq -c "SELECT (SELECT count(*) FROM community_categories WHERE \"isActive\") AS chu_de, (SELECT count(*) FROM game_quizzes) AS quiz, (SELECT count(*) FROM plant_species) AS loai_cay, (SELECT count(*) FROM notification_templates) AS mau_tin, (SELECT count(*) FROM community_goals WHERE status = 'ACTIVE') AS moc_quy, (SELECT count(*) FROM membership_tiers) AS hang, (SELECT count(*) FROM dealer_tiers) AS bac_dai_ly, (SELECT count(*) FROM missions) AS nhiem_vu"
```

Kỳ vọng: `chu_de ≥ 7`, `quiz ≥ 43`, `loai_cay ≥ 10`, `mau_tin ≥ 123`, `moc_quy = 1`, `hang ≥ 4`, `bac_dai_ly ≥ 4`, `nhiem_vu ≥ 4`. Lệnh này chỉ tạo dòng thiếu nên số thấp hơn mức trên mới là lỗi: chạy lại lệnh một lần, vẫn thấp thì DỪNG. Số CAO HƠN không phải lỗi: trên DB bản thử cũ (đã từng chạy `prisma:seed`) `quiz` có thể là 49 (kèm 6 quiz thương hiệu cũ) và `mau_tin` hơn 123. DB mới hoàn toàn (đo thật 2026-10-20 sau `migrate deploy` rồi lệnh có cờ) cho đúng `quiz = 43`, `mau_tin = 123` (28 mẫu seed cộng 95 mẫu do migration tạo, đo lại 2026-10-22; migration `20261020120000_dealer_bonus_topup_template` thêm một mẫu), `hang = 4`, `bac_dai_ly = 4`, `nhiem_vu = 4`, và `system_configs` tổng 216 dòng (đo lại 2026-10-22 ở nhánh `uat/q8-bac-admin`, sau lệnh có cờ chạy hai lần). Nếu `hang = 0`, `bac_dai_ly = 0` hoặc `nhiem_vu = 0` là đã chạy thiếu cờ: chạy lại có cờ. Trên DB bản thử cũ ba cột này đã là 4 từ trước do seed cũ nạp sẵn.

Trên DB bản thử cũ, kiểm thêm chủ đề cộng đồng cây cảnh của bản đầu còn bật (lệnh này chỉ tạo dòng thiếu nên không ẩn chúng; trên DB mới không có dòng nào):

```bash
psqlq -c "SELECT slug, name FROM community_categories WHERE \"isActive\" AND slug IN ('cham-soc','sau-benh','phoi-canh','khoe-vuon')"
```

Có dòng nào thì ẩn bằng SQL (chưa có màn admin; chỉ ẩn khỏi danh sách chọn và lọc, không xoá nên bài đã đăng giữ nguyên nhãn cũ):

```bash
psqlq -c "UPDATE community_categories SET \"isActive\" = false WHERE slug IN ('cham-soc','sau-benh','phoi-canh','khoe-vuon')"
```

Chỉnh khoá cấu hình và nhiệm vụ ở Quản trị, Cấu hình; hạng và bậc đại lý chưa có màn sửa (sửa bằng SQL, lần chạy sau không ghi đè).

### Bước 7c. Dọn dữ liệu demo (API vẫn đang dừng)

Migration `20260616000000_demo_catalog_multibrand` nạp vào MỌI DB mới 44 sản phẩm và 48 biến thể demo (giá giả, khách đặt được, đơn đẩy sang Pancake sẽ lỗi) cùng 3 mã giảm giá công khai còn hạn tới 31/12/2026, mà chủ dự án đã chốt GIỮ CẢ BA cho đợt ra mắt (A4, 2026-10-18; xem điểm 2 bên dưới): `WELCOME30` (giảm 30.000đ cho đơn từ 199.000đ, 1 lượt mỗi khách, không giới hạn tổng), `FREESHIP` (đơn từ 99.000đ, 3 lượt mỗi khách), `XANH10` (giảm 10%, tối đa 50.000đ, đơn từ 250.000đ, 2 lượt mỗi khách). Bản thử trên VPS đã áp migration này từ tháng 6, nên dữ liệu đó có thể đang nằm trên PROD; DB dựng mới chắc chắn có. Làm bước này ở mọi lần deploy cho tới khi `db.demo_products` và `db.demo_coupons` đều PASS. Chạy lại an toàn: không còn gì để đổi thì không đổi gì.

DB từng chạy `prisma db seed` (bản thử, máy dev) có thể có thêm 3 mã cùng tên do seed tạo (diễn tập từ bản thử `cb92dc8` không thấy, xem 1.9): id khác, hạn tới 01/01/2027, cùng điều kiện như trên. Lệnh dọn và go-live check coi chúng là mã demo (nhận theo mã và điều kiện), xem trước ghi `[do seed tạo]`. DB như vậy còn dữ liệu demo khác mà lệnh này KHÔNG dọn: nhiệm vụ (`missions`), câu đố (`game_quizzes`), merchant hoàn tiền (`cashback_merchants`), mục tiêu cộng đồng, mùa giải, loài cây, cấp đại lý, mẫu thông báo do `prisma/seed.ts` tạo. Thấy `[do seed tạo]` ở mục 4 thì báo tech lead rà các bảng đó ở Quản trị trước khi mở bán.

1. Xem trước (không ghi gì):

   ```bash
   $DC run --rm --no-deps -T api pnpm run prisma:cleanup-demo 2>&1 | tee .demo-cleanup-preview.txt
   ```

   Lệnh đi qua `tee` nên mã thoát là của `tee`: đọc chữ in ra, không dựa vào mã thoát. Kỳ vọng: dòng bắt đầu bằng `DB:` là `DB: postgres:5432/<tên DB PROD>` (pnpm in vài dòng tiêu đề trước dòng đó); mục 1 và 2 nêu số sản phẩm, biến thể sẽ tắt (DB mới: 44 và 48); mục 3 nêu những dòng đang trỏ tới hàng demo (đơn, giỏ, đánh giá, gian hàng, giờ vàng): chúng giữ nguyên, chỉ để biết; mục 4 nêu 3 mã và trạng thái; mục 5 nêu danh mục nào sẽ trống. Dán kết quả vào nhóm chat.
   - In câu "DB này không có dữ liệu demo" (thay cho kế hoạch) nghĩa là không còn sản phẩm, biến thể hay mã demo nào (kể cả mã do seed tạo): sang bước 8.
   - DB chỉ còn mã do seed tạo (mục 1 và 2 báo `tìm thấy 0/44`, `0/48`, mục 4 có `[do seed tạo]`): lệnh vẫn in kế hoạch, làm tiếp điểm 2 và 3 để quyết các mã đó.
   - Mục 4 có dòng `[ĐIỀU KIỆN ĐÃ SỬA so với bản demo …]`: đúng là dòng migration tạo nhưng ai đó đã sửa điều kiện (vd WELCOME30 lên 50.000đ để dùng thật). Lệnh vẫn coi là mã demo và `--coupons=expire` vẫn tắt. Hỏi chủ shop: là mã thật thì thêm `--keep-coupon=<mã>` ở điểm 3 và `GO_LIVE_ACCEPT_DEMO_COUPONS=<mã>` ở bước 10.
   - Mục 4 có dòng `KHÔNG ĐỤNG: trùng tên mã demo nhưng điều kiện khác`: mã đó không phải bản demo (chủ shop tạo hoặc đã sửa điều kiện), lệnh dọn không tắt nó dù có `--coupons=expire`. Chủ shop mở Quản trị, Mã giảm giá, xem điều kiện: giữ thì go-live bước 10 ra WARN nêu đúng tên mã đó; không giữ thì tắt tay ở Quản trị.
   Điểm dừng: dòng `DB:` không phải DB PROD; hoặc mục 3 có `dòng đơn hàng` lớn hơn 0 mà chưa ai biết đó là đơn gì (khách thật đặt hàng demo: báo chủ shop trước khi tắt); hoặc mục 1 có `KIỂM TAY TRƯỚC KHI APPLY` (sản phẩm demo có người sửa sau khi nạp). Với dòng cuối: đưa danh sách tên cho chủ shop. Không ai dùng các sản phẩm đó làm hàng thật thì làm tiếp; có thì chưa chạy `--apply`, báo tech lead (lệnh dọn không bỏ qua từng sản phẩm).

2. Về 3 mã: chủ dự án đã chốt (A4, 2026-10-18) GIỮ CẢ BA (`WELCOME30`, `FREESHIP`, `XANH10`) cho đợt ra mắt, nên làm đúng lệnh (c) ở điểm 3, KHÔNG thêm `--coupons=expire` (mặc định `--coupons=keep` đã giữ cả ba; `--keep-coupon` chỉ dùng kèm `--coupons=expire`, và `--coupons=expire --keep-coupon=WELCOME30,FREESHIP,XANH10` cũng cho kết quả giống hệt). Hai phương án (a) tắt cả ba và (b) giữ một phần chỉ dùng nếu chủ dự án đổi ý sau này. Lưu ý đã được chủ dự án chấp nhận: hệ thống tự tặng mỗi khách mới một mã chào mừng riêng 30.000đ cho đơn từ 199.000đ (cấu hình `voucher.welcome_amount`, `voucher.welcome_min_order`); giữ thêm `WELCOME30` thì khách mới được giảm chào mừng hai lần, mỗi mã một đơn. Mã demo nào ngoài ba mã này (nếu bản xem trước báo) vẫn phải được quyết như cũ.

3. Thực hiện (một transaction: lỗi thì không đổi gì). Trước khi chạy: `ls .demo-cleanup-apply.txt` phải báo không có file. Có file (của lần deploy trước) thì đổi tên nó (`mv .demo-cleanup-apply.txt .demo-cleanup-apply.$(date +%Y%m%d%H%M).txt`), KHÔNG để `tee` ghi đè: file đó chứa khối hoàn tác. Chọn đúng một dòng theo quyết định ở điểm 2 (đã chốt: dòng (c)). `--expect-db` bắt buộc: lệnh so với tên DB mà API đang nối, khác nhau thì in `--expect-db=… khác DB đang nối (…)`, không làm gì; khi đó dừng, kiểm lại `.env`.

   ```bash
   $DC run --rm --no-deps -T api pnpm run prisma:cleanup-demo -- --apply --expect-db="$PGDB" --coupons=expire 2>&1 | tee .demo-cleanup-apply.txt                          # (a)
   $DC run --rm --no-deps -T api pnpm run prisma:cleanup-demo -- --apply --expect-db="$PGDB" --coupons=expire --keep-coupon=WELCOME30 2>&1 | tee .demo-cleanup-apply.txt  # (b) giữ WELCOME30
   $DC run --rm --no-deps -T api pnpm run prisma:cleanup-demo -- --apply --expect-db="$PGDB" 2>&1 | tee .demo-cleanup-apply.txt                                           # (c) ĐÃ CHỐT: giữ cả ba mã
   ```

   Kỳ vọng: in lại kế hoạch, rồi `Đã tắt 44 sản phẩm, 48 biến thể; đổi 48 SKU sang DEMO-<sku>; đã tắt N mã giảm giá.` (N = 3 với (a), 2 với (b), 0 với (c)). Sản phẩm, biến thể chỉ bị tắt, không bị xoá; đơn, đánh giá cũ vẫn mở được. SKU demo đổi thành `DEMO-<sku>` (vd `DEMO-FUWA-DW-1L`) để hàng thật trên Pancake cùng SKU đồng bộ được (SKU là duy nhất trong DB). Cuối kết quả có khối `-- HOÀN TÁC` (các câu SQL đưa đúng những dòng vừa đổi về như cũ, gồm hạn cũ của từng mã); file `.demo-cleanup-apply.txt` giữ khối đó, không xoá, không ghi đè file này. Kiểm chạy lại: dùng đúng lệnh vừa chạy nhưng `tee` sang file KHÁC, vd thay `tee .demo-cleanup-apply.txt` bằng `tee .demo-cleanup-rerun.txt`. Kết quả phải in `Đã tắt 0 sản phẩm, 0 biến thể` và `-- HOÀN TÁC: lần chạy này không đổi dòng nào.` Lỡ tee lần chạy lại vào `.demo-cleanup-apply.txt` thì khối hoàn tác thật đã mất: báo tech lead ngay (hoàn tác khi đó phải dựng tay từ bản xem trước `.demo-cleanup-preview.txt`).

   Nhìn nhanh (go-live check ở bước 10 mới là phép đối chiếu đúng danh sách):

   ```bash
   psqlq -c "SELECT count(*) FILTER (WHERE \"isActive\") AS demo_dang_ban, count(*) AS demo_tong FROM products WHERE \"pancakeId\" LIKE 'seed-%'"
   psqlq -c "SELECT code, \"isActive\", \"endAt\" FROM coupons WHERE code IN ('WELCOME30','FREESHIP','XANH10') ORDER BY code"
   ```

   Kỳ vọng: `demo_dang_ban = 0`; ba mã đúng như quyết định ở điểm 2.

   Sau bước này khách không còn thấy hay mua được hàng demo ở: catalog, tìm kiếm, trang sản phẩm, danh mục, trang nhãn, gian hàng, sitemap, yêu thích, giờ vàng (đang chạy và sắp tới, nút "Nhắc tôi"), mua chung (danh sách và nút tham gia), giỏ và thanh toán, các tin nhắc (giờ vàng bắt đầu, giảm giá cho người yêu thích, nhắc mua lại, mời đánh giá, giỏ bỏ quên), chip sản phẩm trên bài cộng đồng cũ. Đã biết, chưa sửa (không ai mua được hàng demo qua các chỗ này):
   - Ví mã của khách vẫn liệt kê mã mua chung đã cấp cho sản phẩm demo (nếu bản thử từng có nhóm thành công); mã không dùng được vì sản phẩm không vào giỏ được.
   - Lịch sử đơn vẫn hiện dòng hàng demo của đơn cũ, ghi "ngừng bán"; gói định kỳ trên hàng demo báo ngừng bán ở kỳ sau (mục 3 của bản xem trước nêu số gói, CSKH xử lý tay).
   - API `GET /products/<slug>/reviews` vẫn trả đánh giá cũ của sản phẩm demo; trang sản phẩm đã 404 nên khách không tới đó.
   - Trần số nhóm mua chung mở mỗi khách (`groupbuy.max_open_per_user`) chỉ đếm nhóm trên hàng đang bán. Nếu sau này bật lại một sản phẩm đã tắt, các nhóm cũ còn hạn của nó hiện lại, và một khách có thể tạm vượt trần cho tới khi các nhóm đó hết hạn (tối đa `groupbuy.window_hours`).
   - Trang nhãn, yêu thích, bài cộng đồng (gắn sản phẩm khi đăng) và lời nhắc CTV chỉ lọc `isActive`, chưa lọc trạng thái duyệt: không ảnh hưởng hàng demo (đã tắt), là việc riêng cho hàng đối tác chờ duyệt.

   Lỡ tay (vd tắt nhầm mã chủ shop muốn giữ): một mã thì bật lại và sửa hạn ở Quản trị, Mã giảm giá, lấy hạn cũ trong khối `-- HOÀN TÁC` của `.demo-cleanup-apply.txt`. Cần đưa cả sản phẩm, biến thể về (Quản trị không có nút bật lại hàng kho Tubu): chỉ tech lead làm, chạy nguyên khối từ `BEGIN;` tới `COMMIT;` trong file đó:

   ```bash
   sed -n '/^BEGIN;$/,/^COMMIT;$/p' .demo-cleanup-apply.txt > .demo-cleanup-undo.sql
   cat .demo-cleanup-undo.sql      # đọc lại trước khi chạy
   psqlq -v ON_ERROR_STOP=1 < .demo-cleanup-undo.sql
   ```

   Nếu từ lúc dọn tới lúc hoàn tác, đồng bộ Pancake đã tạo biến thể thật mang SKU gốc (vd `FUWA-DW-1L`), câu gỡ tiền tố `DEMO-` vấp ràng buộc unique của `variations.sku`: psql báo `duplicate key value violates unique constraint "variations_sku_key"`, và vì `ON_ERROR_STOP=1` cả khối dừng trước `COMMIT`, không dòng nào đổi (an toàn). Khi đó tech lead xử lý tay: bỏ câu `UPDATE "variations" SET "sku" = substr(...)` khỏi `.demo-cleanup-undo.sql` (biến thể demo giữ tiền tố `DEMO-`, hàng thật giữ SKU gốc) rồi chạy lại, hoặc gỡ tiền tố riêng cho từng biến thể không trùng.

   Không khôi phục bản backup ở bước 6 để hoàn tác bước này: dump đó có trước migration ở bước 7, khôi phục là lùi cả lần deploy (xem mục rollback).

### Bước 8. Bật web mới

```bash
$DC up -d --no-build --no-deps web
```

`--no-deps` bắt buộc: nếu không, compose chờ API (đang dừng) khoẻ rồi mới bật web. Web bật trước API là chủ ý (ràng buộc 3). Chưa cần chờ web khoẻ vì nó cần API để render.

### Bước 9. Bật API mới và chờ khoẻ

```bash
$DC up -d --no-build --no-deps api
for i in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' "$($DC ps -q api)" 2>/dev/null || echo unknown)
  echo "$(date +%H:%M:%S) api=$s"; [ "$s" = healthy ] && break; sleep 3
done
curl -s http://127.0.0.1:14001/api/health; echo
```

`--no-deps` để compose không tạo lại Postgres và Redis (Redis đã tạo lại ở bước 5, Postgres đang chạy; compose mới khác compose cũ ở cấu hình log của Postgres, và không đáng để khởi động lại nó giữa cửa sổ).

Kỳ vọng: `api=healthy` trong vòng 3 phút (3 giây một lần, tối đa 180 giây); `/api/health` trả `{"status":"ok","db":"up","redis":"up",...}`. Điểm dừng: chưa healthy sau 5 phút, xem `$DC logs --tail 100 api`.

Container API khởi động bằng lệnh `prisma migrate deploy && node dist/main.js`, nên lúc này nó in "No pending migrations" (đã áp ở bước 7): đúng.

```bash
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$($DC ps -q web)" 2>/dev/null || echo unknown); echo "$(date +%H:%M:%S) web=$s"; [ "$s" = healthy ] && break; sleep 3; done
date '+%H:%M:%S'
```

Ghi giờ kết thúc: khách đã đặt hàng được lại từ lúc này. Tổng thời gian ngừng phục vụ: từ bước 5 đến đây: ______ phút.

### Bước 10. Go-live check sau deploy

```bash
$DC run --rm --no-deps -v /var/backups/tubutree:/var/backups/tubutree:ro api pnpm run go-live:check
```

Kỳ vọng: thoát 0, không FAIL. Các dòng migration phải PASS (giai đoạn mặc định là `post-deploy`: migration thiếu là FAIL), và `redis.policy` phải PASS (`noeviction`). `db.demo_products` phải PASS; `db.demo_coupons` PASS, hoặc WARN. WARN chỉ chấp nhận được khi mọi mã nêu trong dòng đó thuộc một trong hai loại: `đã chấp nhận giữ` (ba mã `WELCOME30`, `FREESHIP`, `XANH10` luôn được tính là đã duyệt vì chủ dự án giữ chúng cho đợt ra mắt, không cần đặt gì; mã demo khác mà chủ shop duyệt giữ thì chạy lệnh trên với `-e GO_LIVE_ACCEPT_DEMO_COUPONS=<mã>` ngay sau `run --rm`), hoặc `điều kiện khác bản demo` (mã chủ shop tự tạo trùng tên, chủ shop xác nhận điều kiện ở Quản trị). Mã demo chưa duyệt, của migration hay do seed tạo, đều là FAIL. Còn FAIL ở hai dòng này: quay lại bước 7c (API đang chạy cũng làm được, lệnh không cần dừng API). Dán kết quả vào nhóm chat.

Một FAIL sửa được ngay mà không cần quay lại: `db.waste_point`. Có hai nội dung FAIL: ("waste.enabled đang bật nhưng chưa có kho (WAREHOUSE) nào đang hoạt động") và ("waste.enabled đang bật, đường Gửi về kho đang bật nhưng kho đang hoạt động chưa có số điện thoại"). Chỉ FAIL khi `waste.enabled` bật và một trong hai điều sau đúng: chưa có kho ACTIVE; hoặc đường Gửi về kho đang bật (khoá `waste.lane_mailin_enabled` vắng cũng tính là bật) mà kho chưa có số điện thoại. Sửa: tắt `waste.enabled` ở Quản trị, Cấu hình, hoặc thêm một kho đang hoạt động ở Quản trị, Khách hàng, Đổi rác, Điểm nhận. Với FAIL thiếu số điện thoại: mở kho và điền ô "Số điện thoại" bằng số thật của kho, hoặc tắt `waste.lane_mailin_enabled` ở Quản trị, Cấu hình. Rồi chạy lại lệnh trên. Ba dòng WARN của kiểm này: (1) `waste.lane_pickup_enabled` bật nhưng Gomdon chưa sẵn sàng (công tắc `shipping.gomdon.recycling_enabled` hoặc `GOMDON_PHONE`/`GOMDON_PASSWORD`): đường Thu kèm đơn vẫn ẩn với khách. Cờ này là cờ toàn cục, không có danh sách theo khách: chỉ bật nó để chạy đơn thử trên bản chưa mở cho khách thật, và chỉ để bật lâu dài khi Gomdon đã trả lời bằng văn bản và đơn thử chạy đạt, nếu không thì tắt lại; (2) `waste.mailin_min_points` lớn hơn `waste.customer_monthly_cap_points`: đường Gửi về kho đóng với mọi khách; (3) `waste.pickup_min_points` lớn hơn `waste.customer_monthly_cap_points`: đường Thu kèm đơn đóng với mọi khách. Hai dòng sau sửa bằng cách hạ ngưỡng tối thiểu hoặc nâng trần tháng ở Quản trị, Cấu hình, nhóm waste. Các FAIL khác về cấu hình (`db.bank_account`, `db.admin_user`...) cũng sửa ở Quản trị hoặc `.env` rồi chạy lại; chỉ FAIL migration hoặc API không lên mới là lý do cân nhắc quay lại (mục 7).

### Bước 11. Kiểm tra khói (smoke test)

Người gõ lệnh làm phần máy; người theo dõi màn admin làm phần giao diện. Tick từng dòng.

Máy (chạy từ máy bất kỳ có internet):

```bash
curl -s https://api.tubutree.com/api/health; echo
curl -s -o /dev/null -w 'config/public %{http_code}\n' https://api.tubutree.com/api/config/public
curl -s -o /dev/null -w 'web %{http_code}\n' https://app.tubutree.com/
curl -s -o /dev/null -w 'pancake-webhook-khong-token %{http_code}\n' -X POST https://api.tubutree.com/api/webhooks/pancake
curl -s -o /dev/null -w 'gomdon-webhook-khong-token %{http_code}\n' -X POST https://api.tubutree.com/api/webhooks/gomdon
$DC exec -T redis redis-cli config get maxmemory-policy
$DC logs --since 10m api | grep -iE 'chạy cron|error' | head
```

Một lệnh thay cho phần `curl` đầu: `bash ops/check-edge.sh --local` (trên máy chủ) in `OK`/`WARN`/`FAIL` cho health, nén, cache, chứng chỉ, đĩa, container `unhealthy` và bản backup mới nhất; không được có `FAIL` (xem `--help`).

Kỳ vọng: `health` có `"db":"up","redis":"up"`; `config/public` 200; `web` 200; hai webhook không kèm token đều trả **401** (chứng tỏ đường vào tồn tại và từ chối người lạ; không gửi dữ liệu thật); Redis `noeviction`; log có đúng một dòng `Instance ... chạy cron.` và không có `error` lặp.

Giao diện:

- [ ] Quản trị, Sức khoẻ hệ thống: không có dòng đỏ; bấm "Gửi email thử" (nếu đã cấu hình SMTP): email tới hộp thư báo động trong vài phút.
- [ ] Quản trị, Đơn hàng: ô tìm kiếm gõ tên người nhận (có dấu và không dấu) ra kết quả (migration `recipientSearch`).
- [ ] Quản trị, Khách hàng, Đổi rác, Điểm nhận: mở được (danh sách trống ở lần đầu).
- [ ] Quản trị, Duyệt SP đối tác: mở được; mở một sản phẩm chờ duyệt thấy hộp Pancake. KHÔNG bấm duyệt thật ở bước này.
- [ ] Web khách (đăng nhập bằng tài khoản thử): trang một sản phẩm đã mua hiện khối đánh giá (API trả dữ liệu `can-review` mới với `reviewableOrders` và `myReviews`).
- [ ] Đăng nhập Zalo trên web hoạt động (xem [pilot-order-playbook.md](pilot-order-playbook.md) mục 1).

### Bước 12. Báo admin tải lại tab

Gửi tin cho mọi admin và nhân viên CSKH đang có tab Quản trị mở từ trước giờ deploy:

> Hệ thống vừa cập nhật. Anh/chị vui lòng đóng tab Quản trị đang mở và mở lại (hoặc tải lại cứng: Ctrl+Shift+R trên Windows, Cmd+Shift+R trên Mac) trước khi duyệt sản phẩm đối tác. Tab cũ gửi dữ liệu duyệt theo kiểu cũ nên có thể duyệt sai mã Pancake.

Lý do: dòng không có mã Pancake, web mới gửi `''` (chuỗi rỗng), còn tab cũ gửi `null`. API mới hiểu `null` là "không nói gì" và duyệt theo mã đang lưu, nên một quyết định "không có mã" của admin có thể bị bỏ qua.

### Bước 13. Theo dõi 30 đến 60 phút rồi mới phát hành Zalo Mini App

Ràng buộc 1: chỉ phát hành Mini App mới SAU khi API mới đã ổn. Trong 30 đến 60 phút: màn Sức khoẻ hệ thống không đỏ, không email báo động lạ, `$DC logs --since 30m api | grep -ci error` thấp. Chỉ khi đó mới phát hành Mini App mới: lên kênh test (`zmp deploy -t -e` ở `apps/miniapp`), quét QR kiểm trên Zalo thật, rồi mới gửi duyệt bản production (xem ba lệnh dưới). Cách làm nằm ở [DEPLOY_ZALO.md](../../DEPLOY_ZALO.md) và mục 7 của [docs/2026-10-review/99-release-readiness.md](../2026-10-review/99-release-readiness.md).

Ý nghĩa các cờ `zmp deploy`, đọc từ mã nguồn zmp-cli 4.0.5 (bản mới nhất trên npm; `apps/miniapp/package.json` không ghim zmp-cli nên máy chủ có thể cài bản khác, chạy `zmp -v` để đối chiếu):

| Lệnh | Việc nó làm |
|---|---|
| `zmp deploy -t -e -m "<mô tả>"` | `-t` = `--testing`: tạo phiên bản **Testing**, có số phiên bản, lưu ở mục Quản lý phiên bản của Mini App. `-e` = `--existing`: bỏ các câu hỏi tương tác. `-m` = mô tả phiên bản. Đây là lệnh đưa lên **kênh test**. Chưa kiểm: `-e` có tự build lại hay chỉ đẩy thư mục `www` đã có, nên chạy `pnpm --filter @tubutree/miniapp build` trước. |
| `zmp deploy -M production` (script `pnpm --filter @tubutree/miniapp deploy`, `apps/miniapp/package.json:10`) | `-M` = `--mode`: chỉ là tên mode môi trường khi build (đọc `.env.production`), KHÔNG phải "nộp production". Không có `-t` thì zmp hỏi loại phiên bản; mặc định là **Development**, bản này bị ghi đè ở lần deploy sau và không hiện ở Quản lý phiên bản. Nên dùng thêm `-t` nếu muốn có bản lưu để gửi duyệt. |
| Gửi duyệt và phát hành production | KHÔNG có lệnh nào trong zmp-cli làm việc này (CLI chỉ có hai loại phiên bản: Development và Testing). Làm thủ công trên trang quản lý Mini App của Zalo (mini.zalo.me): chọn phiên bản Testing đã UAT, gửi xét duyệt, chờ Zalo duyệt, rồi phát hành. Thời gian duyệt do Zalo quyết định, tính vào lịch ra mắt. |

Vì sao chờ: nếu phải quay API về bản cũ sau khi Mini App mới đã ra, màn đánh giá của Mini App mới sẽ hỏng. Chờ cho tới khi gần như không còn khả năng phải quay lại.

### Bước 14. Theo dõi 24 giờ

- [ ] Sau tối đa 6 giờ: `tail /var/log/tubutree-backup.log` thấy backup theo cron thành công (không có dòng `WARN`), `rclone ls tubucrypt: | tail -3` thấy file mới, healthcheck xanh.
- [ ] Chạy lại `go-live:check` (không kèm `--phase`).
- [ ] Màn Sức khoẻ hệ thống: không còn dòng đỏ tồn quá 1 giờ.
- [ ] Làm [pilot-order-playbook.md](pilot-order-playbook.md) (đơn thử thật) trước khi mở bán rộng.

### Bước 15. Bắt payload thật của đơn ngoài app (làm ngay sau khi lên bản mới, không chặn deploy)

Lưu ý B6/B9 (chủ dự án đọc trước khi lên bản): (a) từ lúc deploy, `pancake.external_capture_enabled` (mặc định `true`) lưu các đơn Pancake không đặt trong app vào `external_orders` KÈM SĐT đầy đủ của người mua; (b) khi bật B9 (`loyalty.chat_order_points_enabled`), bước bù `backfillChatClaims` (`apps/api/src/modules/external-points/external-chat.claim.ts`) tạo claim cho các đơn chat đã lưu trong vòng `loyalty.marketplace_claim_max_age_days` ngày gần nhất (mặc định 60), nên chủ dự án quyết số ngày này trước khi bật. Ngoài ra migration `20261018180000` đặt `coupons.createdAt` bằng thời điểm migrate cho mọi mã có sẵn (ngân sách ngày của nhân viên tính theo cột này).

Từ bản này API lưu mọi đơn Pancake không đặt trong app (đơn sàn Shopee/Lazada/TikTok, đơn chat, đơn gọi điện) vào bảng `external_orders` và hiện ở tab "Đơn ngoài app". Chưa cộng điểm cho đơn nào. Cách nhận biết đơn đang theo tên field trong tài liệu Pancake POS, CHƯA đối chiếu với payload webhook thật, nên cần vài đơn thật để chốt. Cờ `pancake.external_capture_enabled` (tab Cấu hình, nhóm pancake) mặc định bật; đặt `false` nếu cần dừng lưu đơn ngay.

1. Tạo (hoặc chờ có) ít nhất: 1 đơn Shopee, 1 đơn Lazada, 1 đơn TikTok, 1 đơn CSKH qua Facebook hoặc Zalo, 1 đơn gọi điện, 1 đơn đặt trong app, và 1 đơn bán tại quầy nếu quầy dùng Pancake POS. Theo dõi từng đơn tới khi đã giao; thêm 1 đơn bị hoàn và 1 đơn bị huỷ.
2. Mở tab "Đơn ngoài app" ở web admin (ADMIN, hoặc CSKH để chỉ xem). Đơn mỗi loại phải xuất hiện, mã vận đơn và SĐT (đã che) đúng, "Tiền hàng" khớp số trên Pancake. "Tiền hàng: chưa tính được" nghĩa là payload thiếu hoặc lệch số, ghi lại đơn đó.
3. Xem bảng "Nguồn đã thấy" cùng tab: mỗi dòng là một khoá `order_sources | account | marketplace_id` kèm số đơn và loại đang xếp. Đơn sàn phải ra "Đơn sàn · shopee/lazada/tiktok". Khoá của đơn chat hoặc điện thoại đang ra "Chưa biết nguồn" là bình thường: chép khoá đó vào `pancake.order_source_map`, mục `chatSources` (tab Cấu hình). Chỉ chép khoá của nguồn chat/điện thoại thật; khoá của quầy (nếu quầy dùng Pancake) thì KHÔNG chép, để không cộng điểm hai lần sau này. Đơn sàn có `marketplace_id` khác -3, -4, -9 thì thêm vào `marketplaceIds` (ví dụ `{"-3":"shopee","-4":"lazada","-9":"tiktok"}`). Đơn đã lưu trước khi sửa bản đồ giữ loại cũ cho tới khi Pancake gửi cập nhật mới của chính đơn đó.
4. Lấy payload thô để làm dữ liệu kiểm thử: nút "Xem payload Pancake" chỉ cho bản đã lọc (không có SĐT, tên, địa chỉ, ghi chú, vì bảng này không bị xoá theo hạn như log webhook). Payload đầy đủ lấy từ `pancake_webhook_events.rawPayload` (còn trong 90 ngày, chỉ khi chủ dự án cho phép đọc PROD) hoặc `GET /orders/{id}`; chép nội dung, XOÁ tên, SĐT, địa chỉ rồi lưu vào `apps/api/test/fixtures/pancake/<tên-mô-tả>.json` (bỏ chữ `synthetic` trong tên file, đây là file thật). Chỉ làm khi chủ dự án cho phép đọc dữ liệu PROD. Chụp thêm `GET /orders/{id}` của cùng đơn từ Pancake để so.
5. Việc cần xác nhận bằng payload thật (ghi kết quả vào nhóm chat): (a) Pancake có gửi webhook cho đơn sàn không, và có gửi lại khi đơn đã giao hoặc hoàn không; (b) mã vận đơn nằm ở field nào (`partner.extend_code`, `tracking_number`, `order_number_vtp`, `invoice_info_list[].order_sn`); (c) `status_history[].updated_at` theo giờ nào (bản này đọc là giờ Việt Nam +07:00); (d) đơn app có mang `custom_id` hoặc tag `MINIAPP`/`WEB` không (nếu không, đơn app chưa khớp có thể bị lưu nhầm là đơn ngoài); (e) quầy có dùng Pancake POS không.
6. Rồi giao cho agent: sửa `pancake.order_source_map` nếu cần và viết test ánh xạ theo fixture thật.

## 6. Gọi ai và khi nào

| Tình huống | Gọi | Mong đợi họ làm |
|---|---|---|
| Mọi điểm dừng ở mục 4 | Tech lead | Chẩn đoán, quyết định sửa tiến hay quay lại |
| Cần quyết định quay lại | Chủ shop | Chốt "quay lại" hoặc "sửa tiến"; chịu trách nhiệm báo khách nếu cần |
| Không đăng nhập được VPS, hết đĩa, Docker lỗi | Người giữ quyền root VPS | Xử lý hạ tầng chung với ChoDeli |
| Có khách phản ánh lỗi hàng loạt sau deploy | Chủ shop rồi Tech lead | Đọc log, quyết định |

Không tự ý chạy các lệnh trong mục 7 khi chưa có Chủ shop đồng ý, trừ 7.1 (migrate lỗi, chưa bật API: không ảnh hưởng khách vì API đang dừng).

## 7. Quay lại (rollback)

### 7.0 Chọn đường nào

Trước khi chọn, đọc `.pending-migrations` (danh sách chờ áp đã chốt ở mục 5 bước 4):

```bash
wc -l < .pending-migrations
cat .pending-migrations
```

| Tình huống | Đường | Mất dữ liệu? |
|---|---|---|
| Migrate lỗi (chưa bật API) | 7.1 | Không |
| Migrate xong, API/web mới lỗi, API mới CHƯA nhận khách (vài phút đầu), danh sách chờ áp CHỈ gồm các migration của đợt (r6, r8 điểm nhận vỏ, r8 đánh giá, r9 mốc tồn kho, r10 hàng trả cũ, Đổi rác lấy quà), và không có đánh giá trùng | 7.2 (chỉ quay image) | Không |
| Migrate xong nhưng danh sách chờ áp có BẤT KỲ migration nào ngoài sáu cái đó (p1, p4, p8, PD-3, hoặc tên khác), hoặc `.pending-migrations` không còn | 7.3 (khôi phục bản backup). KHÔNG dùng 7.2 | Mất mọi thứ ghi sau bước 6 |
| Migration `20261020000000_waste_exchange` (Đổi rác lấy quà) chỉ THÊM bảng, cột, enum và chỉ mục, tương thích với image cũ: quay về image trước là an toàn vì các bảng, enum và cột của Refill được giữ nguyên và không có lệnh DROP nào (R13.1.9) | 7.2 nếu mọi điều kiện của 7.2 thoả | Không |
| Quay image nhưng đã có khách ghi đánh giá lần hai cho cùng một sản phẩm | 7.3 (khôi phục bản backup) hoặc gộp tay đánh giá rồi 7.2 (chỉ khi danh sách chờ áp chỉ là các migration của đợt) | 7.3 mất dữ liệu sau điểm backup |
| Hỏng nặng, không rõ nguyên nhân, cần về đúng trạng thái trước deploy | 7.3 | Mất mọi thứ ghi sau bước 6 |
| Chỉ lỗi giao diện hoặc lỗi nhỏ, schema ổn | KHÔNG quay lại: sửa tiến bằng hotfix, deploy lại theo mục 5 (bỏ bước migrate nếu không có migration mới) | Không |

**Điều cần hiểu trước (quay image có an toàn không):** quay lại bằng image chỉ hợp lệ khi image cũ chạy đúng trên schema SAU migrate. "Image cũ" ở đây là image đã ghi ở mục 5 bước 2, và nó mong đợi schema của bản PROD cũ (mục 1.0). Chỉ riêng sáu migration của đợt thì schema sau migrate vẫn tương thích với image cũ (chúng chỉ thêm cột, bảng, chỉ mục, hoặc đánh dấu `receivedAt` cho hàng trả cũ mà code cũ không đọc, trừ chỉ mục đánh giá, xem dưới). Nhưng nếu PROD cũ hơn thì danh sách chờ áp còn chứa các migration đổi dữ liệu và ràng buộc mà image cũ không chịu nổi, ví dụ:

- p8 (`20261014003831_p8_seller_merchant_fulfilment`) đổi hoa hồng PAID của lệnh rút REQUESTED hoặc APPROVED về APPROVED, cho `products.pancakeId` và `variations.pancakeId` cho phép NULL và đặt NULL cho mã `MCH_`: code cũ khai báo cột này là chuỗi bắt buộc và duy nhất nên đọc các dòng đó bị lỗi.
- PD-3 quy đổi số dư xu về 0 và thêm ràng buộc `coinsBalance = 0`: code cũ vẫn ghi xu sẽ bị từ chối, và số dư xu đã bị đổi thành điểm không tự quay lại.
- `20261018210000_points_1d` nhân 1.000 mọi số điểm: image cũ đọc số điểm theo đơn vị cũ nên giá quà, trần và số dư sai nghiêm trọng. Hoàn tác = khôi phục backup trước migrate (7.3); không quay image, không có script đảo ngược.
- Các migration q1 và r5 thêm giá trị mới `PROCESSING`, `UNVERIFIED`, `DISMISSED` cho enum `CustomerRefundStatus`: dòng hoàn tiền mang giá trị mới làm code cũ lỗi khi đọc, và giá trị enum đã thêm không gỡ được.
- `20261022100000_payout_tax_refunded` thêm giá trị `PIT_REFUND` cho enum `WalletTxType` (cùng cột `payouts.taxRefunded`): dòng sổ ví loại `PIT_REFUND` làm code cũ lỗi khi đọc (Prisma báo enum lạ), và giá trị enum đã thêm không gỡ được. Migration này không nằm trong `IMAGE_COMPATIBLE_MIGRATIONS`; đã có dòng `PIT_REFUND` (admin từ chối lệnh rút hoa hồng làm hoàn thuế TNCN giữ dư vào Ví) thì đường quay lại là 7.3.

Vì vậy: danh sách chờ áp có migration ngoài sáu cái của đợt, hoặc bất kỳ migration nào ở trên đã chạy (kể cả chỉ một phần), thì đường quay lại duy nhất là 7.3 (khôi phục bản backup trước deploy). 7.2 giữ nguyên cho đúng trường hợp hẹp nó đúng: PROD đã ở bản mà chỉ còn các migration của đợt chờ áp.

Migration `20261015150000` (đánh giá nhiều lần) còn là **một chiều (forward-only)**. Sau khi áp, một khách có thể có nhiều đánh giá cho cùng một sản phẩm (mỗi lần mua một đánh giá). Chỉ mục cũ (một đánh giá cho mỗi khách và sản phẩm) không thể dựng lại nếu đã có đánh giá trùng. Vì vậy quay schema về bản cũ chỉ làm được bằng một trong hai cách: (a) khôi phục bản backup trước deploy (7.3), hoặc (b) khi danh sách chờ áp chỉ là các migration của đợt: gộp các đánh giá trùng trước rồi dựng lại chỉ mục cũ (7.2). Các migration `20261014213300` (cột tìm kiếm người nhận + trigger) và `20261015070000` (bảng điểm nhận vỏ + cột `pickupLocationId` cho phép rỗng) chỉ THÊM, bản code cũ bỏ qua chúng nên không cần hoàn tác.

### 7.1 Migrate lỗi giữa chừng (API vẫn đang dừng)

1. Xem tình trạng:

```bash
psqlq -c "SELECT migration_name, started_at, finished_at, rolled_back_at, left(logs, 300) AS log FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL"
```

2. Đếm xem migration của đợt này đã xong được bao nhiêu trước khi lỗi. Prisma áp từng migration trong một giao dịch riêng, nên các migration chạy xong TRƯỚC migration lỗi vẫn nằm lại trong schema:

```bash
psqlq -tAc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"
```

So với số "migrations đã áp xong" ghi ở mục 5 bước 6 (cùng cách đếm, chỉ dòng đã xong). Bằng nhau: chưa migration nào của đợt xong, schema còn nguyên bản cũ. LỚN HƠN: đã có migration của đợt xong, schema đã đổi một phần: KHÔNG bật lại API cũ trên schema đó (không biết nó tương thích không); chọn giữa sửa tiến (điểm 3 và 4 rồi chạy lại mục 5 bước 7 cho phần còn lại) hoặc 7.3 (khôi phục backup).
3. Mỗi migration chạy trong một giao dịch, nên migration lỗi không để lại thay đổi dở dang trong schema (vẫn nên xác nhận bằng các truy vấn xác minh ở mục 5 bước 7). Không còn dòng nào ở điểm 1 thì migrate đã dừng sạch giữa các migration: sửa nguyên nhân (hết đĩa, lock bị giữ, v.v.) rồi chạy lại mục 5 bước 7.
4. Còn dòng dở (ở điểm 1) thì đánh dấu đã hoàn tác rồi chạy lại: `$DC run --rm --no-deps api pnpm exec prisma migrate resolve --rolled-back <tên migration>`, sau đó mục 5 bước 7. Làm cùng Tech lead. Việc này BẮT BUỘC cả khi chỉ định trả dịch vụ ngay (điểm 6 bên dưới).
5. Không sửa được trong 15 phút, hoặc không chắc schema còn nguyên, hoặc điểm 2 cho thấy một phần migration đã xong mà không sửa tiến được: 7.3 (khôi phục backup) rồi bật lại API cũ (xem 7.3).
6. Muốn trả dịch vụ ngay khi chưa migrate được: chỉ làm được khi điểm 2 cho thấy KHÔNG migration nào của đợt xong (schema còn nguyên bản cũ), và SAU KHI đã chạy `migrate resolve --rolled-back` ở điểm 4 cho dòng dở. Không resolve thì dòng hỏng vẫn nằm trong `_prisma_migrations`; container API cũ khởi động bằng `prisma migrate deploy && node dist/main.js` (và `restart: unless-stopped`), gặp dòng hỏng thì báo `P3009`, thoát, rồi khởi động lại mãi: crash-loop, không phục vụ được. Sau khi resolve, không cần dựng chỉ mục; container API cũ vẫn còn nguyên (mới `stop`) nên chạy:

```bash
$DC start api
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$($DC ps -q api)" 2>/dev/null || echo unknown); echo "$(date +%H:%M:%S) api=$s"; [ "$s" = healthy ] && break; sleep 3; done
$DC logs --tail 20 api | grep -E 'P3009|migrate|No pending'
```

Kỳ vọng: `api=healthy`, log có "No pending migrations to apply" và không có `P3009`. Điều kiện: CHƯA chạy `up -d` thay container ở bước 8 và 9 của mục 5 (nếu rồi thì container API đã là bản mới: dùng 7.2 hoặc 7.3 theo bảng 7.0, không dùng đường này).

### 7.2 Chỉ quay image (giữ DB đã migrate, giữ dữ liệu phát sinh)

Chỉ đúng khi image cũ khớp schema sau migrate (mục 7.0). Hai điều kiện BẮT BUỘC (nếu không thoả, sang 7.3):

1. Danh sách chờ áp đã áp ở mục 5 bước 7 chỉ gồm các migration của đợt (tối đa sáu cái, không thêm cái nào khác):

```bash
cat .pending-migrations
```

Mọi dòng phải nằm trong sáu tên này (PROD đã ở bản gần đây thì có thể chỉ thấy một vài dòng trong số đó): `20261014213300_r6_admin_orders_recipient_search`, `20261015070000_r8_refill_locations_table`, `20261015150000_r8_multi_reviews_unique_per_order`, `20261015160000_r9_sync_stock_same_clock_markers`, `20261015170000_r10_legacy_returns_received`, `20261020000000_waste_exchange`. Có dòng tên khác, hoặc không còn file: DỪNG, đây là trường hợp 7.3 (7.0 nói vì sao: p8, PD-3... không quay lại được bằng image).

2. Không có đánh giá trùng. Kiểm này làm trong khối lệnh dưới, SAU khi đã dừng API và web, vì nếu API mới còn phục vụ thì khách vẫn ghi thêm đánh giá giữa lúc kiểm và lúc dựng chỉ mục.

Các bước, dán nguyên cả khối (khối chạy trong một shell con có `set -e`: lệnh nào lỗi thì cả khối dừng ngay và API cũ KHÔNG được bật):

```bash
(
  set -euo pipefail
  . ./.rollback-images
  $DC stop web api
  DUP=$(psqlq -tAc 'SELECT count(*) FROM (SELECT 1 FROM reviews GROUP BY "userId", "productId" HAVING count(*) > 1) d')
  echo "số cặp (khách, sản phẩm) có nhiều hơn một đánh giá: $DUP"
  [ "$DUP" = 0 ] || { echo "DỪNG: còn đánh giá trùng, chưa dựng chỉ mục, KHÔNG bật API cũ. API và web đang dừng: xem hướng dẫn ngay dưới khối này"; exit 1; }
  psqlq -v ON_ERROR_STOP=1 -c 'CREATE UNIQUE INDEX "reviews_userId_productId_key" ON "reviews"("userId", "productId")'
  docker tag "${API_NAME%%:*}:rollback" "$API_NAME"
  docker tag "${WEB_NAME%%:*}:rollback" "$WEB_NAME"
  $DC up -d --no-build --no-deps api
  $DC up -d --no-build --no-deps web
  docker inspect -f '{{.Image}}' "$($DC ps -q api)"; echo "mong đợi: $API_ID"
)
echo "mã thoát khối: $?"
```

Kỳ vọng: in `CREATE INDEX`, rồi hai id image giống nhau, và `mã thoát khối: 0`. Mã thoát khác 0: chỉ mục chưa dựng được hoặc còn đánh giá trùng, API cũ chưa bật. Lúc này khách đang không đặt được hàng (API và web dừng): gọi ngay Tech lead và Chủ shop. Hoặc Chủ shop và Tech lead chọn đánh giá nào giữ (xoá hoặc gộp các đánh giá còn lại; xem các cặp trùng bằng `psqlq -c 'SELECT "userId", "productId", count(*) FROM reviews GROUP BY 1,2 HAVING count(*) > 1'`) rồi dán lại khối lệnh cho tới khi ra `mã thoát khối: 0`, hoặc khôi phục backup (7.3). Lệnh `$DC stop web api` trong khối chạy lại được vô hại.

Giải thích: dựng lại chỉ mục cũ để code cũ chạy đúng ràng buộc của nó. Chỉ mục mới `reviews_userId_productId_orderId_key` cứ để đó (vô hại với code cũ). Hai id in ra phải giống nhau: chứng tỏ container API đang chạy đúng image cũ. Image cũ chạy `prisma migrate deploy` trên DB đã có thêm các migration mới sẽ báo "No pending migrations to apply" và không kẹt (đã thử cục bộ: thư mục migration bản cũ chạy với DB đã migrate đủ, kết quả đúng như vậy; mục 8 của `99-release-readiness.md` ghi nhận cùng hành vi cho lần phát hành trước).

Quay API và web cùng nhau (hai lệnh `docker tag` ở khối trên đã gắn lại cả hai). Không quay API một mình: web admin mới gửi `expectedAmount` khi duyệt/chi lệnh rút, API cũ từ chối vì `forbidNonWhitelisted` (400), admin không duyệt hay chi được. Báo admin và kế toán tải lại mọi tab Quản trị (như bước 12): tab đã mở từ lúc web mới chạy vẫn giữ mã web mới, bấm Duyệt hoặc Đã chi sẽ bị 400.

Sau khi quay image: màn Quản trị, Sức khoẻ hệ thống và `curl .../api/health` phải ổn. Dữ liệu phát sinh sau deploy được giữ nguyên.

**Khi sau này phát hành lại bản mới (sau 7.2) phải gỡ chỉ mục cũ**, nếu không tính năng đánh giá nhiều lần sẽ bị chặn âm thầm (migration đã ghi là áp rồi nên sẽ không chạy lại):

```bash
psqlq -c 'DROP INDEX "reviews_userId_productId_key"'
```

### 7.3 Khôi phục bản backup trước deploy (về đúng trạng thái trước bước 7)

MẤT mọi dữ liệu ghi sau bước 6 (đơn, thanh toán, đánh giá, đăng ký mới...). Chỉ làm khi Chủ shop đồng ý bằng lời trong nhóm chat.

Thứ tự quan trọng: phải đưa container về image CŨ trước, vì `restore-db.sh` bật lại API bằng `docker compose start api` (khởi động lại đúng container hiện có). Nếu container đó đang là bản mới, API mới sẽ bật lên trên DB cũ và `prisma migrate deploy` áp lại toàn bộ các migration chờ áp (`.pending-migrations`). Đây cũng là đường quay lại bắt buộc khi danh sách chờ áp có migration ngoài sáu cái của đợt (7.0): bản backup ở bước 6 là bản DUY NHẤT còn nguyên schema cũ.

```bash
. ./.rollback-images
ROLLBACK_DUMP=$(cat .rollback-dump); echo "$ROLLBACK_DUMP"; gunzip -t "$ROLLBACK_DUMP" && echo OK
$DC stop web api
docker tag "${API_NAME%%:*}:rollback" "$API_NAME"
docker tag "${WEB_NAME%%:*}:rollback" "$WEB_NAME"
$DC up --no-start --no-build --no-deps api web
docker inspect -f '{{.Image}}' "$($DC ps -aq api)"; echo "mong đợi: $API_ID"
COMPOSE_FILE=docker-compose.vietnix.yml POSTGRES_USER=$PGUSER POSTGRES_DB=$PGDB bash tools/backup/restore-db.sh "$ROLLBACK_DUMP"
```

`restore-db.sh` hỏi, gõ `YES`. Script nạp bản backup vào DB tạm, đổi tên, bật API cũ (đã là container image cũ). DB hỏng được giữ lại với tên `<db>_before_restore_<giờ>` để đối chiếu. Rồi:

```bash
$DC start web
psqlq -tAc "SELECT (SELECT count(*) FROM orders), (SELECT count(*) FROM users), (SELECT count(*) FROM reviews), (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)"
curl -s http://127.0.0.1:14001/api/health; echo
```

Kỳ vọng: bộ 4 số khớp bộ ghi ở bước 6 (migrations là số cũ, không có migration nào trong `.pending-migrations`), `health` ổn. Image cũ chạy `prisma migrate deploy` lúc khởi động trên DB đã khôi phục sẽ thấy đúng các migration của nó đã áp, nên không áp gì thêm.

Việc sau khôi phục:

0. Báo admin và kế toán tải lại mọi tab Quản trị (như bước 12): tab mở từ lúc web mới chạy gửi `expectedAmount` khi duyệt/chi lệnh rút, API cũ trả 400.
1. Đối chiếu các đơn phát sinh giữa bước 6 và lúc khôi phục (không có nếu quay lại ngay sau migrate, vì API dừng từ bước 5): so với Pancake POS và sao kê ngân hàng; đơn nào có tiền mà không có trong DB thì tạo lại hoặc hoàn tiền.
2. Hàng đợi Redis còn job cũ tham chiếu đơn không còn: xem Sức khoẻ hệ thống, các dòng `queue.<tên>`; xử lý hoặc xoá job lỗi sau khi đối chiếu.
3. DB `<db>_before_restore_...` chỉ xoá khi Tech lead đồng ý (lệnh `DROP DATABASE` nằm cuối đầu ra của `restore-db.sh`).
4. Nếu Mini App mới đã được phát hành trước đó: màn đánh giá của nó sẽ không khớp API cũ. Báo Tech lead và Chủ shop để quyết định cách gỡ Mini App mới hay chấp nhận tạm thời. (Đó là lý do chờ ở bước 13.)

### 7.4 Chỉ web có vấn đề

Web không có schema riêng: quay web một mình bằng `docker tag "${WEB_NAME%%:*}:rollback" "$WEB_NAME" && $DC up -d --no-build --no-deps web`. Lưu ý cặp web cũ với API mới: tab admin cũ sẽ gửi `null` cho mã Pancake rỗng (xem bước 12), nên chỉ làm tạm. Riêng việc duyệt/chi lệnh rút thì cặp web cũ với API mới không lỗi, vì `expectedAmount` là tuỳ chọn; chỉ cặp web mới với API cũ là hỏng (xem mục 0.2, ràng buộc 3).

## 8. Tham chiếu

- [ops/README-vietnix-deploy.md](../../ops/README-vietnix-deploy.md): nền tảng VPS, DNS, chứng chỉ, Redis và log.
- [tools/backup/README.md](../../tools/backup/README.md): backup, restore, diễn tập.
- [docs/GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md): khoá và kênh báo động.
- [docs/2026-10-review/99-release-readiness.md](../2026-10-review/99-release-readiness.md): lần phát hành trước, kể cả đo thời gian migration.
- [pilot-order-playbook.md](pilot-order-playbook.md): kịch bản đơn thử thật sau khi lên bản mới.
- Lệnh kiểm tra: `pnpm run go-live:check` (trong `apps/api`), mã nguồn ở `apps/api/scripts/go-live-check.ts` và `apps/api/src/config/go-live/`.

## 9. Chat CSKH qua Zalo cá nhân

Lần phát hành có chat thêm service `zalo-bridge` (khai trong `docker-compose.prod.yml` và `docker-compose.vietnix.yml`, volume `zalo_bridge_data`, không có cổng ra ngoài) và bốn migration chỉ thêm: `20261023100000_support_chat`, `20261023110000_support_bridge_actions`, `20261024100000_support_chat_hardening`, `20261024120000_support_message_seen` (bản cuối có một câu UPDATE điền cột `seenAt` mới cho tin cũ). API lên trước bản Mini App mới: bản mới gửi `{ ids }` khi đánh dấu đã đọc, API cũ trả 400. API cần `ZALO_BRIDGE_URL`, `ZALO_BRIDGE_SECRET`; bridge cần `ZALO_BRIDGE_SECRET`, `ZALO_BRIDGE_CREDENTIALS_KEY`. Gộp với `chat.enabled = false`. Gỡ về: tắt công tắc chat, `stop zalo-bridge`; không cần gỡ migration. Chi tiết: [docs/2026-10-23-q5/bat-chat-zalo.md](../2026-10-23-q5/bat-chat-zalo.md).
