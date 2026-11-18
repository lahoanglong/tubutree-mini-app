# MSS đẩy nội dung và tồn kho sang Tubu (`POST /api/integrations/mss/catalog-sync`)

Kiến trúc A3: Pancake → MSS (trung tâm) → Tubu. MSS soi gương Pancake và làm giàu nội dung; khi có thay đổi, MSS **đẩy** thẳng sang Tubu
thay vì chỉ rung chuông (`catalog-changed`) rồi chờ Tubu kéo. Bổ sung cho hợp đồng thương mại v0.9 (`mss-tubu-commerce-api.md`, mục 1.2
và 1.3); lượt kéo 30 phút, chuông và lượt kéo toàn bộ ban đêm vẫn chạy như cũ, nên mất một lần đẩy không làm lệch dữ liệu lâu.

Phía Tubu: wave `tubu-w3-07-mss-two-way-catalog-and-stock-live-sync` (18/11/2026). Mã ở `apps/api/src/modules/integrations/mss-catalog-sync/`.

## 1. Đường dẫn và xác thực

```
POST {TUBU_API}/api/integrations/mss/catalog-sync
POST {TUBU_API}/api/internal/mss/catalog-sync      (cùng xử lý; chỉ dùng trong mạng nội bộ)
```

- Đường chính là `/api/integrations/mss/catalog-sync`. Biên (Caddy, Apache) chặn mọi `/api/internal/*` từ Internet và trả 404, nên
  `/api/internal/mss/catalog-sync` chỉ tới được khi MSS gọi thẳng cổng API trong cùng mạng.
- Ký như mọi route MSS → Tubu (v1): header `X-Mss-Key-Id`, `X-Mss-Timestamp` (giây Unix), `X-Mss-Signature: v1=<hex>`, chữ ký
  HMAC-SHA256 trên chuỗi `<timestamp>.` nối với **đúng byte thân gửi đi**, bí mật `MSS_INBOUND_SECRET` (nhận cả `MSS_INBOUND_SECRET_PREV`
  khi xoay khoá), lệch giờ tối đa ±300 giây. Sai chữ ký hoặc quá giờ: `401`.
- `Content-Type: application/json`. Có thể nén gzip. Thân tối đa **1 MB sau giải nén** (các route MSS khác 64 KB); quá thì `413`.
- Không giới hạn tần suất phía Tubu (route bỏ qua bộ throttle), nhưng MSS nên gộp: tối đa một lần đẩy mỗi giây, gộp các dòng tồn trong
  khoảng đó vào một lô.

## 2. Thân yêu cầu

```json
{
  "sync_id": "cs_01JD8Y6Q7Z3K2M",
  "sent_at": "2026-11-18T16:00:00+07:00",
  "products": [ /* tài liệu sản phẩm đúng dạng mục 1.2 của hợp đồng v0.9, tối đa 20 */ ],
  "stock": [
    { "pancake_variation_id": "v1", "stock": 0, "as_of": "2026-11-18T15:59:58+07:00" }
  ],
  "bundles": [ /* định nghĩa combo: bản này Tubu chỉ đếm, chưa áp */ ]
}
```

| Trường | Bắt buộc | Luật |
|---|---|---|
| `sync_id` | có | `^[A-Za-z0-9_-]{8,64}$`. Mã của lần đẩy; gửi lại cùng lô thì giữ nguyên mã. Tubu ghi vào thẻ Ops và trả lại, không dùng để chặn trùng (xem mục 4). |
| `sent_at` | không | ISO 8601 có múi giờ. Chỉ để ghi nhận. |
| `products` | không | Mảng tài liệu sản phẩm, tối đa **20**. Vượt: `400 too_many_products`. |
| `stock` | không | Mảng dòng tồn, tối đa **200**. Vượt: `400 too_many_stock`. |
| `bundles` | không | Mảng bất kỳ. Tubu chỉ đếm (`deferred.bundles`). |

Phải có ít nhất một trong `products`, `stock`, `bundles` khác rỗng, nếu không: `400 empty`. Vỏ sai kiểu (thiếu `sync_id`, `products`
không phải mảng, `sent_at` sai dạng…): `400 invalid_body`. Khoá lạ được bỏ qua (thêm trường là thay đổi tương thích).

### 2.1. Dòng tồn

- `pancake_variation_id`: `^[A-Za-z0-9_-]{1,64}$`, khớp `variations.pancakeId` của Tubu.
- `stock`: số nguyên **tuyệt đối** Pancake báo (`remain_quantity`), `0 ≤ stock ≤ 2.000.000.000`. Không gửi số cộng/trừ.
- `as_of`: lúc MSS **đọc** số này từ Pancake (giờ máy chủ MSS, ISO 8601 có múi giờ). Đây là mốc quyết định thứ tự, không phải lúc gửi.
- Dòng sai dạng (thiếu mã, số âm, số lẻ, giờ hỏng) bị bỏ riêng dòng đó và đếm `stock.invalid`; các dòng khác vẫn áp.
- Một biến thể có nhiều dòng trong cùng lô: Tubu giữ dòng có `as_of` muộn nhất.

### 2.2. Tài liệu sản phẩm: hai trường mới trong `enrichment`

Tài liệu đi đúng bộ đọc của lượt kéo (mục 1.2), nên mọi luật cũ giữ nguyên: `null` = không có ý kiến, `[]` = cố ý để trống, ảnh/video
phải nằm dưới `{MSS_BASE_URL}/api/pub/media/`, `source` (giá, tồn) KHÔNG được đọc từ tài liệu, `seo.slug` không đổi đường dẫn sản phẩm
của Tubu (đổi slug làm gãy link đã chia sẻ), `seo.meta_title`/`seo.meta_desc` được ghép như cũ. Hai trường mới, đều tuỳ chọn:

**`enrichment.story_config`**: câu chuyện xanh trên trang sản phẩm, đúng khung `ProductStoryConfig` của Tubu
(`packages/shared-types/src/product-story.ts`, `version: 1`, tối đa 16 KB):

```json
{
  "version": 1,
  "enabled": true,
  "cutoutUrl": "https://mkt.chodeli.com/api/pub/media/3c0f…a1.webp",
  "scenes": [
    { "kind": "variant_arc", "items": [{ "variationId": "v1", "label": "2L", "ambient": "leaf" }] },
    { "kind": "ingredient_assembly", "steps": [{ "title": "Bồ hòn", "body": "…", "layers": [
      { "id": "l1", "label": "Bồ hòn", "from": "top", "xPct": 50, "yPct": 40, "scale": 1, "rotateDeg": 0,
        "imageUrl": "https://mkt.chodeli.com/api/pub/media/9e…b2.webp" } ] }] },
    { "kind": "hud_callouts", "points": [{ "id": "p1", "xPct": 30, "yPct": 60, "label": "Enzyme dứa", "side": "left" }], "closing": "…" }
  ]
}
```

- `variant_arc.items[].variationId` là **`pancake_variation_id`**; Tubu đổi sang id biến thể của mình lúc ghép, mã chưa có ở Tubu thì bỏ
  riêng `variationId` (mục vẫn hiện, chỉ không chọn được biến thể).
- `cutoutUrl` và `layers[].imageUrl` phải là media MSS như ảnh sản phẩm. Sai khung, hay một ảnh ngoài host: Tubu bỏ **cả câu chuyện** (giữ
  câu chuyện Tubu đang có) và đếm `trimmed.story_rejected`; phần còn lại của tài liệu vẫn được ghép.

**`enrichment.eco_facts`**: nhãn xanh MSS đề xuất (tối đa 10, dư thì cắt và đếm `trimmed.array_truncated`):

```json
[
  { "kind": "PLASTIC_AVOIDED", "variation_id": null, "value_grams": 38, "baseline_text": "so với chai nhựa 2L mới",
    "label": "Bớt 38 g nhựa", "co2_grams": null, "source_url": "https://…/bao-cao.pdf", "source_note": "Cân vỏ túi refill" }
]
```

- `kind`: `REFILL_PACK` | `PLASTIC_AVOIDED` | `RETURNABLE_PACKAGING` | `CERTIFICATION` | `INGREDIENT_ORIGIN`. `value_grams` chỉ cho
  `PLASTIC_AVOIDED`. `variation_id` là `pancake_variation_id` hoặc `null` (cả sản phẩm). `source_url` bắt buộc, phải `https`.
- Kiểm bằng đúng luật nhập của màn Sự thật xanh. Dòng sai luật bị bỏ và đếm `trimmed.eco_fact_rejected`. Mục không phải object, hoặc
  `variation_id` sai dạng: cả tài liệu sai lược đồ (`skipped.invalid_doc`).
- **Không bao giờ hiện thẳng cho khách.** Với tài liệu `published` vừa được ghi, Tubu tạo dòng **NHÁP** trong `product_eco_facts` cho mỗi
  (loại, biến thể) mà sản phẩm **chưa có dòng nào cùng loại ở bất kỳ trạng thái nào**; admin xem nguồn rồi duyệt ở màn Sự thật xanh.
  Dòng đã có (Tubu nhập, đã duyệt, đã ngừng dùng, hay nháp MSS trước) thuộc về Tubu và không bị MSS sửa; đếm `eco_kept`. Biến thể chưa có
  ở Tubu cũng đếm `eco_kept` (không gắn nhầm lên cả sản phẩm).

## 3. Trả lời

`200` khi thân hợp lệ, kể cả khi cờ tắt (để MSS không gửi lại mãi):

```json
{
  "ok": true,
  "sync_id": "cs_01JD8Y6Q7Z3K2M",
  "products": { "status": "applied", "received": 1, "applied": 1, "unchanged": 0, "skipped": {}, "trimmed": {}, "eco_proposed": 1, "eco_kept": 0 },
  "stock": { "status": "applied", "received": 3, "applied": 2, "invalid": 0, "skipped": { "stale": 1 },
             "out_of_stock": 1, "back_in_stock": 1, "restock_waiting": 4 },
  "deferred": { "bundles": 0 }
}
```

- `status` từng phần: `applied` (đã xử lý), `disabled` (cờ chưa có hiệu lực, **không ghi gì**), `none` (lô không có phần này).
- `products.skipped`: `invalid_doc`, `no_pancake_id`, `unknown_product` (Tubu chưa có sản phẩm), `stale_version` (cũ hơn bản đã có),
  `apply_failed`. `products.trimmed`: `media_rejected`, `html_emptied`, `string_truncated`, `array_truncated`, `story_rejected`,
  `eco_fact_rejected`, `unknown_category_slug`.
- `stock.skipped`: `unknown_variation` (Tubu chưa có biến thể), `stale` (đọc trước số Tubu đã có, xem mục 4), `too_old` (`as_of` cũ hơn
  60 phút), `clock_skew` (`as_of` vượt giờ Tubu quá 5 phút: đồng hồ MSS sai).
- `out_of_stock` / `back_in_stock`: số biến thể vừa đổi trạng thái do lô này. `restock_waiting`: số đăng ký "Báo tôi khi có hàng" đang
  chờ trên các biến thể vừa về hàng.
- Lỗi DB giữa chừng: `5xx`. MSS gửi lại nguyên lô (an toàn, mục 4).

## 4. Lặp lại, thứ tự, chạy chồng

Tubu không lưu biên nhận theo `sync_id`; an toàn nhờ điều kiện trên chính dữ liệu:

- **Tồn**: mỗi dòng đi đúng đường áp tồn của lượt đồng bộ Pancake của Tubu (`applyPancakeStock`, kiểu `sync`, mốc đọc = `as_of`, kẹp về
  giờ nhận nếu `as_of` muộn hơn vài giây). Điều kiện so mốc nằm trong cùng câu `UPDATE`:
  - số MSS đọc **trước** lượt đồng bộ Pancake hay webhook Pancake mà Tubu đã áp thì bị bỏ (`stale`): tồn không lùi;
  - số MSS đọc **sau** thì thắng, dù lô đến muộn hay xử lý song song (đã kiểm 12 lần đẩy song song lệch thứ tự trên Postgres thật);
  - gửi lại cùng dòng (cùng số, cùng `as_of`) ghi lại đúng giá trị cũ, không báo hết/về hàng lần hai;
  - giữ chỗ của đơn Tubu chưa lên Pancake vẫn được trừ như lượt đồng bộ (`stock = số Pancake − giữ chỗ còn lại`);
  - biến thể Tubu chưa từng có số Pancake (`pancakeStock` null): lần đầu chỉ ghi mốc, không đổi tồn (như lượt đồng bộ đầu tiên).
- **Nội dung**: cùng điều kiện "bản mới hơn" của lượt kéo (`published_version`, `updated_at`), cùng câu upsert; tài liệu đã nhận qua lượt
  kéo hay lần đẩy trước thì đếm `unchanged`.
- Phát lại chữ ký v1 trong 300 giây chỉ gửi lại được đúng lô đó, và lô cũ không ghi đè lô mới nhờ mốc `as_of`/phiên bản.

## 5. Hết hàng và về hàng

- Tồn về `0`: cột `variations.stock` đổi ngay trong lần gọi. Trang sản phẩm web hỏi lại tồn thật mỗi lần mở trang (không dùng bản ISR),
  Mini App đọc thẳng API, giỏ và thanh toán kiểm tồn lúc đặt; nên nút **"Báo tôi khi có hàng"** hiện ngay khi cờ
  `catalog.restock_alert_enabled` bật. Bộ nhớ đệm danh sách (thứ tự `?category=`, 60 giây) và khối tĩnh Trang chủ (20 giây) được xoá khi có
  biến thể đổi trạng thái; trang danh sách ISR của web có thể còn bản cũ tới 5 phút (chỉ ảnh hưởng nhãn trên thẻ, không cho mua hàng đã hết).
- `0 → >0` mà còn khách chờ: Tubu gọi sớm lượt báo hàng về (không đợi cron mỗi phút), cùng khoá `restock-alerts` và cùng ngân sách 100
  tin/phút với cron, nên không chạy chồng, không vượt giãn tin, mỗi đăng ký đúng một tin, và luật một đợt/24 giờ giữ nguyên. Lượt sớm lỗi
  thì cron phút sau gửi bù.

## 6. Cờ (mặc định TẮT, bật ở Cấu hình hệ thống)

| Phần | Cờ | Có hiệu lực khi |
|---|---|---|
| `products` | `mss.catalog_enrichment_enabled` | cờ bật + đủ biến `MSS_*` + MSS công bố năng lực `catalog.enrichment` |
| `stock` | `mss.stock_sync_enabled` (mới) | cờ bật + đủ biến `MSS_*` + MSS công bố năng lực `catalog.source` (MSS chỉ công bố khi gương Pancake bật) |

Đồng bộ Pancake 15 phút và webhook Pancake của Tubu vẫn chạy song song khi bật `mss.stock_sync_enabled`; tắt cờ là đường lui (Tubu bỏ qua
phần tồn MSS gửi, `stock.status = "disabled"`).

Thẻ Ops: Sức khoẻ hệ thống → "Nội dung từ MSS" hiện trạng thái cờ tồn và lần đẩy gần nhất (giờ, số áp, hết/về hàng, khách chờ, lý do bỏ,
combo chưa áp, lỗi). Thẻ "Kết nối MSS" có thêm dòng cờ "Tồn kho MSS đẩy sang".

## 7. Chưa làm ở bản này

- **Combo (`bundles`)**: chỉ đếm. Combo chạm giá bán và tồn ghép (đường tiền), cần hợp đồng giá riêng và review riêng.
- **`seo.slug`**: không đổi slug sản phẩm Tubu.
- Bộ đệm theo từng tiến trình: chạy nhiều bản API thì chỉ bản nhận lời gọi xoá bộ đệm; các bản khác tự hết hạn sau 20–60 giây.
