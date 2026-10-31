# Đợt quyết định 30/10: đợt 2

Gốc so sánh: `6fae1a289`, gồm main 0c9f8eb69 và đợt 1 (PR #85, đã merge vào main d8c46a7a8). Nhánh gộp: `review/qd2-2026-10-31`. Quyết định của chủ: `docs/2026-10-28-e2e/21-quyet-dinh.md` mục E.

E-77 (xoá khoá `home.new_customer_layout`) chưa làm. Mục này sửa `apps/miniapp/src/pages/home.tsx`, mà gói goi-dau của phiên b4 đang sửa file này. Làm sau khi goi-dau merge.

Quy trình: worker Sonnet làm từng gói, Opus review đối kháng từng gói, rồi Opus review lại bản gộp.

## Kết quả theo gói

| Gói | HEAD | Lượt review | Mục |
|---|---|---|---|
| vi | b9c69c324 | 3 lượt + review bản gộp | E-46 |
| ghicong | b4d5f87d3 | 2 lượt | Ghi công CTV từ lúc bấm link, 3 P3 dấu chạm của P3b |
| khach2 | f4159d5d7 | 2 lượt + review bản gộp | E-80, E-6 |

## Luật mới

### E-46: hoa hồng vào Ví lúc 8:00
- Hoa hồng đủ hạn vẫn được duyệt mỗi giờ như trước, nhưng không gửi tin. `approvedAt` không đổi, nên doanh số mốc thưởng tháng không bị dời.
- Chuyển vào Ví và gửi tin tổng chạy một lần mỗi ngày (giờ VN), từ 8:00.
  - Lượt bị lỡ (deploy, khởi động lại, DB lỗi) thì giờ sau chạy bù.
  - Mốc đã chạy nằm ở `cron_runs`, job `AffiliateService.dailyWalletTransfer`.
  - Có khoá advisory nên hai tiến trình không chạy chồng nhau.
- Tin gửi CTV:
  - Đã chuyển: "💰 Tubu Tree đã chuyển {{amount}} hoa hồng ({{count}} đơn) vào Ví của bạn{{tax_note}}. Bạn dùng được ngay khi thanh toán."
  - Đã duyệt (khi cờ tự chuyển tắt, hoặc CTV không tự chuyển được): "✅ Tubu Tree đã duyệt hoa hồng của {{count}} đơn (tổng {{amount}}). Bạn vào mục Hoa hồng, bấm Chuyển vào Ví để nhận tiền nhé."
- Nút "Chuyển vào Ví" thủ công vẫn chạy như cũ. Số tiền, thuế và điều kiện đủ hạn không đổi.
- Màn CTV ghi "Tự vào Ví Tubu lúc 8:00 sáng". Riêng CTV bị khấu trừ thuế mà chưa khai MST thì màn nhắc khai MST.

### Ghi công CTV: hạn tính từ lúc bấm link
- Client gửi `clickedAgoMs`, tức số mili giây từ lúc bấm, đo trên cùng đồng hồ máy. Máy chủ tính `clickedAt = now - ago`, rồi `hạn = clickedAt + affiliate.attribution_days`. Đồng hồ máy khách lệch không làm sai kết quả.
- Lượt bấm sau thắng, so theo lúc bấm, kể cả khi admin đổi số ngày. Chạm bù cũ hơn không làm ngắn hạn của lượt bấm mới hơn. Dòng đã hết hạn thì được thay.
- Mở lại link (`?ref=`, `/s/<mã>`, link subdomain) tính là bấm mới. Điều hướng trong app và tải lại trang web thì không.
- Dấu chạm CTV gắn với từng người dùng. Người đăng nhập sau trong cùng tab không thừa hưởng dấu của người trước.
- Bản Mini Live cũ không gửi `clickedAgoMs`: máy chủ ghi `clickedAt = now` như trước.

### E-80: tin khi lên hạng
- Mã tin `TIER_UPGRADED`, gửi trong app. Câu: "Chúc mừng bạn đã lên hạng {{tier}} tại Tubu Tree 🌿". Bấm vào mở `/loyalty`.
- Không gửi khi: hạ hạng, giữ hạng, hoặc khách mới được gán hạng đầu tiên. Khách chưa có hạng mà lên thẳng hạng cao thì vẫn gửi.
- Ghi hạng có so-và-ghi, kể cả nhánh ân hạn. Lượt thua thì tính lại một lần. Mỗi lần lên hạng thật gửi một tin.

### E-6: tự áp mã giảm ở thanh toán
- Khi thanh toán cả giỏ, giỏ chưa có mã và khách đã đăng nhập, app chọn mã giảm nhiều nhất (tiền giảm cộng phí giao được miễn) rồi áp bằng đường áp mã hiện có.
- Màn hiện "Đã tự áp" kèm nút "Gỡ". Đã gỡ thì không áp lại trong phiên, kể cả khi tải lại trang. Cờ này xoá khi đặt đơn xong.
- Không tự áp khi:
  - giỏ đã có mã;
  - chưa đăng nhập;
  - không có mã dùng được;
  - đang ở "Mua ngay" hoặc thanh toán một phần giỏ (có `itemIds`);
  - xem trước hoặc áp mã bị lỗi.
- Không đổi API, giá, phí, cách tính giảm hay điểm.

## Migration (3, chỉ thêm hoặc cập nhật có điều kiện)
- `20261031090000_commission_daily_summary_templates`: đổi hai mẫu tin hoa hồng, chỉ khi thân mẫu còn đúng chữ cũ.
- `20261031100000_tier_upgraded_template`: chèn mẫu `TIER_UPGRADED`, ON CONFLICT DO NOTHING.
- `20261031110000_referral_touch_clicked_at`: thêm cột `referral_touches.clickedAt`, nullable, không backfill.

PROD đang ở migration 245. Main có thêm 4 migration của đợt 1, đợt này thêm 3, tổng 252.

## Việc của chủ và điều chủ cần biết
- **Thứ tự deploy** (runbook 1.15–1.17): web và Mini mới không được chạy cùng API cũ. Mini mới chỉ gửi Live sau khi API mới đã lên. Quay API về bản cũ thì quay cả web, và kéo Mini Live về bản cũ.
- **Thuế TNCN:** khoản đủ hạn vào chiều ngày cuối tháng sẽ vào Ví sáng ngày 1 tháng sau, nên tính thuế vào tháng sau. Đây là hệ quả của việc chuyển một lần mỗi ngày.
- **Hoa hồng giảm theo mã:** hoa hồng CTV tính trên số tiền khách thực trả sau mã. Tự áp mã sẽ làm hoa hồng và doanh số mốc thưởng giảm ở những đơn mà khách có mã nhưng trước đây không tự chọn.
- **Bật tự chuyển muộn:** admin bật cờ tự chuyển sau 8:00 thì việc tự chuyển bắt đầu từ 8:00 sáng hôm sau.
- **Lượt ngày đầu tiên sau deploy:** nếu deploy sau 8:00 thì lượt này chạy ở giờ kế tiếp. CTV chưa được tự chuyển có thể nhận lại một lần tin "đã duyệt".
- **Bản Mini Live cũ:** mỗi lần tải lại vẫn được coi là lượt bấm mới nhất. Hết khi Mini mới lên Live.
- **"Mua ngay":** không tự áp mã.

## Còn lại (P3, để sau)
- `pickBestCoupon` cộng tiền giảm với phí giao được miễn mà chưa trừ phần giảm theo hạng, nên có thể chọn lệch vài trăm đồng.
- Mini tải lại WebView mà URL còn `?ref=` vẫn tính là bấm mới. Sửa thì entry tăng 353 B, vượt trần 300 B.
- Chạm bù cũ hơn vẫn trả `ok:true`, nên tab đó vẫn mang mã cũ vào đơn, giống hành vi trước đây.
- Hai đơn giao cùng lúc đưa khách vượt hai hạng thì khách nhận hai tin lên hạng, mỗi tin cho một hạng.
- Bảng ops-health hiện "OK" cho dòng mốc lượt ngày ngay cả khi lượt ngày chưa chạy. Báo động thật vẫn đi qua dòng `approveDueCommissions`.
- `needsTaxIdForAutoTransfer` chỉ ước tính theo một lần chuyển. Máy chủ cộng dồn thuế theo tháng nên có thể lệch ở mức biên.

## Kiểm chứng bản gộp
- Bản gộp cd539f5fd, trước các bản sửa sau review bản gộp:
  - Gate: 0 FAIL.
  - Race: 70 bộ, 636 ca, đều qua.
  - Playwright web: 378 qua.
  - Playwright Mini: 219 qua. Có 1 ca chập chờn `returns-reversal.miniapp.spec.ts:141`, qua ở lần chạy lại. Ca này không thuộc vùng đợt 2 sửa.
- Opus review bản gộp: không P1, không có lỗi do gộp. Có 1 P2 (màn CTV hứa tự vào Ví với CTV thiếu MST) và 4 P3. Đã sửa P2 và P3 báo lỗi giả, P3 hạng lên trễ, P3 runbook. P3 lượt ngày đầu được ghi vào runbook.
- Sau khi gộp các bản sửa (dc8e6c5a4):
  - Gate: 0 FAIL. jest api 509 bộ, 11904 ca. vitest web 8152 ca, Mini 5364 ca (cả múi UTC), app-core 1335 ca. Bundle Mini: entry 711/222 KB.
  - Race: 44 bộ liên quan, 431 ca, đều qua.
  - Không chạy lại Playwright. Từ cd539f5fd chỉ đổi chữ màn CTV (đã có vitest), log và CAS ở API, và runbook.
