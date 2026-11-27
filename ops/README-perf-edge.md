# Biên HTTP của Tubu Tree: nén, cache, HTTP/2

Đo ngày 28/11/2026 bằng GET chỉ đọc từ ngoài vào (không SSH, không đổi gì trên VPS). Chạy lại phần "hiện trạng" bằng
`bash ops/check-edge.sh` và các lệnh `curl` ở cuối tệp.

## Hiện trạng

| Hạng mục | api.tubutree.com | app.tubutree.com |
|---|---|---|
| HTTP/2 | có (`curl --http2` ra `2`) | có |
| Nén | gzip do Apache `mod_deflate` (ETag có hậu tố `-gzip`), chưa có brotli | gzip do chính Next (`compress` mặc định bật), Apache bỏ qua vì phản hồi đã có Content-Encoding |
| `/_next/static/*` | | `public, max-age=31536000, immutable` (Next tự đặt) |
| `/api/img?w=…&u=…` | `public, max-age=31536000, immutable`, `Vary: Accept`, trả AVIF khi trình duyệt nhận, ~25 ms | |
| GET công khai | theo preset `PublicCache` (`apps/api/src/common/decorators/public-cache.decorator.ts`): `/api/home` `max-age=5, s-maxage=10`, `/api/products` `max-age=15, s-maxage=30`, `/api/categories` và `/api/config/public` `max-age=60, s-maxage=300` | HTML `private, no-cache` |
| CDN | không có (Cloudflare chỉ DNS), nên `s-maxage` hiện không có cache chung nào dùng tới | như bên trái |

Đã đúng, không đổi: HTTP/2, `immutable` cho `/_next/static` và `/api/img`, `s-maxage` ngắn cho GET công khai.

## Brotli: lợi ích đo được

Nén lại chính body lấy từ PROD (Node zlib, gzip level 6 như `mod_deflate` mặc định, brotli quality 5 như khối trong vhost):

| Body | Gốc | gzip 6 | br 5 | br 11 (nén sẵn) |
|---|---|---|---|---|
| HTML trang chủ web | 174.365 B | 26.325 B | 21.689 B (nhỏ hơn 18%) | 19.350 B (26%) |
| RSC trang chủ (`RSC: 1`) | 46.924 B | 10.923 B | 10.231 B (6%) | 9.247 B (15%) |
| JSON `/api/home` | 27.340 B | 5.230 B | 4.880 B (7%) | 4.442 B (15%) |
| JSON `/api/products?limit=20` | 10.969 B | 2.267 B | 2.064 B (9%) | 1.950 B (14%) |
| CSS trang chủ | 60.809 B | 11.301 B | 10.966 B (3%) | 10.005 B (11%) |
| 43 tệp JS của trang chủ | 1.177.841 B | 395.665 B | 375.359 B (5%) | 345.863 B (13%) |

Thời gian nén mỗi body dưới 1,1 ms với cả hai cách.

## Bước A: brotli cho API (đã sửa trong repo, CHƯA áp lên VPS)

`ops/vietnix-vhost-api.conf.phase2` có thêm khối `mod_brotli` đứng TRƯỚC khối `DEFLATE`, bọc trong `<IfModule>`: Apache thiếu
mod_brotli thì khối bị bỏ qua và phản hồi vẫn gzip như cũ. Đã thử trên Apache 2.4.71 thật (container `httpd:2.4`, vhost proxy giống
PROD, bản sao `/api/home`):

- `httpd -t`: `Syntax OK`
- `Accept-Encoding: br, gzip` → `br`, 4.880 B; `gzip` → `gzip`, 5.223 B; không gửi → không nén, 27.340 B
- Giải nén bản br trùng từng byte với bản gốc
- Đảo thứ tự (DEFLATE trước) thì trình duyệt luôn nhận gzip: thứ tự trong vhost là bắt buộc

Áp dụng (wave release, trên VPS bằng root; Apache dùng chung với ChoDeli và WordPress nên `configtest` phải qua trước `graceful`):

```bash
# 1. Apache có mod_brotli chưa? Không thấy brotli_module thì dừng ở đây: khối mới vô hại nhưng không có tác dụng.
/www/server/apache/bin/apachectl -M 2>/dev/null | grep -E 'brotli|deflate|filter'

# 2. Sao lưu vhost đang chạy, dán bản mới (cùng cách dán phase2 ở ops/README-vietnix-deploy.md, chạy trong thư mục repo đã có
#    commit này), kiểm cú pháp rồi mới nạp lại.
cp /www/server/panel/vhost/apache/api.tubutree.com.conf /root/api.tubutree.com.conf.bak-$(date +%Y%m%d%H%M)
cp ops/vietnix-vhost-api.conf.phase2 /www/server/panel/vhost/apache/api.tubutree.com.conf
/www/server/apache/bin/apachectl configtest && /www/server/apache/bin/apachectl -k graceful

# 3. Kiểm từ máy bất kỳ: phải thấy `content-encoding: br`, và gzip khi chỉ gửi gzip.
curl -s -o /dev/null -D - -H 'Accept-Encoding: br, gzip' https://api.tubutree.com/api/home | grep -i content-encoding
curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip' https://api.tubutree.com/api/home | grep -i content-encoding
bash ops/check-edge.sh
```

Quay lại: chép bản `.bak-*` vào `/www/server/panel/vhost/apache/api.tubutree.com.conf`, rồi
`/www/server/apache/bin/apachectl configtest && /www/server/apache/bin/apachectl -k graceful`.

Nếu bước 1 không thấy `brotli_module` nhưng có tệp `/www/server/apache/modules/mod_brotli.so`, việc nạp module là sửa cấu hình
Apache dùng chung (`httpd.conf`), ảnh hưởng cả ChoDeli và WordPress: chỉ làm khi chủ duyệt riêng.

## Bước B: brotli cho web (CHƯA làm, cần quyết định riêng)

Next tự nén gzip nên Apache không nén lại. Muốn có br cho HTML, RSC và JS (lợi 18% HTML, 6% RSC, 5% JS ở quality 5) thì phải:

1. Đặt `compress: false` trong `apps/web/next.config.*` (đổi ảnh web, cần release).
2. Thêm khối brotli và gzip giống bước A vào `ops/vietnix-vhost-app.conf.phase2`, kèm thêm `text/x-component` (RSC) vào cả hai danh sách.

Phải làm cả hai cùng một lần: chỉ làm bước 1 mà vhost chưa có `text/x-component` thì RSC đi ra không nén. Apache sẽ nén lại JS mỗi
lần tải (JS có `immutable` nên chủ yếu là lượt đầu). Wave này không làm vì lợi cho JS nhỏ, còn rủi ro nằm ở ảnh web.

## `stale-while-revalidate`: để sau khi có CDN

Hiện không có cache chung (không CDN, Apache không cache), nên thêm `stale-while-revalidate` vào preset chỉ tác động tới cache
trình duyệt: khách có thể thấy dữ liệu cũ thêm một khoảng. Với `LIVE` (flash sale, tồn kho) thì đó là đổi hành vi. Khi bật proxy
Cloudflare (☁ cam), đề xuất thêm vào preset, PO duyệt từng mức:

- `STATIC`: `stale-while-revalidate=600`
- `CATALOG`: `stale-while-revalidate=60`
- `USER_CONTENT`: `stale-while-revalidate=120`
- `LIVE`: không thêm

## Lệnh đo lại hiện trạng

```bash
H() { curl -sS --http2 -o /dev/null -D - -w '%{http_version}\n' -H 'Accept-Encoding: br, gzip' "$1" | grep -iE '^(content-encoding|cache-control|vary):|^[0-9.]+$'; }
H https://api.tubutree.com/api/home
H 'https://api.tubutree.com/api/products?page=1&limit=20'
H "https://app.tubutree.com$(curl -s --compressed https://app.tubutree.com/ | grep -oE '/_next/static/css/[^"]+\.css' | head -1)"
H 'https://api.tubutree.com/api/img?w=320&u=https%3A%2F%2Fcontent.pancake.vn%2F2-2608%2F2026%2F8%2F14%2Fc60882ee6ac652dc490895bc66e328d08eebaf68.png'
```
