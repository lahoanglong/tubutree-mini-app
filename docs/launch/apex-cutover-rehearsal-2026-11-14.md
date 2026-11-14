# Diễn tập cutover apex tubutree.com (W148B), 14/11/2026

Trạng thái: **đã diễn tập và chuẩn bị xong phần việc của agent; CHƯA đổi Apache thật, CHƯA đổi DNS, CHƯA deploy.** WordPress ở tubutree.com vẫn chạy y nguyên.
Chưa thể cutover thật vì còn 4 việc cần chủ (mục 6). Lệnh cutover và rollback ở mục 5.

## 1. Kết luận ngắn

| Hạng mục | Kết quả |
| --- | --- |
| Live tubutree.com | `200`, `X-Origin: zencloud`, A = `42.1.122.84`, không bị đụng (đo lại 14/11 08:30 +07, sau khi dọn dẹp) |
| Backup trước cutover | Xong phần công khai (vhost, TLS, JSON, sitemap, 3556 ảnh). **KHÔNG có dump CSDL, wp-config.php, .htaccess**: WordPress không nằm trên VPS (mục 2) |
| Phủ URL WordPress | 459 đường dẫn, xếp loại đủ 459/459 (147 chuyển hướng 301, 87 trả 410, 221 blog/ảnh qua proxy, 4 trang của web mới). 238/238 URL không phải blog PASS qua middleware thật (1 chặng, 0 vòng lặp, 0 chuỗi 2 chặng) |
| Phủ URL trên Next THẬT của VPS (cổng 14000, bản dựng cũ) | 229 PASS, **9 FAIL** (8 sitemap con Rank Math và `/locations.kml` trả 404). Luật mới nằm trong commit này, cần deploy web để hết FAIL |
| Diễn tập Apache cổng 18443 (Apache riêng của aaPanel, vhost thật) | 468/468 PASS qua Apache thật, rollback 124–390 ms. Chạy lúc danh sách còn 453 đường dẫn; 6 URL `/category/style/` và `/tag/*` thêm sau là loại blog proxy, đã kiểm riêng: cả 6 trả 200 ở ZenCloud |
| Preflight THẬT trên VPS (chỉ đọc) | **4 FAIL**, đều việc của chủ: chưa có chứng chỉ, SITE_URL, CORS, bảng chuyển hướng mới chưa deploy |

## 2. Điều spec giả định mà thực tế khác

Spec viết như thể WordPress nằm trên VPS Vietnix. Đo thực tế:

- WordPress của tubutree.com chạy ở **ZenCloud** (`42.1.122.84`, nginx + LiteSpeed, header `X-Origin: zencloud`). VPS Vietnix `14.225.207.177` KHÔNG có `/www/wwwroot/tubutree.com` (trước khi tôi tạo thư mục ảnh), không có `wp-config.php`, MySQL không chạy (socket `/tmp/mysql.sock` không tồn tại). Chỉ có `/www/wwwroot/default`.
- Vì vậy bước "mysqldump CSDL WordPress" và "lưu wp-config.php, .htaccess" **không làm được từ phiên này**, và tôi không đụng ZenCloud (không có tài khoản, ngoài phạm vi). Cần chủ chạy ở ZenCloud (cPanel backup, hoặc `mysqldump --single-transaction` cộng `tar` của `wp-config.php`/`.htaccess`; lệnh cụ thể ở ZenCloud tôi chưa kiểm).
- Danh mục URL lấy từ sitemap Rank Math và REST công khai `/wp-json/wp/v2/*` thay cho truy vấn MySQL. Đủ cho trang đã index; không thấy bài nháp, trang riêng tư, đơn hàng, người dùng.
- Cutover KHÔNG đổi gì ở ZenCloud: quay lại là đổi lại bản ghi A. Vẫn cần dump trước khi chủ định tắt WordPress ở ZenCloud (việc đó không nằm trong cutover này).

## 3. Phát hiện trên VPS (chỉ đọc)

- Máy `tubutree`, Ubuntu 24.04.3, Apache 2.4.62 của aaPanel tại `/www/server/apache`. Vhost ở `/www/server/panel/vhost/apache/` (`IncludeOptional ...*.conf`, dòng 502 của `httpd.conf`).
- Vhost hiện có: `api.tubutree.com.conf`, `app.tubutree.com.conf` (+ bản `.bak-zalo-20261025130905`), `phpmyadmin.conf`, `0.default.conf`. **Chưa có vhost tubutree.com hay www.**
- `mod_remoteip` ĐÃ nạp (`remoteip_module (shared)` trong `apachectl -M`); chỉ vhost api dùng (`<IfModule mod_remoteip.c>`). Vhost apex không cần khi ☁ xám. Nếu sau này bật ☁ cam cho apex phải thêm `RemoteIPHeader` như vhost api, kẻo mọi khách cùng một IP Cloudflare.
- `mod_proxy`, `proxy_http`, `ssl`, `rewrite`, `alias`, `headers`, `deflate`, `filter` đều nạp.
- Chứng chỉ trên VPS: chỉ `api.tubutree.com` và `app.tubutree.com`, cả hai hết hạn 23/01/2027 01:38 GMT. **Không có chứng chỉ tubutree.com.** certbot 2.9.0, chưa có plugin `dns-cloudflare` (apt có ứng viên `python3-certbot-dns-cloudflare 2.0.0-1`, khác phiên bản certbot: sau khi cài chạy `certbot plugins` xem plugin có nạp không), chưa có `/root/.secrets/`.
- Chứng chỉ tubutree.com + www đang chạy ở ZenCloud (Let's Encrypt, hết hạn 23/01/2027 01:11 GMT); không liên quan VPS.
- DNS (Cloudflare `fay`/`ruben`): `tubutree.com` A `42.1.122.84` TTL 300, ☁ xám. `www.tubutree.com` ra IP Cloudflare (☁ cam) và Cloudflare tự 301 về apex. Nên www không chạm VPS khi còn ☁ cam; khối www trong vhost chỉ là dự phòng.
- `.env` VPS: `WEB_DOMAIN=tubutree.com`, `CORS_ORIGINS=https://app.tubutree.com`, **không đặt** `NEXT_PUBLIC_SITE_URL`. Đo: `sitemap.xml` ra `<loc>https://app.tubutree.com/`.
- Đĩa `/`: 48 GB, 63% (29 → 30 GB sau khi sao ảnh). Web Next ở `127.0.0.1:14000`, API ở `127.0.0.1:14001`. Node trên VPS là v20, bộ kiểm cần >= 22.18 nên script tự chạy bằng ảnh docker `tubutree-web` (Node 22.23.5); đã chạy thật.

## 4. Backup và đường dẫn

Thư mục `/opt/backups/tubutree-wp-precutover-20261114/` (root, 0700), 11 MB:

| Đường dẫn | Nội dung |
| --- | --- |
| `apache-vhosts/` | `cp -a` mọi vhost (`0.default`, `api`, `app`, `app...bak-zalo-...`, `phpmyadmin`, `extension/`), `httpd.conf.main`, `mod_remoteip.conf`, `configtest-baseline.txt` (`Syntax OK`), `vhost-map-baseline.txt` (`apachectl -S`) |
| `tls-refs/` | `renewal/*.conf` của certbot + `live-certs.txt` (chủ thể, hạn, vân tay, SAN). **Không sao khoá riêng** |
| `wp-public-export/` | `sitemaps/` (9 tệp), `rest/*.json` (posts 202, pages 108, product 91, product_cat 13, categories 13, tags 5, media 1371), `uploads-urls.txt` (3557 URL), `uploads.sha256` (3556 tệp), `MANIFEST.sha256` (16 tệp), `summary.json`, `uploads-missing.txt`, `uploads-failed.txt` (rỗng) |
| `tools/wp-public-export.mjs` | bản của script đã dùng |

Ảnh sao về `/www/wwwroot/tubutree.com/wp-content/uploads/` (đúng đường dẫn của URL): **3556 tệp, 1.1 GB**, 0 tệp rỗng, 0 tệp `.part`, mọi tệp đọc được.

Kiểm toàn vẹn (đã chạy): `MANIFEST.sha256 OK (16 files)`, `uploads.sha256 OK (3556 files)`, 7 tệp JSON đều `json.load` được và đếm khớp REST. Không có tệp `.gz` để `gzip -t` vì không có dump.

Một URL ảnh trả 404 ngay ở ZenCloud nên cũng 404 sau cutover: `/wp-content/uploads/2022/12/woocommerce-placeholder.png` (ảnh mặc định WooCommerce).

Cách tải: GET công khai, 3 luồng, nghỉ 120 ms giữa hai request, `--resolve-ip 42.1.122.84` (không qua DNS), `nice -n 10`. Lần chạy đầu bỏ sót 50 ảnh (URL chứa `&amp;description=` bị coi là đường dẫn, tên có dấu bị mã hoá hai lần). Đã sửa `scripts/ops/wp-public-export.mjs` và chạy lại: tải thêm 47 ảnh, bỏ qua 3509 ảnh đã có, 1 ảnh 404 ở nguồn, 0 lỗi.

## 5. Cutover MỘT lệnh và rollback tức thì

**Chưa chạy.** Chỉ chạy sau khi xong mục 6 và có "đồng ý một chạm" của anh Long.

Script nằm trong repo (`ops/`), lên VPS khi nhánh này merge và deploy (`/opt/tubutree/ops/`). Cần cả `ops/` lẫn `scripts/ops/`.

```bash
# 0. Kiểm điều kiện, KHÔNG đổi gì (thoát 0 = đủ điều kiện, 2 = thiếu, in rõ mục FAIL):
ssh -i ~/.ssh/chodeli_vietnix_vps root@14.225.207.177 'cd /opt/tubutree && bash ops/cutover-apex-apply.sh'

# 1. CÀI vhost apex (một lệnh): kiểm, cài, configtest, graceful, kiểm 459 URL qua Apache thật; hỏng bước nào thì TỰ rollback:
ssh -i ~/.ssh/chodeli_vietnix_vps root@14.225.207.177 'cd /opt/tubutree && bash ops/cutover-apex-apply.sh --apply'

# 2. (việc của chủ, Cloudflare) đổi A của tubutree.com về 14.225.207.177, ☁ xám. Sau đó từ máy ngoài:
bash ops/check-edge.sh --app-host tubutree.com
node scripts/ops/check-cutover-redirects.mjs --base https://tubutree.com --urls scripts/ops/data/wp-live-urls-20261114.txt --blog proxy

# ROLLBACK Apache (124–390 ms đo được; về đúng trạng thái trước khi cài):
ssh -i ~/.ssh/chodeli_vietnix_vps root@14.225.207.177 'cd /opt/tubutree && bash ops/cutover-apex-rollback.sh'
# Nếu ĐÃ đổi DNS: đổi A tubutree.com về 42.1.122.84 ở Cloudflare TRƯỚC (TTL 300 giây). Gỡ vhost không tự kéo khách về WordPress.
```

Hành vi (đã đo, mục 7):

- `apply` không `--apply` chỉ kiểm. Trước khi đụng Apache, 15 phép kiểm: root, vhost nguồn, danh sách URL, configtest sạch, backup khớp sha256, ảnh khớp sha256, đĩa < 80%, chứng chỉ (phủ hai tên, còn >= 14 ngày, khớp khoá), web trả 200, `sitemap.xml` ra `https://tubutree.com`, API nhận Origin `https://tubutree.com`, diễn tập Next 0 FAIL, origin ZenCloud trả 200.
- Cài: ghi tệp `0600` qua tệp tạm rồi `mv`, `apachectl -t`, rồi `apachectl -k graceful`. **Không `restart`** (Apache dùng chung với ChoDeli đang bán thật). Test tự động cấm `restart/stop/systemctl` và bắt `-t` đứng trước `-k graceful`.
- Sau cài: app và api giữ nguyên mã, 459 URL cộng mẫu 24 ảnh uploads qua HTTPS của vhost mới. Có FAIL thì gọi rollback, in lý do, lưu kết quả đầy đủ ở `$BACKUP_DIR/logs/`.
- `rollback` trả bản cũ nguyên byte nếu từng có vhost, hoặc gỡ tệp nếu trước đó chưa có; **từ chối xoá tệp lạ** nếu không có `--force`; không đụng ảnh uploads, DNS, ZenCloud.

## 6. Việc còn lại trước khi cutover thật (cần chủ)

Preflight thật trên VPS (chỉ đọc) in đúng 4 FAIL này:

1. **Chứng chỉ tubutree.com + www chưa có.** HTTP-01 không chạy được khi tubutree.com còn ở ZenCloud, phải DNS-01. Cần token Cloudflare quyền `Zone:DNS:Edit`, cài `python3-certbot-dns-cloudflare`, rồi `certbot certonly --dns-cloudflare ... -d tubutree.com -d www.tubutree.com --cert-name tubutree.com` (công thức đầy đủ ở đầu `ops/vietnix-vhost-apex.conf.cutover`).
2. **Deploy web.** Một lần build lại ảnh web làm hai việc: (a) bảng chuyển hướng mới của commit này (hết 9 FAIL ở Next thật), (b) đặt `NEXT_PUBLIC_SITE_URL=https://tubutree.com` trong `.env` VPS (biến build) để sitemap, canonical, OG ra apex. Theo dep1 → dep2 → dep3, cần chủ cho phép riêng.
3. **`CORS_ORIGINS` của API.** Prod chỉ có `https://app.tubutree.com`. Đo trực tiếp: `POST /api/auth/refresh` với `Origin: https://tubutree.com` và `x-client: web` trả **403** ("Yêu cầu không đến từ trang web Tubu Tree."); với `Origin: https://app.tubutree.com` qua được lớp chặn (400, thiếu thân). Preflight CORS thì apex vẫn được (regex `*.tubutree.com`), nhưng `cookieAuthOriginGuard` chỉ nhận origin trong `CORS_ORIGINS`: khách trên apex sẽ không đăng nhập, không làm mới được phiên. Cần đặt `CORS_ORIGINS=https://app.tubutree.com,https://tubutree.com` rồi tạo lại container api (API ngừng vài giây). Spec không nêu mục này; tôi tìm ra khi đọc `apps/api/src/common/cors.ts`.
4. **Đăng ký `https://tubutree.com/dang-nhap/callback` ở Zalo Developers** (giữ URI của app.tubutree.com). Script không kiểm được.

Ngoài 4 mục trên, chủ cần quyết:

- **Blog phụ thuộc ZenCloud.** 221 URL blog/ảnh/feed (199 bài `/YYYY/MM/DD/<slug>/`, `/category/`, `/tag/`, `/wp-json/`...) được reverse proxy về `42.1.122.84`. Tắt WordPress ở ZenCloud thì 221 URL đó trả 502. Chưa có kế hoạch cho blog sau khi tắt WordPress.
- **Không vào được quản trị WordPress qua tubutree.com.** `/wp-admin/`, `/wp-login.php`, `/xmlrpc.php` cố ý KHÔNG proxy (không phơi trang đăng nhập WordPress ra apex). Đo ở sandbox: `/wp-admin/` 308 rồi 404, `/wp-login.php` 404. Muốn sửa bài sau cutover phải vào WordPress bằng đường khác (IP hoặc tên tạm ở ZenCloud).
- Ảnh `/wp-content/uploads/` giờ phục vụ từ đĩa VPS (bản sao 14/11). Ảnh tải lên WordPress SAU 14/11 sẽ 404 trên VPS. Nếu còn đăng bài mới trước cutover, chạy lại `wp-public-export.mjs` (bỏ qua ảnh đã có, lặp lại an toàn).
- Các điểm mở của W137 vẫn nguyên: `/cart`, `/checkout` ra 307 theo luật Mini App, `/refill` sang `/doi-rac`, 31/55 trang đích hết hàng, ~10 ánh xạ phán đoán cần duyệt tay, 410 thêm ngoài brief.
- Sau khi apex chạy ổn: `app.tubutree.com` 301 sang apex (cuối `ops/vietnix-vhost-apex.conf.cutover`), giữ >= 12 tháng, làm sau khi Search Console đã nhận trang mới.

## 7. Bằng chứng đã chạy

Thay đổi trong repo (không động tới `packages/shared-types/src/product-copy-fallback*` hay `apps/api/src/modules/catalog/*`):

- `apps/web/src/lib/legacy-wp-redirects.ts`: thêm 301 về `/sitemap.xml` cho 8 sitemap con Rank Math (`post-sitemap1|2`, `page`, `product`, `category`, `blocks`, `featured_item`, `local`) và 410 cho `/locations.kml`. Trước đó 9 URL này trả 404 trên Next thật.
- `ops/vietnix-vhost-apex.conf.cutover`: khối ảnh WordPress phục vụ thẳng từ đĩa (`ProxyPass /wp-content/uploads/ !` + `Alias`, `-Indexes -ExecCGI`, `RemoveHandler`, chặn `.php/.phtml/.phar/...`, `nosniff`, cache 30 ngày), đứng TRƯỚC khối proxy blog. Khối proxy blog nay BẬT (trước là comment). Ghi đủ 5 điều kiện cài.
- `ops/cutover-apex-apply.sh`, `ops/cutover-apex-rollback.sh`, `scripts/ops/wp-public-export.mjs` (+ `.d.mts`), `scripts/ops/data/wp-live-urls-20261114.txt`; thêm `--host-header` cho `check-cutover-redirects.mjs`.
- 12 test mới trong `legacy-wp-redirects.spec.ts` (nay 73 test): thứ tự vhost, ràng buộc script, hàm thuần của bộ sao lưu, và **đi theo 238 URL không phải blog qua middleware thật** (0 FAIL). Thử đột biến 4 chỗ (bỏ luật sitemap, đảo thứ tự uploads, `apachectl restart`, graceful trước configtest): cả 4 đều bị test bắt. Lần đầu bản `restart` lọt vì regex phân biệt hoa thường (`$APACHECTL`); đã sửa regex rồi chạy lại.

Kiểm cuối (chạy thật, Node 22.23.3):

| Lệnh | Kết quả |
| --- | --- |
| `pnpm --filter @tubutree/web typecheck` | exit 0, 0 lỗi TS |
| `vitest run` (6 spec: legacy-wp-redirects, middleware, next-config-redirects, site, sitemap, sitemap-build) | 6 file, 160 test xanh |
| `next lint` trên 2 tệp web đã đổi | `No ESLint warnings or errors` |
| `pnpm lint:parity` | xanh (0 mục pending) |
| `pnpm lint:vars` | xanh |
| `check-cutover-redirects.mjs --base http://127.0.0.1:14000 --host-header tubutree.com` (Next thật qua tunnel, bản dựng cũ) | 229 PASS, 0 WARN, **9 FAIL** (đúng 9 URL ở mục 1), 215 SKIP (blog; chạy lúc danh sách còn 453, nay 221 blog trên 459, 6 URL thêm là blog nên chỉ đổi số SKIP) |

Diễn tập Apache (VPS, một tiến trình Apache thứ hai chạy binary và `httpd.conf` của aaPanel, cổng 18080/18443, chứng chỉ tự ký, thư mục vhost riêng; **không đụng `/www/server/panel/vhost/apache/`**, danh sách tệp ở đó trước và sau giống hệt):

- Lần A, danh sách URL đủ, Next bản cũ: `apply --apply` **từ chối cài** (thoát 2, "Chưa đổi gì") vì diễn tập Next có 9 FAIL.
- Lần B, danh sách bỏ 9 URL chờ deploy: cài, configtest sạch, graceful, app=200 api=200 giữ nguyên, **468/468 PASS** qua Apache (blog proxy về ZenCloud 200, mẫu ảnh uploads 200, 301/410 đúng), thoát 0.
- Với vhost đã cài, thử riêng phần ảnh: tệp trả đúng byte của đĩa, `Server: Apache`, không có `x-origin: zencloud`, `cache-control: public, max-age=2592000`, `x-content-type-options: nosniff`; ảnh tên có dấu (`dao%C2%A7u-1.png`) 200; tệp thiếu 404 của Apache (không rơi xuống Next hay ZenCloud); `.php` đặt thử trong uploads trả 403 (đã xoá ngay); liệt kê thư mục 403; `../` và `%2e%2e` 404; `www` 301 về apex giữ query; `http` 301 về `https`.
- Rollback: gỡ vhost đúng (124, 164, 152, 390 ms theo từng lần chạy), cổng 18443 ngừng phục vụ, app/api vẫn 200. Chạy lần hai khi không còn gì để gỡ vẫn thoát 0. Tệp lạ trùng tên bị **từ chối xoá** (thoát 1). Cài lần hai rồi rollback lại sạch.
- Lỗi tìm ra nhờ diễn tập và đã sửa: thư mục tạm `mktemp` 0700 làm container docker không đọc được danh sách URL, và bộ kiểm im lặng nuốt lỗi stderr. Sửa: `chmod 755`, thu stderr, bắt buộc có dòng tổng kết ở cuối stdout, lỗi in rõ.
- 215 FAIL "chuyển sang origin khác" ở lần chạy sandbox đầu là do sandbox gửi `Host: tubutree.com:18443`; ZenCloud canonical-redirect khi Host có cổng lạ. Đo: Host `tubutree.com` → 200, `tubutree.com:18443` → 301. Sandbox ép `RequestHeader set Host tubutree.com`; vhost thật không cần.

Preflight THẬT trên VPS (`bash ops/cutover-apex-apply.sh`, không `--apply`, đường dẫn mặc định thật): 9 mục PASS, 4 FAIL (chứng chỉ, SITE_URL, CORS 403, Next chưa qua 9 URL), thoát 2, "Chưa đổi gì trên máy".

Dọn dẹp (đã xác nhận): dừng Apache sandbox, xoá mọi tệp tạm `/tmp/w148b-*` trên VPS và ở máy local, đóng tunnel SSH. Cổng 80/443 thật vẫn nghe, `apachectl -t` `Syntax OK`, app=200 api=200. Backup ở mục 4 và 3556 ảnh được giữ nguyên.

## 8. Giới hạn của bằng chứng này

- Chưa chạy `--apply` thật, nên chưa thấy vhost thật nạp cạnh vhost ChoDeli. Diễn tập dùng cùng binary và cùng `httpd.conf` (đã bỏ cổng 80/443, ServerLimit, thư mục vhost), không cùng tiến trình.
- 9 URL sitemap/KML chỉ được chứng minh bằng test qua middleware thật và bằng bộ kiểm chạy trên bản Next cũ (đang FAIL đúng như dự báo); chưa qua bản web đã deploy. Chưa chạy `next build` hay Playwright e2e cho thay đổi này.
- Chưa thử TLS với chứng chỉ thật, chưa thử qua Cloudflare ☁ cam, chưa chạy `check-edge.sh --app-host tubutree.com` (cần DNS đã đổi).
- Chưa có review Opus cho commit này.
