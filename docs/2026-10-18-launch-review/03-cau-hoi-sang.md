# Câu hỏi cần chủ dự án chốt (sáng 2026-10-18)

Mỗi câu đã có sẵn phương án mặc định do agent đề xuất. Đồng ý hết thì chỉ cần trả lời "theo mặc định". Muốn đổi câu nào thì ghi số câu và lựa chọn, ví dụ "A1: 12%, B2: 15 ngày".

- Kết quả làm trong đêm: xem `02-tong-hop-va-ke-hoach.md`.
- Mọi thay đổi đang nằm ở nhánh cục bộ `review/2026-10-18-launch`. Chưa push, chưa deploy.
- Những câu hỏi chi tiết hơn (cách dùng từng tính năng) nằm trong `impl/<gói>.md`, mục "Câu hỏi".
- **Đã chốt toàn bộ ngày 2026-10-18.** Xem mục "Quyết định đã chốt" ngay dưới đây. Các bảng phía sau giữ nguyên để tra lại đề xuất ban đầu.

## Quyết định đã chốt (chủ dự án trả lời 2026-10-18)

Chỗ nào khác đề xuất ban đầu thì có ghi "(đổi)".

### Nhóm A

| # | Quyết định |
|---|---|
| A1 | (đổi) Hoa hồng 8% cho mọi sản phẩm |
| A2 | Chỉ CTV và đại lý hưởng hoa hồng |
| A3 | Không trả hoa hồng CTV cho hàng của gian hàng đối tác |
| A4 | (đổi) Giữ cả ba mã WELCOME30, FREESHIP, XANH10. Chủ dự án chấp nhận khách mới có thể được giảm hai lần (WELCOME30 + voucher chào mừng). Kiểm go-live không được báo FAIL vì ba mã này |
| A5 | (đổi) Tắt 44 sản phẩm demo, giữ danh mục. Đồng bộ toàn bộ sản phẩm từ Pancake sang Tubu |
| A6 | (đổi) Tài khoản nhận chuyển khoản: CONG TY TNHH TUBU TREE, số 8386790906, Ngân hàng TMCP Kỹ Thương Việt Nam (Techcombank) |
| A7 | Giữ nguyên các số tiền trong migration |
| A8 | Nạp bộ giá trị kinh doanh mặc định (`--with-business-defaults`) |
| A9 | Agent soạn nháp 4 trang pháp lý, chủ dự án duyệt. Pháp nhân: CÔNG TY TNHH TUBU TREE, MST 0319585995, Số 33, đường 1B, phường Long Bình, Thành phố Hồ Chí Minh, Việt Nam. Email tubutree@gmail.com |
| A10 | Bỏ chữ "100%" |
| A11 | Backup lưu trên Google Drive |
| A12 | Thẻ hộp hàng sàn: giảm 30.000đ, đơn từ 199.000đ, hạn 60 ngày, chỉ khách mới, mỗi thẻ một mã |

### Nhóm B

| # | Quyết định |
|---|---|
| B1 | Đại lý nhập hàng về bán offline và bán online. Gian hàng trên Tubu là một trong các kênh online của đại lý |
| B2 | Giữ hoa hồng 10 ngày sau khi giao |
| B3 | Gian hàng CTV phải được duyệt lần đầu: bật `storefront.require_approval` |
| B4 | Chủ dự án làm DNS wildcard + SSL. Agent hướng dẫn, kiểm xong mới bật `storefront.subdomain_enabled` |
| B5 | (đổi) Freeship đơn đầu bật, áp cho đơn từ 199.000đ |
| B6 | (đổi) Xem mục "Điểm Xanh kiểu mới" bên dưới |
| B7 | Kế toán được bấm "Đã chi". Duyệt rút tiền vẫn chỉ ADMIN |
| B8 | CSKH duyệt bài cộng đồng trong 4 giờ làm việc. Chỉ ADMIN ghim bài và chọn người thắng |
| B9 | (đổi) Đơn CSKH lên trên Pancake (chat, điện thoại) tự cộng điểm theo SĐT khách, không cần quét. Tỉ lệ như đơn app, chờ giao xong + 14 ngày, báo khách qua Zalo OA. SĐT chưa vào Mini App thì giữ điểm 30 ngày; khách vào Mini App bằng SĐT đó trong hạn thì tự nhận |
| B10 | Giữ logo. Màu cam của logo làm màu khuyến mãi. Web dùng file logo thật |
| B11 | (đổi) Giữ email tubutree@gmail.com |
| B12 | Giữ tên "Vườn Xanh", thêm gợi ý lần đầu |
| B13 | Bật `home.new_customer_layout` khi ra mắt |
| B14 | Bật `community.public_preview` khi ra mắt |
| B15 | CTV bị hạ vai trò vẫn nhận hoa hồng của các đơn đặt trước đó |
| B16 | Giữ như đã làm: gian hàng ẩn khi chủ bị hạ vai trò, đơn ghi công theo luật chung |
| B17 | Giữ trừ TNCN 10% cho mọi vai trò. Chủ dự án hỏi kế toán |
| B18 | (đổi) Mở hết cho kế toán: công nợ đại lý, "Đã nhận tiền" đơn chuyển khoản, hoá đơn VAT, chi thưởng đại lý, duyệt hoàn tiền mua trên sàn. Thêm tab Đơn hàng cho kế toán |
| B19 | (đổi) Trần mã do nhân viên tạo: tối đa 30% / 100.000đ mỗi đơn, 10 triệu đồng/ngày/người. Giữ 1.000 lượt mỗi mã |
| C | Đồng ý toàn bộ Nhóm C. Quà sự kiện cộng đồng đổi sang điểm mới: 20.000–50.000 điểm |

### Điểm Xanh kiểu mới (B6, B6a–B6e, B9)

- **1 điểm = 1đ.** Điểm nhận được bằng tiền hàng sau mọi giảm giá (không tính phí ship) nhân tỉ lệ.
- **Đơn trong app:** 2%, nhân hệ số hạng (Mầm Xanh ×1, Lộc Biếc ×1,2, Đại Thụ ×1,5, Cổ Thụ ×2), tức 2% / 2,4% / 3% / 4%. Ví dụ: đơn 199.000đ ở hạng Mầm Xanh được 3.980 điểm.
- **Đơn sàn** (Shopee, Lazada, TikTok; cả 3 sàn đã nối vào Pancake): 1%, không nhân hệ số, không tính vào xét hạng.
  - Khách quét hoặc nhập mã vận đơn trong Mini App.
  - Mã phải khớp một đơn sàn trong Pancake. Mỗi mã chỉ tích một lần.
  - Điểm ở trạng thái chờ. Đơn giao xong 14 ngày (hạn trả hàng của sàn) thì thành điểm dùng được. Đơn hoàn thì huỷ.
- **Đơn CSKH lên trên Pancake:** theo B9.
- **Mọi con số điểm khác nhân 1.000:** điểm danh, vòng quay, quà đổi điểm, đổi rác, thưởng cộng đồng, ngưỡng hạng. Phiên "đổi rác lấy quà" phải đổi theo.
- **Dòng "Mua trong Mini App được tích gấp đôi"** hiện ở màn quét mã vận đơn, trang sản phẩm, trang chủ và ví điểm.

### Sự thật chủ dự án xác nhận

- Shopee, Lazada, TikTok đã nối vào cùng shop Pancake.
- Chiến dịch đầu dự kiến 100–300 khách cùng lúc: VPS hiện tại đủ, theo dõi khi chạy.
- VPS có từ 8 vCPU: đặt `API_CPUS=2`.
- AI tư vấn chạy bằng Antigravity CLI, theo cách ChoDeli đang làm. Agent đã báo rủi ro: dùng gói tài khoản cá nhân cho chatbot công khai có thể trái điều khoản của nhà cung cấp.
- Đã có nhóm Zalo, Fanpage Facebook, TikTok để dẫn khách vào cộng đồng.
- Kho gom đơn "Fuwa3e Tubu HCM": địa chỉ đúng, SĐT đổi thành 0899149229.

## Nhóm A — chốt trước ra mắt (tiền, pháp lý, dữ liệu thật)

| # | Câu hỏi | Mặc định khuyên | Vì sao phải chốt |
|---|---|---|---|
| A1 | % hoa hồng CTV cho từng nhóm hàng | 10% toàn danh mục. Hàng biên thấp chỉnh tay. Hàng không cho CTV bán thì bật "chặn hoa hồng" | Màn nhập % đã có (Admin → "Hoa hồng & giá sỉ", nhập từng SP hoặc dán CSV). Chưa nhập thì mọi đơn CTV ra 0đ |
| A2 | Ai được hưởng hoa hồng khi người mua dùng mã/link giới thiệu? | Chỉ CTV và đại lý. Khách thường giới thiệu bạn thì nhận điểm "mời bạn" như cũ. ADMIN/nhân viên không hưởng, kể cả khi lên đơn hộ khách | Đã code theo mặc định này. Đổi bằng khoá `affiliate.commission_eligible_roles` |
| A3 | Hàng của gian hàng đối tác có trả hoa hồng CTV không? Nếu có thì ai chịu? | Không trả mặc định. Muốn trả thì đặt % từng sản phẩm, Tubu chịu | Khi trả, khoản này không trừ vào đối soát đối tác |
| A4 | Ba mã demo đang có sẵn trong DB: WELCOME30 (giảm 30k cho đơn từ 199k), FREESHIP (đơn từ 99k, không giới hạn tổng lượt), XANH10 (giảm 10%, tối đa 50k) | Tắt cả ba bằng script dọn demo khi deploy | WELCOME30 trùng voucher chào mừng hệ thống tự tặng, nên khách mới được giảm hai lần. Kiểm go-live sẽ báo FAIL cho tới khi chốt |
| A5 | 44 sản phẩm demo, 8 nhãn (BH.Nong, Cobote, Fuwa3e, Hector, Le Plateau Coffee, Pơ Lang, Sokfram, Visante), 7 danh mục | Tắt 44 SP demo. Giữ danh mục để gán hàng thật. Nhãn nào không phải Tubu phân phối thì ẩn | Không tắt thì khách mua được hàng giá demo |
| A6 | Tài khoản nhận chuyển khoản `9984606774` Techcombank "CONG TY TUBU TREE" | Xác nhận đúng, hoặc gửi số đúng | Đang nằm sẵn trong migration. Sai thì khách chuyển nhầm tiền |
| A7 | Các số tiền đang có trong migration: voucher chào mừng/sinh nhật/quay lại, thưởng mốc chi tiêu, hoa hồng đối tác 15%, mua chung giảm 15%, khấu trừ TNCN 10% khi vượt 2 triệu, đổi trả 7 ngày | Giữ nguyên. Kế toán kiểm lại mức TNCN | Đây là tiền thật khi chạy |
| A8 | Nạp bộ giá trị kinh doanh mặc định lúc deploy: giải vòng quay, điểm mốc mời bạn, giảm giá đặt định kỳ, freeship theo hạng, 4 hạng thành viên, 4 bậc đại lý, 4 nhiệm vụ | Có. Chạy lệnh có cờ `--with-business-defaults`. Bảng số đầy đủ ở `impl/refseed.md` mục 3.2 | Không nạp thì admin không duyệt được đại lý (chưa có bậc), và thẻ hạng hứa freeship mà không thực hiện |
| A9 | Nội dung 4 trang pháp lý (điều khoản, bảo mật, đổi trả, vận chuyển) + pháp nhân (tên, MST, địa chỉ) + số ngày hoàn tiền/giao hàng. Đã đăng ký website với Bộ Công Thương chưa? | Agent đã dựng khung trang có biển "BẢN NHÁP". Chủ dự án dán nội dung đã duyệt vào Admin → Cấu hình → `legal.*` trước ngày mở bán | Thiếu là rủi ro pháp lý. Trang đăng nhập đang trỏ tới các trang này |
| A10 | Câu "100% Thuần Chay", "100% Nguyên bản Việt Nam" ở trang đầu web; "100% Chính hãng", "Xuất kho tận gốc" ở gian hàng | Bỏ chữ "100%" nếu chưa chắc đúng cho mọi sản phẩm | Lời tuyệt đối dễ bị khiếu nại quảng cáo |
| A11 | Backup lưu ở đâu? Chấp nhận mất tối đa bao nhiêu giờ dữ liệu ví/điểm? | Cloudflare R2 hoặc Google Drive. Backup 6 giờ/lần + trước mỗi deploy | Script đã có. Cần chỗ lưu và người cài cron |
| A12 | Thẻ trong hộp hàng sàn: giá trị mã, đơn tối thiểu, hạn dùng, số thẻ mỗi đợt | Mã giảm tiền nhỏ hơn biên lợi nhuận đơn đầu, có đơn tối thiểu, hạn 60–90 ngày. Mỗi thẻ một mã riêng. Chỉ khách mới | Tính năng đã xong: Admin → Voucher → "Thẻ hộp hàng sàn". Cách làm từng bước ở `impl/claim.md` mục 4. Trước khi in phải điền `app.miniapp_base_url` |

## Nhóm B — chốt trong tuần ra mắt

| # | Câu hỏi | Mặc định khuyên |
|---|---|---|
| B1 | Đại lý bán online theo mô hình nào? | "CTV cấp cao": bán qua gian hàng, Tubu giao, % cao hơn theo bậc. Hàng nhập sỉ thì bán offline |
| B2 | Giữ hoa hồng bao lâu sau khi giao? | 10 ngày (7 ngày đổi trả + 3 ngày đệm), thay cho 20 ngày hiện nay |
| B3 | Gian hàng CTV `/s/` cần admin duyệt trước khi công khai? | Có duyệt lần đầu. Chưa duyệt thì không có tick xanh và chữ "tuyển chọn". Đang làm sau cờ `storefront.require_approval`, mặc định tắt |
| B4 | Link gian hàng dạng `ten.tubutree.com` lúc ra mắt? | Không. Dùng `app.tubutree.com/s/<mã>` tới khi có DNS wildcard + SSL. Đang làm sau cờ `storefront.subdomain_enabled`, mặc định tắt |
| B5 | Freeship đơn đầu: bật không, ngưỡng bao nhiêu? Có cho cộng dồn với mã thẻ chỉ-khách-mới không? | Bật, không ngưỡng, cho cộng dồn trong đợt ra mắt. Tính năng đã làm, đang tắt (`shipping.first_order_free_enabled`) |
| B6 | Đơn sàn có được tích Điểm Xanh không? | Thưởng một lần khi khách ghép đơn sàn đầu tiên, không tính vào hạng. Chưa làm |
| B7 | Kế toán và marketing có phải người riêng không? Kế toán có được bấm "Đã chi" rút tiền không? | Có, người riêng. Thêm 2 nhóm quyền riêng, không cấp ADMIN. Kế toán được bấm "Đã chi" |
| B8 | Ai duyệt bài cộng đồng, trong bao lâu? | CSKH duyệt trên web trong 4 giờ làm việc. Chỉ ADMIN ghim bài và chọn người thắng |
| B9 | Đơn khách đặt qua chat/điện thoại: CSKH lên đơn trong app hay giữ trên Pancake? | Lên đơn trong app để khách được điểm. Trong lúc chưa có, sổ tay ghi rõ đơn tạo trên Pancake không tích điểm |
| B10 | Logo vàng-cam có phải nhận diện chính thức không? | Giữ logo. Lấy màu cam của logo làm màu khuyến mãi. Web dùng logo thật |
| B11 | Email CSKH công khai | Dùng hộp thư tên miền (vd hello@tubutree.com) thay cho `tubutree@gmail.com` |
| B12 | Ô giữa thanh tab là "Vườn Xanh": khách mới từ sàn chưa hiểu | Giữ vị trí, đổi nhãn thành "Quà xanh" hoặc thêm gợi ý lần đầu |
| B13 | Trang chủ cho khách mới: đưa khối chào mừng + danh mục lên trước giờ vàng? | Có, khách cũ giữ thứ tự hiện tại. Đang làm sau cờ `home.new_customer_layout`, mặc định tắt |
| B14 | Cho xem bảng tin cộng đồng khi chưa đăng nhập? | Có, chỉ đọc, nhưng chỉ bật cờ `community.public_preview` khi đã có người duyệt bài: bài đăng lên ngay nên bài rác cũng hiện ở phần xem trước cho tới khi CSKH gỡ (gỡ xong còn hiện tối đa ~1 phút). Đã làm, cờ đang tắt |
| B15 | CTV bị hạ vai trò sau khi khách đã đặt đơn | Vẫn nhận hoa hồng của các đơn đặt trước đó. Admin xử lý tay nếu cần |
| B16 | Gian hàng của CTV đã bị hạ vai trò mà vẫn đang mở: khách có "chạm" CTV khác còn hạn thì CTV khác được hoa hồng. Có muốn gian hàng chặn luôn trường hợp này không? | Không chặn. Ẩn gian hàng khi hạ vai trò (làm trong gói storefront) |
| B17 | Hoa hồng của đại lý đang bị khấu trừ thuế TNCN 10% giống CTV cá nhân. Đại lý là doanh nghiệp hoặc hộ kinh doanh thì có trừ TNCN không, hay đại lý xuất hoá đơn cho Tubu? | Hỏi kế toán. Trong lúc chờ, giữ khấu trừ 10% cho mọi vai trò như hiện nay |
| B18 | Kế toán có được làm thêm: xem công nợ đại lý (tab mới "Đại lý & công nợ"), ghi nhận công nợ, xác nhận "Đã nhận tiền" đơn chuyển khoản, xuất hoá đơn VAT, chi thưởng đại lý, duyệt hoàn tiền mua trên sàn? | Chưa mở, vẫn chỉ ADMIN. Mở thì kế toán cần thêm tab Đơn hàng |
| B19 | Trần mã giảm giá do nhân viên (marketing) tạo? Đã chặn: tối đa 50% / 200.000đ mỗi đơn, tối đa 1.000 lượt mỗi mã, tổng mức giảm có thể phát ra tối đa 30 triệu đồng/ngày/người (tính cả lô thẻ). Nhân viên không sửa hay bật lại mã do ADMIN tạo, không tự dùng mã mình tạo. ADMIN không bị trần. Kế toán xuất CSV đơn thì SĐT bị che, chỉ còn 3 số cuối | Giữ các mức trên. Đổi trong Cấu hình: `coupon.staff_max_percent`, `coupon.staff_max_amount_vnd`, `coupon.staff_max_usage`, `coupon.staff_daily_budget_vnd`. Đợt in thẻ lớn hơn thì ADMIN tạo |

## Nhóm C — để mặc định được, chỉ trả lời nếu không đồng ý

- **Rủi ro chấp nhận:**
  - Một người có N SIM tạo được N tài khoản Zalo, nhận N lần ưu đãi khách mới. Mỗi lần cần một đơn giao thật.
  - Khách từ chối nhận hàng COD đơn đầu sẽ được tính lại là khách mới. Shop không mất thêm tiền.
- **Hạng, giá, khuyến mãi:**
  - Hạ ngưỡng hạng Lộc Biếc xuống 1,5 triệu/12 tháng.
  - Giá trực tiếp giữ bằng giá sàn. Khác biệt bằng điểm, đặt định kỳ, combo riêng.
  - Không bật lại Chặng Mùa. Combo gian hàng tắt ở bản ra mắt.
- **ZNS:** nộp ngay 3 mẫu giao dịch (mời đánh giá, mua chung thành công, mua chung thất bại). Tin hậu mãi tối đa 2 tin/khách/tháng.
- **Cộng đồng:**
  - 1 sự kiện/tháng, quà 20–50 Điểm Xanh cho 3 người thắng.
  - 10 bài khởi tạo đăng dưới tài khoản "Tubu Tree".
  - Quiz cần thêm câu hỏi trước ngày ra mắt, nếu không khách sẽ thấy câu lặp.
- **Thông báo:**
  - Tin "có người thích/bình luận bài của bạn" dùng chung công tắc "Vườn Xanh".
  - Gộp tối đa 1 tin mỗi bài mỗi 60 phút.
  - Câu hỏi chưa ai trả lời sau 24 giờ thì lên "Việc cần xử lý".
- **Web:**
  - Giữ đăng nhập bằng Zalo, chưa mở mua cho khách vãng lai.
  - Không cho sửa số điện thoại trên web.
  - Xoá tài khoản và các trang ví voucher/yêu thích/đánh giá để đợt sau.
- **Đại lý:**
  - Hỏi CCCD sau bước duyệt sơ bộ, nếu quy định thuế cho phép.
  - Đơn sỉ tối thiểu 3 triệu. Miễn phí giao từ 5 triệu. Khoá mua chịu khi quá hạn.
- **Gian hàng:**
  - Sau khi cập nhật, mọi gian hàng CTV cũ mất tick "tuyển chọn" cho tới khi admin duyệt (đúng ý D3).
  - Gian hàng CTV do tài khoản ADMIN làm chủ vẫn hiện nhưng không có hoa hồng.
  - Người giới thiệu bị khoá tài khoản không được ghi công đơn mới; hoa hồng đã ghi giữ nguyên.
  - Gian hàng bị gỡ còn hiện tối đa ~5 phút trên web (bộ nhớ đệm trang).
  - Ảnh xem trước khi chia sẻ link gian hàng chỉ lấy ảnh từ Cloudinary và từ máy chủ API của Tubu (chống tấn công SSRF); ảnh để ở nơi khác bị bỏ khỏi thẻ chia sẻ.
  - Ảnh đại diện/ảnh bìa gian hàng mới phải là link `https://`.
  - Gian hàng CTV do ADMIN làm chủ: khách mua ở đó mà trước đó đã bấm link của một CTV khác (còn hạn) thì CTV đó được ghi công, như mọi đơn khác.
- **Phân quyền nhân viên:**
  - Khoản hoàn tiền của khách chưa chọn tài khoản nhận: chỉ ADMIN nhập tài khoản thay khách; kế toán chỉ chi các khoản đã có tài khoản.
  - Nội dung mẫu thông báo do nhân viên sửa không được chứa dãy từ 8 chữ số trở lên (chặn số tài khoản lạ) hay link ngoài tubutree/Zalo OA. Ngày viết đủ "31/12/2026" cũng bị chặn; cần ngày thì viết "31/12" hoặc nhờ ADMIN sửa.
  - Marketing không có quyền nhiệm vụ & quà đổi điểm, sự kiện cộng đồng có thưởng, nhãn hàng, báo cáo doanh thu.
  - Marketing sửa được nội dung 24 mẫu thông báo khuyến mãi (voucher, flash sale, giỏ bỏ quên, nhắc mua lại, nhắc đánh giá…). Mẫu đơn hàng/tiền và mẫu người thắng sự kiện chỉ ADMIN sửa.
  - Kế toán không xem danh sách đơn, dùng CSV ở tab Báo cáo.
  - Mọi nhân viên (cả marketing, kế toán) vẫn duyệt đổi vỏ chai và tích điểm tại quầy như trước.
- **Đơn hàng và Pancake:**
  - Lệch tổng tiền giữa Pancake và Tubu chỉ báo vào "Cần xử lý Pancake", không tự sửa đơn. Bấm "Đã xử lý" mà Pancake vẫn lệch thì lần webhook sau báo lại.
  - Điều kiện thanh toán của bậc đại lý (trả trước / công nợ n ngày) chỉ hiển thị, chưa chặn đơn.
- **Báo cáo:**
  - Doanh thu tính theo ngày đặt đơn.
  - "Khách mới" có tính tài khoản vãng lai.
  - CSV tài chính không che SĐT/MST/số tài khoản (chỉ ADMIN và kế toán tải được).
  - Phễu theo nguồn để sau.
- **Đo nguồn khách:** nhận mọi mã nguồn đúng khuôn. Thống nhất một cách viết khi in QR (vd `shopee`, `lazada`, `tiktok`, `oa`, `linkbio`).
- **Hạ tầng:**
  - Ảnh dùng Cloudinary gói miễn phí.
  - Bật Cloudflare proxy sau khi kiểm `mod_remoteip`.
  - Dùng chung VPS với ChoDeli, build ở CI.
  - API chạy không phải root: để sau ra mắt.
- **Giao diện:**
  - Nút "Chat Zalo OA" chỉ hiện khi đã cấu hình OA.
  - Nút "Thanh toán ngay" chỉ cho đơn chuyển khoản đang chờ, chưa quá hạn.
  - Kệ "Có thể bạn thích" là 4 sản phẩm bán chạy.

## Câu hỏi về sự thật (agent không tra được)

- Shop Shopee/Lazada/TikTok có nối vào cùng shop Pancake không? Nếu có, ghép đơn sàn để tích điểm làm được bằng tra Pancake.
- Lượng khách đồng thời dự kiến ở chiến dịch đầu? Trên ~300 thì chạy lại load test và cân nhắc nâng VPS.
- VPS có bao nhiêu vCPU? Máy nhiều lõi nên đặt `API_CPUS=2`.
- Có nhóm Zalo/fanpage/TikTok để dẫn khách vào cộng đồng không?
- AI tư vấn đã có khoá nhà cung cấp chưa? Có thì bật sau khi thử 20 câu hỏi thật.
- Kho gomdon "Fuwa3e Tubu HCM", Golf Park 1 đường số 2, P. Long Bình, TP Thủ Đức, 0965573541: có đúng không?

## Việc chủ dự án phải tự làm (agent không làm thay được)

1. DNS Cloudflare `api.`/`app.tubutree.com` → `14.225.207.177` (DNS-only), rồi chạy certbot.
2. Chọn nơi lưu backup ngoài VPS, cài cron backup, diễn tập khôi phục một lần.
3. Uptime monitor cho `api/health` và `app`.
4. Mở Cloudinary, đặt `VITE_CLOUDINARY_*`. Chưa có thì khách không đổi được ảnh đại diện; màn hình đã ghi rõ lý do.
5. Khoá bắt buộc: Pancake (API key, shop id, webhook secret), `ZALO_APP_ID/SECRET`, `THROTTLE_BYPASS_TOKEN` (≥ 32 ký tự), kênh cảnh báo `OPS_ALERT_*`. Web PROD: `NEXT_PUBLIC_ZALO_APP_ID` để hiện nút "Mở trên Zalo".
6. Admin → Cấu hình:
   - điền `app.miniapp_base_url` (link `https://zalo.me/s/<appId>`);
   - dán nội dung 4 khoá `legal.*`;
   - nhập % hoa hồng.
7. Nộp mẫu ZNS (Zalo duyệt 7–14 ngày).
8. Quét QR UAT trên Zalo thật. Kiểm riêng xem tham số `?src=`/`?claim=` trên link `zalo.me/s/...` có tới được app không, trước khi in thẻ hàng loạt.
9. Nội dung: FAQ, Academy (3 bài cho CTV), 10 bài cộng đồng khởi tạo, thêm câu hỏi quiz.
10. Sửa `hello.tubutree.com`: đưa mini-app lên đầu, kèm `?src=linkbio`.
11. Kiểm điều khoản Shopee/Lazada/TikTok Shop về thẻ trong hộp hàng trước khi in.
12. Điền 2 chỗ trống trong sổ tay vận hành: người phụ trách kỹ thuật, người phụ trách Pancake.
13. Đơn thử đầu tiên qua Pancake: sửa tay một món trên Pancake, xem "Cần xử lý Pancake" có báo lệch đúng không; mở thêm một đơn không sửa, xem có bị báo nhầm không. Repo chưa có payload webhook Pancake thật nên chưa biết chắc field tổng tiền. Báo nhầm hàng loạt thì tắt `pancake.total_mismatch_check` trong Cấu hình và gửi payload cho kỹ thuật.
