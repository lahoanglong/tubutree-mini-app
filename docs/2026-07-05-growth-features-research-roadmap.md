# Nghiên cứu chức năng tăng trưởng & Roadmap "mini app đột phá"

> Ngày: 2026-07-05 · Tác giả: nghiên cứu do Claude tổng hợp
> Nguồn: deep-research workflow (fan-out web search + adversarial verify) + inventory codebase Tubu Tree v2.
> **Chú thích độ tin cậy nguồn:** ✅ *đã kiểm chứng 3/3 phiếu* · ⚠️ *chưa kiểm chứng* (agent verify hết hạn phiên, chỉ từ 1 lượt search) · 🧠 *kiến thức nền / suy luận*.

---

## 0. Tóm tắt điều hành (đọc cái này trước)

App hiện tại **đã rất sâu** — bạn đã ship gần hết bộ retention kiểu Shopee (điểm/hạng/xu/voucher/gamification/group-buy/subscription) và gần hết bộ công cụ CTV kiểu Dropii/Selly (storefront builder, hoa hồng, payout, đại lý B2B). Vì vậy phần lớn "việc phải làm thêm" **không phải làm lại**, mà là **3 mảnh còn thiếu tạo khác biệt**:

1. **🎯 Trụ cột mới — Cashback → Gây quỹ CLB sinh viên (mô hình WeShare/FlipGive).** Đây là **wedge độc nhất** kéo traffic từ nhóm không quan tâm sản phẩm thiên nhiên. Bạn đã có hạ tầng cashback (Accesstrade → Ví); còn thiếu **lớp "Quỹ/CLB/Chiến dịch"**. Mô hình đã được chứng minh quy mô: FlipGive xử lý **$425M+ doanh số → $50M+ quỹ cho 50.000+ chương trình**. ✅
2. **📹 Live commerce + video ngắn** — kênh chuyển đổi & traffic lớn nhất đang thiếu hoàn toàn.
3. **🧰 Bộ "content kit" cho CTV + lên đơn hộ + đào tạo** — 3 khoảng trống lớn nhất so với Dropii/Selly.

**Flywheel chiến lược** (khớp đúng tư duy 3 nhóm của bạn):

```
Nhóm 3 (sinh viên, không quan tâm SP)
   → vào app vì GÂY QUỸ CLB (mua gì cũng có, hoàn tiền vào quỹ)
      → tiếp xúc sản phẩm thiên nhiên + nội dung cộng đồng
         → Nhóm 1 (người mua): mua cho bản thân, gắn bó nhờ loyalty/game
            → Nhóm 2 (CTV): người mua hài lòng → bán lại → thu nhập
               → CTV kéo thêm người mua & sinh viên mới ↺
```

Mỗi nhóm là một tầng của cùng một phễu, không phải 3 sản phẩm rời. Roadmap ở §5 sắp xếp theo phễu này.

---

## 1. NHÓM 1 — Giữ chân NGƯỜI MUA (tham chiếu Shopee)

### 1.1 Cơ chế Shopee dùng để giữ chân & mức độ bạn đã có

| Cơ chế | Shopee làm gì | Tác động | Tubu đã có? |
|---|---|---|---|
| **Coins/Xu** | Xu thưởng theo đơn, tiêu để giảm giá | Tạo "chi phí chuyển đổi", quay lại tiêu xu | ✅ **TubuXu** + `CoinTransaction` + điểm `PointsTransaction` |
| **Hạng thành viên** | Bạc/Vàng/Bạch kim, quyền lợi tăng dần | Giữ chân top-spender | ✅ `MembershipTier` + cron recalc + ân hạn rớt hạng |
| **Voucher tự động** | Welcome/sinh nhật/win-back | Kéo lại người ngủ | ✅ cron phát welcome/birthday/win-back/milestone |
| **Flash sale / đếm ngược** | Deal giờ vàng | FOMO, tạo thói quen mở app | ⚠️ có component `flash-sale.tsx` nhưng **cần xác minh engine backend** (lịch, tồn kho giới hạn, giá theo khung giờ) |
| **Gamification** | Shopee Farm/trồng cây, lắc xu, capybara ⚠️ | Retention hằng ngày | ✅ **Vườn Xanh** (điểm danh, tưới, thu hoạch → trồng cây thật, mùa/BXH, quiz, spin, missions, tặng nước social) — **sâu hơn Shopee** |
| **Review có ảnh/video + thưởng** | Cộng xu khi đánh giá | UGC + niềm tin | ✅ `Review` (rating/ảnh/video + cộng điểm) |
| **Mua định kỳ / nhắc mua lại** | — | Doanh thu lặp | ✅ `Subscription` (4/6/8/10 tuần) + `ReorderReminder` |
| **Group buy / mua chung** | — | Lan truyền + giá tốt | ✅ `GroupBuy` + phát coupon nhóm |
| **Ví / thanh toán liền mạch** | ShopeePay | Giảm ma sát | ✅ Ví VND + ZaloPay + VietQR + COD + XU |
| **Live commerce / video ngắn** | Shopee Live/Video | **Kênh chuyển đổi & traffic hàng đầu tại VN** (số liệu 12.12 cụ thể ❌ bị bác, nhưng cơ chế live/video là chủ lực 🧠) | ❌ **THIẾU HOÀN TOÀN** |
| **Chat/CSKH trong app** | Shopee Chat | Chốt đơn, giữ niềm tin, xử lý sự cố | ❌ **THIẾU** (không thấy module chat) |
| **Feed "For You" cá nhân hoá** | Gợi ý theo hành vi | Tăng thời lượng, khám phá | ⚠️ chỉ có `ai-advisor` nhẹ; **chưa có home feed cá nhân hoá** |
| **Free-ship / voucher ship** | Gói freeship | Lý do #1 chốt đơn ở VN | ⚠️ có coupon chung; **chưa có gói freeship có cấu trúc** |

### 1.2 Khoảng trống ưu tiên cho Nhóm 1

- **❌ Live commerce + video ngắn** (xem §5 Pha 2) — kênh mở app hằng ngày mạnh nhất còn thiếu.
- **❌ Chat/CSKH trong app** — hiện khách phải rời app (Zalo OA) để hỏi; mất context đơn hàng.
- **⚠️ Flash sale engine thực thụ** — nếu component chưa nối backend, cần lịch + kho giới hạn + giá khung giờ + đẩy thông báo.
- **⚠️ Feed cá nhân hoá "Dành cho bạn"** — tận dụng dữ liệu hành vi + AI advisor đã có.
- **⚠️ Gói freeship / ngưỡng miễn phí ship** — đòn bẩy chuyển đổi rất mạnh ở VN.

---

## 2. NHÓM 2 — Giữ chân CTV / ĐẠI LÝ (tham chiếu Dropii, Selly)

### 2.1 Mô hình Dropii & Selly (những gì họ làm để giữ chân người bán)

**Dropii (Droppii)** ⚠️ *chưa kiểm chứng — nguồn salekit.net, 1 lượt search:*
- **4 loại hoa hồng**: bán lẻ, hoa hồng nhóm/team, hoa hồng đào tạo, thưởng năm.
- **Bậc hạng** (CTV → Đối tác → Coach C1S/C2S/C3S) với hoa hồng team đa cấp (6%/9%/12%) + 6% đào tạo. ⚠️ *Cấu trúc kiểu MLM — xem cảnh báo pháp lý §2.3.*
- **Dropshipping**: không vốn/không kho, NCC giao hàng.
- **Đào tạo miễn phí** (Droppii Academy) + kho **content marketing dựng sẵn**.

**Selly** ⚠️ *chưa kiểm chứng — nguồn vir.com.vn / thitruongsi.com:*
- **"3 không"**: không vốn, không ôm hàng, không lo giao vận.
- Reseller lấy SP từ catalog Selly, chia sẻ ra mạng xã hội; Selly lo giao hàng + hậu mãi.
- Ăn hoa hồng khi **đơn giao thành công**; có kho **nội dung/hình ảnh sẵn để share**.

### 2.2 Đối chiếu với Tubu

| Năng lực CTV | Ý nghĩa | Tubu đã có? |
|---|---|---|
| **Đăng ký + dashboard hoa hồng** | Minh bạch thu nhập | ✅ `affiliate` (dashboard, commissions, analytics theo SP/gian hàng) |
| **Link rút gọn + attribution** | Gắn công đơn hàng | ✅ `AffiliateLink` + `ReferralTouch` (~3 ngày) |
| **Gian hàng cá nhân** | "Shop" riêng của CTV | ✅ `storefront-builder` (collections/combo/publish → `/s/:slug`) |
| **Payout gọn gàng** | Rút tiền nhanh | ✅ `Payout` + cron LOCKED→APPROVED |
| **Đại lý B2B** (nhập hàng) | Bậc giá, công nợ, đặt lại | ✅ `dealer` (tier, `DealerCreditLedger`, `DealerOrderTemplate`, thưởng quý) |
| **Nhiệm vụ/động lực CTV** | Gamify bán hàng | ✅ `storefront-quest.service` |
| **📦 Kho "content kit" dựng sẵn** (ảnh/video/caption/mô tả theo từng SP để CTV bấm-là-share) | **Đòn bẩy bán hàng #1 của Dropii/Selly** | ❌ **THIẾU** — có gian hàng nhưng chưa có thư viện media/caption per-SP để copy nhanh |
| **🧾 Lên đơn hộ khách** (CTV nhập tên/địa chỉ khách, chốt đơn thay) | Selly/Dropii cho phép; giảm ma sát chốt đơn | ❌ **THIẾU** (checkout hiện do người mua tự thực hiện) |
| **🎓 Đào tạo / Academy** | Onboard CTV mới, giữ chân bằng kỹ năng | ❌ **THIẾU** (không có LMS/khoá học) |
| **👥 Hoa hồng nhiều cấp (F1/F2 team)** | Thu nhập thụ động → giữ CTV lâu | ⚠️ có `referredById` (1 cấp) + referral xu; **chưa có team-commission đa cấp** ⚠️ *(cân nhắc pháp lý)* |
| **📊 Bảng xếp hạng / thi đua CTV** | Động lực cạnh tranh | ⚠️ có quest; **chưa có leaderboard CTV/contest theo tháng** |
| **📚 Thông tin SP đầy đủ để bán** | CTV cần "đủ đạn" | ⚠️ catalog có, nhưng **thiếu tài liệu bán hàng chuẩn** (USP, so sánh, FAQ, chứng nhận) per-SP |

### 2.3 Khoảng trống ưu tiên cho Nhóm 2

1. **❌ Content Kit / Thư viện bán hàng per-SP** — mỗi sản phẩm có sẵn: bộ ảnh, video ngắn, 3–5 caption mẫu, mô tả USP, FAQ, chứng nhận → CTV bấm "Sao chép / Chia sẻ Zalo". *Đây là thứ Dropii/Selly làm tốt nhất và bạn thiếu rõ nhất.*
2. **❌ Lên đơn hộ (CTV đặt đơn thay khách)** — CTV nhập thông tin khách, chọn thanh toán (COD/VietQR), hệ tự gắn hoa hồng. Rất hợp thị trường VN (khách chốt qua chat).
3. **❌ Đào tạo/Academy nhẹ** — có thể tái dùng module `feed`/community làm khoá học video + quiz (đã có `GameQuiz`).
4. **⚠️ Leaderboard + contest CTV theo tháng** — tái dùng hạ tầng season/leaderboard của game.
5. **⚠️ (Thận trọng) Hoa hồng giới thiệu 2 cấp** — chỉ nếu thật cần; **giới hạn số cấp, không thưởng theo tuyển dụng**.

> **⚠️ Cảnh báo pháp lý (VN):** Mô hình hoa hồng đa cấp/team chịu điều chỉnh của **Nghị định 40/2018/NĐ-CP về kinh doanh theo phương thức đa cấp** (yêu cầu đăng ký, cấm trả thưởng chủ yếu từ tuyển dụng). Nếu làm team-commission, nên giới hạn 1–2 cấp và gắn thưởng với **doanh số thật**, không phải hành vi tuyển người, để tránh bị xem là bán hàng đa cấp trái phép.

---

## 3. NHÓM 3 — Kéo TRAFFIC từ nhóm không quan tâm SP: Cashback → Gây quỹ CLB (mô hình WeShare)

### 3.1 Bằng chứng mô hình (đã kiểm chứng)

- **WeShare.asia** ✅ — định vị "**Mua sắm online & Quyên góp cho các tổ chức xã hội**"; quyên góp từ **phần "tiền hoàn ví" (cashback)** của các đơn mua trên **Tiki, Lazada, Shopee** → chuyển cho tổ chức xã hội. *(weshare.asia; danviet.vn 2022)*
- **FlipGive** ✅ — brand chia một phần mỗi đơn để **giảm chi phí cho đội/trường**; hai kênh: mua gift card giảm giá + cashback khi mua qua FlipGive; **quy mô: $425M+ doanh số → $50M+ quỹ, 50.000+ chương trình.** *(flipgive.com)*
- **ShopRaise** ✅ — biến mua sắm hằng ngày thành **quyên góp cho trường/đội/CLB/nhà thờ/từ thiện**, **không tốn thêm tiền của người mua**, tự động trích % mỗi đơn. *(shopraise.com)*

→ **Kết luận: ý tưởng của bạn không chỉ khả thi mà đã được chứng minh quy mô lớn.** Cơ chế cốt lõi: *người mua chọn một CLB → mua sắm (SP Tubu hoặc SP đối tác qua affiliate) → phần cashback/hoa hồng chảy vào quỹ CLB → thành viên "gây quỹ bằng cách mua" thay vì góp tiền mặt hay đi bán.*

### 3.2 Bạn đã có gì / thiếu gì cho trụ cột này

| Thành phần | Trạng thái |
|---|---|
| Hạ tầng cashback sàn ngoài (Accesstrade): merchant, click, postback, settle → Ví | ✅ đã có (`cashback` module, provider-agnostic per spec 2026-07-04) |
| TubuXu / Ví / ledger giao dịch | ✅ đã có |
| **Thực thể "Quỹ / CLB / Chiến dịch"** (Cause/Fund/Club) | ❌ **THIẾU** |
| **Chọn CLB thụ hưởng** khi mua (gán cashback vào quỹ thay vì ví cá nhân) | ❌ **THIẾU** |
| **Trang chiến dịch công khai** cho CLB (mục tiêu, tiến độ, người ủng hộ) | ❌ **THIẾU** |
| **Dashboard cho CLB** (số dư quỹ, lịch sử đóng góp, rút/giải ngân) | ❌ **THIẾU** |
| **BXH giữa các CLB** (thi đua gây quỹ) | ❌ **THIẾU** |
| **Sổ minh bạch/ledger quỹ** (ai đóng bao nhiêu, giải ngân ra sao) | ❌ **THIẾU** |
| **Quy trình xác minh CLB + giải ngân** (KYC tổ chức, rút về tài khoản CLB) | ❌ **THIẾU** |

### 3.3 Thiết kế đề xuất cho "Quỹ CLB" (tận dụng tối đa code sẵn có)

- **Model mới:** `Cause` (CLB/quỹ: tên, trường, ảnh bìa, mục tiêu, số dư, trạng thái xác minh), `CauseMembership` (ai theo/ủng hộ CLB nào), `CauseContribution` (mỗi đóng góp = 1 dòng, nguồn: cashback đơn nào / hoa hồng nào), `CausePayout` (giải ngân về CLB).
- **Tái dùng:** logic pool/batch của `CommunityGoal`/`CommunityContribution` (hồ giọt nước Ant Forest) **đã đúng khuôn** cho "hồ quỹ" — chỉ đổi đơn vị từ 💧 sang VND.
- **Điểm móc nối:** ở `cashback` settle & `Commission` APPROVED, thêm nhánh: *nếu người mua đã chọn CLB → cộng vào `CauseContribution` thay vì `wallet`.*
- **Traffic loop:** mỗi CLB có link/QR riêng (tái dùng `AffiliateLink` + `qr-code.tsx` + `share-sheet.tsx`) → sinh viên share trong group Zalo/Facebook trường → viral trong cộng đồng sinh viên.
- **Minh bạch:** trang công khai `/quy/:slug` (giống `/s/:slug`) hiển thị realtime tiến độ + BXH.

### 3.4 Các đòn bẩy traffic khác nhóm khách online thích (bổ sung)

| Tính năng | Kéo traffic vì | Tubu đã có? |
|---|---|---|
| Referral "mời bạn nhận xu" | Lan truyền K-factor | ✅ referral + thưởng xu |
| Vòng quay / quiz / lì xì | Lý do mở app | ✅ spin, quiz |
| Group buy | Rủ bạn mua chung | ✅ |
| Share sang Zalo (native) | Zalo Mini App có sẵn tệp bạn bè | ⚠️ có share-sheet; **nên khai thác Zalo share/mời bạn + OA broadcast/ZNS mạnh hơn** |
| **Livestream/video ngắn** | Giải trí → mua | ❌ (trùng §1) |
| **Thử thách gây quỹ theo CLB có deadline + BXH** | Cạnh tranh giữa các trường/CLB | ❌ (thuộc trụ cột §3) |
| Nội dung cộng đồng (Q&A/tip/showcase) | SEO nội bộ, giữ chân | ✅ `feed` community |

> **⚠️ Cảnh báo pháp lý (VN):** Hoạt động **vận động, tiếp nhận, phân phối quyên góp** có thể liên quan **Nghị định 93/2021/NĐ-CP**. Nên định vị dòng tiền là **"chiết khấu/hoàn tiền do người mua chỉ định chuyển cho CLB"** (giống FlipGive/ShopRaise) hơn là "quyên góp từ thiện" thuần, và yêu cầu **CLB xác minh tư cách + tài khoản nhận** trước khi giải ngân, có sổ minh bạch. Nên hỏi tư vấn pháp lý trước khi go-live trụ cột này.

---

## 4. GAP TỔNG HỢP — "Cần làm thêm gì để hoàn thiện?"

Ký hiệu: ✅ đã có · ⚠️ một phần / cần xác minh · ❌ thiếu.

**Đã rất mạnh (không cần làm lại):** loyalty điểm/hạng/xu, voucher lifecycle, gamification Vườn Xanh, review, subscription, group-buy, wallet đa phương thức, storefront CTV, đại lý B2B, community Q&A, staff/HRM, tích hợp Pancake/ZaloPay/VietQR/ZNS.

**Khoảng trống theo mức ưu tiên:**

| # | Khoảng trống | Nhóm | Mức độ | Độ khó | Tác động |
|---|---|---|---|---|---|
| 1 | **Cashback → Quỹ/CLB (WeShare)** | 3 | ❌ | Trung bình (tái dùng nhiều) | ⭐⭐⭐⭐⭐ khác biệt + traffic sinh viên |
| 2 | **Content Kit + lên đơn hộ cho CTV** | 2 | ❌ | Trung bình | ⭐⭐⭐⭐⭐ giữ chân + tăng doanh số CTV |
| 3 | **Live commerce / video ngắn** | 1+3 | ❌ | Cao (hạ tầng stream) | ⭐⭐⭐⭐ chuyển đổi + traffic |
| 4 | **Chat/CSKH trong app** | 1+2 | ❌ | Trung bình | ⭐⭐⭐⭐ niềm tin + chốt đơn |
| 5 | **Flash sale engine** (nếu chưa nối BE) | 1 | ⚠️ | Thấp–TB | ⭐⭐⭐ thói quen mở app |
| 6 | **Feed cá nhân hoá "Dành cho bạn"** | 1 | ⚠️ | TB | ⭐⭐⭐ thời lượng |
| 7 | **Đào tạo/Academy CTV** | 2 | ❌ | Thấp (tái dùng feed+quiz) | ⭐⭐⭐ onboard + giữ CTV |
| 8 | **Leaderboard/contest CTV** | 2 | ⚠️ | Thấp (tái dùng season) | ⭐⭐ động lực |
| 9 | **Gói freeship / ngưỡng ship** | 1 | ⚠️ | Thấp | ⭐⭐⭐ chuyển đổi |
| 10 | **UI admin duyệt đổi/trả** (BE đã có) | vận hành | ⚠️ | Thấp | ⭐⭐ hoàn thiện vận hành |
| 11 | **Hoa hồng 2 cấp** (thận trọng pháp lý) | 2 | ⚠️ | TB | ⭐⭐ giữ CTV (rủi ro pháp lý) |
| 12 | **VNPAY** (chỉ có enum, chưa có service) | thanh toán | ❌ | Thấp | ⭐ mở rộng cổng TT |

---

## 5. ROADMAP đề xuất (theo flywheel phễu)

Nguyên tắc: **ưu tiên thứ vừa tạo khác biệt vừa tái dùng nhiều code sẵn có.**

### Pha 1 — Trụ cột khác biệt "Gây quỹ CLB" (wedge kéo sinh viên)  ⏱️ lớn nhất về giá trị
- Model `Cause`/`CauseMembership`/`CauseContribution`/`CausePayout` (tái dùng khuôn `CommunityGoal`).
- Móc nối cashback-settle & commission-APPROVED → cộng vào quỹ CLB khi người mua chọn CLB.
- Trang công khai `/quy/:slug` + dashboard CLB + BXH giữa CLB + link/QR share.
- Quy trình xác minh CLB + giải ngân + sổ minh bạch.
- *(Pháp lý: chốt định vị "hoàn tiền do người mua chỉ định" + KYC CLB trước go-live.)*

### Pha 2 — Bộ công cụ CTV "đủ đạn" (giữ chân người bán)
- **Content Kit per-SP**: media library (ảnh/video/caption/USP/FAQ/chứng nhận) + nút "Sao chép / Share Zalo".
- **Lên đơn hộ**: CTV nhập thông tin khách → tạo đơn (COD/VietQR) → tự gắn hoa hồng.
- **Academy nhẹ**: khoá video + quiz (tái dùng `feed` + `GameQuiz`).
- **Leaderboard/contest CTV** theo tháng (tái dùng season/leaderboard).

### Pha 3 — Kênh chuyển đổi & traffic mạnh nhất
- **Live commerce / video ngắn**: bắt đầu bằng **video ngắn có thể mua** (đơn giản hơn livestream), sau đó livestream. Gắn sản phẩm + CTV + quỹ CLB vào từng video.
- **Chat/CSKH trong app** (có thể tận dụng Zalo OA + gắn context đơn).

### Pha 4 — Hoàn thiện chuyển đổi & vận hành
- Flash sale engine (nếu chưa có BE) + gói freeship + feed "Dành cho bạn".
- UI admin duyệt đổi/trả; VNPAY; (tuỳ chọn, thận trọng) hoa hồng 2 cấp.

---

## 6. Giới hạn nghiên cứu (minh bạch)

- Workflow deep-research **bị dừng giữa chừng do hết hạn phiên** (reset 21:30 Bangkok). **48/95 agent verify lỗi.**
- **Đã kiểm chứng 3/3:** toàn bộ mô hình cashback-gây-quỹ (WeShare, FlipGive, ShopRaise).
- **Bị bác/nghi ngờ:** vài số liệu livestream Shopee 12.12 cụ thể (nhưng bản chất kênh live/video vẫn là chủ lực).
- **Chưa kiểm chứng** (chỉ 1 lượt search, verify lỗi): chi tiết cơ cấu hoa hồng Dropii (4 loại, %, bậc Coach), mô hình "3 không" của Selly, chi tiết gamification Shopee. → Trước khi thiết kế team-commission, **nên tự xác minh lại** cơ cấu Dropii từ nguồn chính thức.
- Có thể **chạy lại workflow sau 21:30** để hoàn tất verify + synthesis nếu cần độ chắc cao hơn cho các claim ⚠️.
