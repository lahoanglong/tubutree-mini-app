# Kế hoạch triển khai câu chuyện sản phẩm, đợt đầu

Ngày soạn: 2026-11-05. Nhánh `feat/product-story-showcase-1105`. Số liệu catalog đọc cùng ngày qua API công khai của PROD (`api.tubutree.com/api/products`), chỉ lệnh GET, không ghi gì lên PROD. Tồn kho và giá là giá trị tại lúc đọc, có thể đổi.

## 1. Kết luận

Đợt đầu làm bốn sản phẩm và giữ một sản phẩm dự phòng:

1. Đường hoa dừa SOKFARM (thực phẩm).
2. Bánh mầm hạt yến mạch BH.NONG (thực phẩm).
3. Dầu rửa mặt PƠ LANG (chăm sóc cá nhân).
4. Nước rửa chén sinh học Fuwa3e 3,8L (chăm sóc nhà cửa).
5. Dự phòng: cà phê sầu riêng DURICA Le Plateau, làm khi hàng về kho.

Trước khi bật câu chuyện trên PROD phải xong ba việc, vì thiếu một trong ba thì khách thấy nội dung sai hoặc trang trống:

- Có ảnh bao bì đã tách nền cho từng sản phẩm (mục 5). Ảnh hiện có trên PROD là ảnh poster quảng cáo, không dùng làm sân khấu được.
- Soạn và lưu `storyConfig` cho từng sản phẩm bằng Story Studio, vì PROD không có thành phần hay mô tả để tự sinh (mục 2).
- Sửa tên phân loại đang bị ghi là `[object Object]` (mục 6). Nhánh này đã chặn chữ đó ở vòng cung, nhưng nguồn lỗi nằm ở đồng bộ Pancake và chưa được sửa.

## 2. Hiện trạng catalog PROD

| Chỉ số | Số sản phẩm (trên 111) |
| --- | --- |
| Có ít nhất một ảnh | 86 |
| Có từ 2 phân loại trở lên | 25 |
| Còn hàng (tổng tồn các phân loại lớn hơn 0) | 64 |
| Có trường thành phần (`ingredients`) | 0 |
| Có mô tả (`description`) | 0 |
| Có phân loại mang tên `[object Object]` | 25 (68 phân loại) |
| Có phân loại tên rỗng | 86 |
| Có tồn kho từ 1.000.000 trở lên (giá trị giữ chỗ, ví dụ Fuwa3e 8.888.305) | 48 |
| Đã bán (`sold`) lớn hơn 0 | 0 |

Hệ quả cho tính năng:

- Mười kịch bản mẫu của `story-presets.ts` khớp theo slug của seed. Slug trên PROD có hậu tố băm (ví dụ `dau-goi-thao-duoc-po-lang-300g-77bb42`) nên không sản phẩm thật nào khớp preset.
- Kịch bản tự sinh cần thành phần. PROD không có, nên sản phẩm có từ 2 phân loại chỉ ra cảnh vòng cung, sản phẩm một phân loại không có dải câu chuyện.
- Vì vậy mọi câu chuyện của đợt đầu phải do người soạn trong Story Studio và lưu thành `storyConfig`.

## 3. Cách chọn

Điều kiện loại: hết hàng (tổng tồn bằng 0 hoặc chỉ còn một phân loại lẻ), hoặc không có ảnh nào. Điều kiện ưu tiên, theo thứ tự: còn hàng thật (không phải số giữ chỗ); có từ 2 phân loại để dùng vòng cung; có nhiều ảnh để chọn ảnh gốc làm ảnh cắt nền; có nguyên liệu hay công nghệ in rõ trên bao bì để kể thành bước; phủ cả ba nhóm ngành hàng.

Các sản phẩm đã xem và bị loại:

| Sản phẩm | Lý do loại ở đợt đầu |
| --- | --- |
| Dầu gội thảo dược PƠ LANG 300g | Cả hai phân loại tồn 0 |
| Mật hoa dừa cô đặc Sokfarm | Ba trong bốn phân loại tồn 0, chỉ còn 10 đơn vị loại 7KG |
| Cà phê sầu riêng DURICA Le Plateau | Tồn 0 (giữ làm dự phòng, câu chuyện cà phê và sầu riêng rất rõ) |
| Nước đông trùng hạ thảo Hector Collagen Plus | Tồn 0, và nội dung công dụng cần giấy tờ của nhãn hàng |
| Dầu gội thảo dược sâm Visante | Cả ba phân loại tồn 0 |

## 4. Sản phẩm chủ lực đợt đầu

### 4.1 Đường hoa dừa SOKFARM

Slug `duong-hoa-dua-sokfarm-d6c685`. Ba phân loại: 300g giá 125.000đ, 1KG 360.000đ, 5KG 1.500.000đ, mỗi loại tồn khoảng 990. Là sản phẩm gần sẵn sàng nhất: ảnh đầu tiên chụp bao trên nền trắng. Đã thử cắt nền: lấy vùng bao 600×860, chạy đúng hàm `cutoutWhite` của API, ra ảnh trong suốt 563×817 hiển thị đúng ở cả Mini và web (xem ảnh trong PR). Lề phải của nhãn trắng bị ăn nhẹ, cần người xem lại bản cắt cuối.

Chữ in trên bao dùng được cho điểm chỉ HUD: "100% nguyên chất", "Thơm hương dừa", "Công nghệ chế biến nhiệt độ thấp", "Không qua tinh luyện". Câu kết: "Vị ngọt tự nhiên từ hoa dừa". Các dấu hữu cơ và "Low GI" là tuyên bố của nhãn hàng, xem mục 6 trước khi đưa vào.

Cảnh đề xuất: vòng cung ba phân loại cộng HUD bốn điểm. Có thể thêm lắp ghép ba bước (hoa dừa, nhiệt độ thấp, hạt đường) khi có ảnh lớp.

### 4.2 Bánh mầm hạt yến mạch BH.NONG

Slug `banh-mam-hat-yen-mach-bh-nong-ec5325`. Ba phân loại: 150g 90.000đ, hộp thiếc 210g 150.000đ, 300g 170.000đ; tồn khoảng 999 mỗi loại. Có 12 ảnh, nhiều nhất trong catalog. Bao bì in: "Bánh gạo lứt mầm yến mạch", "Ăn sáng ít ngọt", "Thuần chay", mỗi thanh 36 calo, "Không đường tinh luyện, men nở, trứng, sữa và chất bảo quản", "Công nghệ 1000 lớp Đài Loan", "Bổ sung protein, chất xơ, canxi".

Cảnh đề xuất: lắp ghép ba bước đi theo công thức in trên bao (gạo lứt mầm, yến mạch, lớp bánh), cộng vòng cung ba cỡ. Tên trên web là "Bánh mầm hạt yến mạch", bao ghi "Bánh gạo lứt mầm yến mạch", cần chốt một tên (mục 6).

### 4.3 Dầu rửa mặt PƠ LANG

Slug `dau-rua-mat-po-lang-100ml-55ml-8478ee`. Hai phân loại: 55ml 170.000đ, 100ml 235.000đ; tồn khoảng 999 mỗi loại. Có 6 ảnh. Chữ trên nhãn và poster: "Dầu rửa mặt với dầu bơ và vitamin E", "chiết xuất từ dầu bơ và dầu hạt chanh dây", "làm sạch bã nhờn", "lành tính cho da, kể cả vùng da mắt".

Cảnh đề xuất: lắp ghép ba bước (quả bơ, dầu bơ, chanh dây) và vòng cung hai cỡ. Ảnh đầu tiên là poster ghi "Dầu tẩy trang", trái với tên sản phẩm "Dầu rửa mặt": cần chốt tên (mục 6).

### 4.4 Nước rửa chén sinh học Fuwa3e 3,8L

Slug `nuoc-rua-chen-fuwa3e-3-8l-ef3979`. Một phân loại, giá 385.000đ, tồn 972. Có 10 ảnh. Poster ghi: "Thành phần gốc thực vật, không hóa chất độc hại", "Làm sạch bằng enzyme vỏ dứa lên men", "100% vegan", "Hương dứa". Một phân loại nên không có vòng cung; chỉ lắp ghép và HUD. Cùng dòng Fuwa3e có nhiều cỡ (100ml, 500ml, 3,8L, refill 10L) nhưng là các sản phẩm riêng, nên vòng cung theo cỡ chưa dùng được cho dòng này.

### 4.5 Dự phòng: cà phê sầu riêng DURICA Le Plateau

Slug `ca-phe-sau-rieng-thom-beo-durica-le-plateau-hop-g-x-10-goi-2c9db2`. Tồn 0 tại lúc đọc, một phân loại, 10 ảnh. Bao in "Từ nguồn cà phê và sầu riêng thượng hạng". Làm khi hàng về.

## 5. Tài nguyên ảnh cần chuẩn bị

Quy cách chung cho mọi tệp: PNG hoặc WebP có kênh trong suốt, không viền, không chữ nhỏ. Sprite nguyên liệu hiển thị bằng 24% cạnh khung sân khấu, tức khoảng 82px trên Mini 375px, nên hình phải đọc được ở cỡ đó. Ảnh lớp: vuông 512×512, vật thể chiếm khoảng 80% khung, tối đa 60KB. Ảnh bao bì tách nền: cạnh dài 1200px, tối đa 150KB, tỉ lệ giữ nguyên (sân khấu hiện trọn ảnh dọc, không cắt).

Thư viện sprite hiện có (14 hình): vỏ bưởi, lát bưởi, quả bồ kết, lá hương nhu, sả chanh, lá rau má, bơ hạt mỡ, hạt cà phê Arabica, giọt mật ong, lát dứa, hạt granola, lá tràm gió, giọt nước, giọt dầu. Cột cuối chỉ ghi hình gần đúng, người duyệt quyết định dùng hay làm mới.

| Sản phẩm | Tài nguyên | Tên tệp đề xuất | Thư viện hiện có |
| --- | --- | --- | --- |
| Đường hoa dừa SOKFARM | Bao bì tách nền (300g, 1KG, 5KG nếu bao khác nhau) | `sokfarm-duong-hoa-dua-{300g,1kg,5kg}.webp` | Không |
| | Hoa dừa (cụm hoa) | `layer-hoa-dua.webp` | Không |
| | Trái dừa bổ đôi | `layer-trai-dua.webp` | Không |
| | Lá dừa | `layer-la-dua.webp` | Không |
| | Hạt đường nâu | `layer-hat-duong.webp` | Gần đúng: giọt mật ong |
| Bánh mầm hạt yến mạch BH.NONG | Hộp bánh tách nền (150g, hộp thiếc 210g, 300g) | `bhnong-banh-yen-mach-{150g,thiec-210g,300g}.webp` | Không |
| | Gạo lứt nảy mầm | `layer-gao-lut-mam.webp` | Không |
| | Hạt yến mạch | `layer-yen-mach.webp` | Gần đúng: hạt granola |
| | Chiếc bánh nhiều lớp (cắt ngang) | `layer-banh-nhieu-lop.webp` | Không |
| Dầu rửa mặt PƠ LANG | Chai 55ml và 100ml tách nền | `polang-dau-rua-mat-{55ml,100ml}.webp` | Không |
| | Quả bơ bổ đôi | `layer-qua-bo.webp` | Không |
| | Giọt dầu bơ | `layer-dau-bo.webp` | Gần đúng: giọt dầu |
| | Quả chanh dây | `layer-chanh-day.webp` | Không |
| Nước rửa chén Fuwa3e 3,8L | Can 3,8L tách nền | `fuwa3e-rua-chen-3-8l.webp` | Không |
| | Vỏ dứa | `layer-vo-dua.webp` | Gần đúng: lát dứa |
| | Quả dứa nguyên | `layer-qua-dua.webp` | Gần đúng: lát dứa |
| | Bọt xà phòng | `layer-bot.webp` | Không |

Tổng cộng 13 ảnh lớp (năm hình trong đó có hình gần đúng ở thư viện) và tối đa 9 ảnh bao bì cho bốn sản phẩm. Ảnh bao bì lấy được từ ảnh có sẵn của PROD chỉ khi tách thủ công khỏi khung và băng Tubu Tree, vì chạy `cutoutWhite` trên nguyên ảnh PROD cho kết quả 0,0% điểm ảnh được tách (đo trên bốn ảnh: Sokfarm, Pơ Lang, DURICA, Hector). Lý do: khung xanh quanh ảnh chặn thuật toán loang từ viền, và ba trong bốn ảnh có nền không phải màu trắng.

## 6. Nguồn lấy ảnh và điều phải làm trước khi bật

Thứ tự ưu tiên nguồn ảnh:

1. Nhãn hàng đối tác (Sokfarm, BH.NONG, PƠ LANG, Fuwa3e) gửi ảnh bao bì nền trong hoặc nền trắng và ảnh nguyên liệu. Xin kèm xác nhận bằng văn bản cho phép dùng trên Mini App và web.
2. Tự chụp bao bì nền trắng rồi tách nền (Story Studio đã có bước tách nền tự động cho ảnh nền trắng).
3. Kho ảnh có giấy phép thương mại: Freepik, Shutterstock, Adobe Stock (trả phí) hoặc Pixabay, Pexels, Unsplash (miễn phí, là ảnh chụp nên phải tách nền); biểu tượng từ Flaticon hay SVG Repo. Mỗi tệp phải đọc điều khoản giấy phép của chính tệp đó, một số nguồn bắt buộc ghi công. Tài liệu này chỉ gợi ý nguồn, chưa tải hay kiểm điều khoản của nguồn nào.
4. Không lấy ảnh từ Shopee, Lazada hay website bán hàng khác: đó là ảnh của người bán.

Dữ liệu cần xử lý trước khi bật:

- **Tên phân loại `[object Object]`.** API công khai trả tên này cho cả 25 sản phẩm có từ 2 phân loại. Nguồn nghi ngờ: `apps/api/src/modules/integrations/pancake/pancake-sync.service.ts:506` ghép `Object.values(v.fields).join(' - ')`, trong khi `attributes` trả về là mảng đối tượng `{name, value}`; khớp với chữ `[object Object]`. Chưa chạy lại đồng bộ để kiểm. Nhánh này chỉ sửa phía vòng cung (lấy giá trị thuộc tính khi tên hỏng). Các màn khác dùng tên phân loại chưa được rà.
- **Tồn kho giữ chỗ.** 48 sản phẩm có tồn từ 1.000.000 trở lên. Bốn sản phẩm đợt đầu có tồn thật nên không bị ảnh hưởng.
- **Tên sản phẩm lệch bao bì.** "Dầu rửa mặt PƠ LANG" so với poster "Dầu tẩy trang"; "Bánh mầm hạt yến mạch" so với bao "Bánh gạo lứt mầm yến mạch". Chủ chốt một tên theo bao bì.
- **Câu tuyên bố trên bao bì.** "Diệt khuẩn lên đến 98%" (Fuwa3e), "Low GI" và các dấu hữu cơ (Sokfarm), "Thuần chay", "36 calo" (BH.NONG) là tuyên bố của nhãn hàng. Chỉ đưa vào HUD khi nhãn hàng gửi được giấy tờ chứng minh; chưa có thì dùng câu mô tả không đo lường, ví dụ "Làm sạch bằng enzyme vỏ dứa lên men".
- **Trường thành phần trống.** Nên nhập `ingredients` cho bốn sản phẩm: khi đó nếu cần tạo lại kịch bản tự sinh thì có dữ liệu thật, và lắp ghép lẫn HUD không phải gõ tay lại.

## 7. Quy trình cho mỗi sản phẩm

1. Nhận hoặc chụp ảnh bao bì, tách nền, đặt tên theo bảng ở mục 5.
2. Mở Story Studio của sản phẩm, tải ảnh bao bì làm `cutoutUrl` và ảnh lớp làm `imageUrl` cho từng lớp.
3. Soạn từ ba đến năm bước, mỗi bước tiêu đề ngắn và nội dung không quá 140 ký tự. Chữ chỉ lấy từ bao bì hoặc từ giấy tờ của nhãn hàng.
4. Với sản phẩm có từ 2 phân loại, giữ cảnh vòng cung (nhãn tự lấy từ phân loại thật) và chọn màu quầng cho từng mục.
5. Xem trước ở 375px và 1280px trong Studio, rồi bật `enabled`.
6. Kiểm trên Mini App và web: ảnh sân khấu không rỗng, không tràn ngang, bước cuối bật được bằng cuộn lẫn chạm chip, nút Mua ngay đúng khi hết hàng.

Thứ tự làm: Sokfarm trước (đã có ảnh nền trắng và đã thử cắt), rồi BH.NONG, PƠ LANG, Fuwa3e. DURICA khi hàng về.
