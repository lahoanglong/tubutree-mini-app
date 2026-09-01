# 🎬 DEMO SCRIPT — Tubu Tree Mini App

> Kịch bản demo ~7–10 phút, đi hết hành trình B2C + điểm nhấn "wow". Tiếng Việt, tông "Sống xanh An Lành".
> Chạy trên: Mini App trên Zalo (sau `zmp deploy`) **hoặc** `https://app.tubutree.com` (web, cùng API/catalog) khi cần demo nhanh trên trình duyệt.

---

## 0. Chuẩn bị (30 giây)
- Backend prod đã LIVE: `https://api.tubutree.com` (đã verify). Catalog: **8 thương hiệu, 44 sản phẩm có ảnh**.
- Mở Mini App trên Zalo (đã `zmp deploy`) — hoặc mở `app.tubutree.com` nếu demo trên laptop.
- Tài khoản: mở app là tự đăng nhập (Zalo trong app; khách ngoài Zalo) — **không cần thao tác đăng nhập**.

> Lời thoại mở: *"Tubu Tree là hệ sinh thái thương mại 'Sống xanh An Lành' — phân phối nhiều thương hiệu sản phẩm tự nhiên Việt: Visante, Pơ Lang, Fuwa3e, Cobote, Le Plateau Coffee, BH.Nong, Sokfram, Hector. Em demo trọn hành trình khách hàng nhé."*

## 1. Trang chủ — câu chuyện đa thương hiệu (1 phút)
- Chỉ **hero "Thiên nhiên Việt cho cả nhà"** + lời chào theo tên + điểm Xanh.
- Lướt **dải 8 thương hiệu** (mỗi brand 1 chấm màu riêng) → *"mỗi thương hiệu một màu nhận diện, đúng tinh thần đa thương hiệu."*
- Chỉ **phân khúc** (Mẹ & bé, Nhà bếp xanh, Chăm sóc cá nhân, Sống xanh) + **Flash Sale hôm nay** (sản phẩm đang giảm) + **Hành trình nguyên liệu**.
- 👉 *Wow*: catalog phong phú, ảnh đẹp, gợi ý theo persona "mẹ & bé".

## 2. Khám phá & lọc thương hiệu (1 phút)
- Vào **Khám phá** → lướt **chip lọc 8 thương hiệu** → bấm **Le Plateau Coffee** → ra cà phê đặc sản; bấm **Cobote** → đồ cho bé.
- Đổi **sắp xếp** (Giá thấp→cao). Gõ tìm "tràm" → typeahead.
- 👉 *Wow*: lọc đa thương hiệu mượt, mỗi brand có nhận diện riêng.

## 3. Chi tiết sản phẩm → giỏ (1 phút)
- Mở **"Serum dưỡng ấm Visante"** (hoặc "Dầu gội bưởi Pơ Lang"): ảnh, giá sale, **thành phần & công dụng**, chứng nhận (USDA Organic/Vegan), đánh giá, "sản phẩm cùng thương hiệu".
- Chọn biến thể (30ml/50ml) → **Thêm vào giỏ**. Tim **yêu thích**.
- 👉 *Wow*: trang chi tiết chuẩn TMĐT, kể được câu chuyện thành phần.

## 4. Checkout mượt (1.5 phút)
- Vào **Giỏ**: chỉnh số lượng, **thanh tiến độ freeship** ("mua thêm X để freeship").
- Nhập mã **FREESHIP** (hoặc **XANH10** giảm 10%) → phí ship về 0.
- **Thanh toán**: chọn địa chỉ (picker tỉnh/phường mã thật), phương thức **COD**, xem **điểm Xanh sẽ nhận**.
- Đặt đơn → **đơn `CONFIRMED`**, mã `TUBU…`. (Idempotency: bấm lại không tạo đơn đôi.)
- 👉 *Wow*: phí ship 200k/19k đúng, voucher đúng, đặt đơn an toàn (chống đặt trùng).

## 5. ⭐ Vườn Xanh Tubu — điểm nhấn giữ chân (2 phút) — WOW CHÍNH
- Vào **Vườn Xanh**: cây đang lớn theo lượng 💧, **bình nước**, **chuỗi điểm danh (streak) + vé giữ lửa**.
- **Điểm danh hôm nay** → +💧 + giọt sương. Trả lời **quiz thiên nhiên** ("Bạn có biết") → +💧 + giải thích.
- **Tưới cây** → cây tiến gần mốc thu hoạch; **Vòng quay** nhận thưởng (điểm/voucher/💧).
- Chỉ **Mốc cộng đồng "Phủ xanh Cần Giờ"** (góp 💧 → cây thật qua PanNature), **Sổ tay loài cây VN**, **mùa Hè Xanh + BXH mùa**, **tặng nước cho bạn**.
- 👉 *Wow*: gamification có chiều sâu + gắn CSR trồng cây thật — khác biệt lớn so với app bán hàng thường.

## 6. ⭐ Hạng thành viên "Lá xanh" (1 phút) — WOW PHỤ
- Vào **Hạng thành viên**: huy hiệu hạng (🌱 Mầm Xanh → 🌿 Lộc Biếc → 🌳 Đại Thụ → 🌲 Cổ Thụ), **thanh tiến độ lên hạng kế**, **quyền lợi từng hạng**, **kho voucher**, **lịch sử điểm**.
- 👉 *Wow*: vòng lặp loyalty rõ ràng; (mới: user mới luôn hiển thị đúng hạng nền Mầm Xanh).

## 7. 3 hành trình phụ (1 phút, lướt nhanh)
- **CTV/Affiliate**: trang chia sẻ (link + hoa hồng theo sản phẩm), dashboard bậc doanh số tháng.
- **Hoàn tiền (Cashback)**: danh sách sàn (Shopee/Lazada/TikTok) + tỉ lệ, ví Tubu, lịch sử hold/confirmed.
- **Đại lý B2B**: bảng giá theo bậc (chiết khấu tới 45%), đặt sỉ theo template, sổ công nợ.

## 8. Tra cứu đơn (30 giây)
- Vào **Đơn hàng** → mở đơn vừa đặt → trạng thái + hành trình. *"Khi tích hợp Pancake thật, trạng thái vận đơn realtime."*

---

## Câu chốt
> *"Một Mini App đi trọn vòng: mua sắm đa thương hiệu → tích điểm/lên hạng → chơi Vườn Xanh trồng cây thật. Vừa bán hàng, vừa giữ chân, vừa kể câu chuyện sống xanh."*

## Ghi chú kỹ thuật cho người demo
- Ảnh sản phẩm hiện là ảnh demo (picsum theo slug) cho **dữ liệu mẫu**; khi sync Pancake thật, ảnh/giá/tồn lấy từ Pancake.
- Thanh toán ZaloPay/ZNS/Accesstrade bật khi có key thật (xem `docs/GO-LIVE-KEYS.md`); demo dùng **COD + Ví** đầy đủ.
- Nếu mạng Zalo chập chờn, app tự đăng nhập **khách** để vẫn dùng full chức năng.
