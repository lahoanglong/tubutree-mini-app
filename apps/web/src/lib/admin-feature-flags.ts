/**
 * Cờ bật/tắt tính năng hiện ở thẻ "Bật/tắt tính năng" của tab Cấu hình. `fallback` trùng giá trị mặc định ở API
 * khi khoá chưa có dòng trong DB (API chỉ coi đúng boolean `true` là bật).
 */
export interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  fallback: boolean;
  /** Hệ quả khi BẬT, hiện trong hộp xác nhận. */
  onWarning?: string;
  /** Hệ quả khi TẮT. Không có thì dùng câu chung "ngừng với khách ngay". */
  offWarning?: string;
  /** Cờ có điều kiện bật riêng ở một mục khác: thẻ chỉ hiện trạng thái và dẫn tới mục đó, không có công tắc. */
  manageIn?: { tab: 'supportChat'; label: string };
}

export const DEFAULT_OFF_WARNING = 'Tính năng ngừng với khách ngay. Dữ liệu đã có được giữ nguyên.';

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: 'loyalty.marketplace_claim_enabled',
    label: 'Khách nhập mã đơn sàn để nhận điểm',
    description: 'Khách gửi mã vận đơn của đơn mua trên Shopee, TikTok Shop... để nhận Điểm Xanh. Nên bật thêm "Tra đơn trên Pancake" để hệ thống tự tìm đơn. Duyệt ở mục Tích điểm đơn sàn.',
    fallback: false,
    onWarning: 'Khách bắt đầu gửi được mã đơn. Điểm chỉ cộng sau khi đơn giao thành công và qua số ngày đối soát; đơn giá trị lớn chờ nhân viên duyệt. Chỉ bật khi Pancake đã gửi đơn về Tubu thành công.',
    offWarning: 'Khách không gửi được mã đơn mới. Các mã đã gửi và đang chờ cộng điểm sẽ đứng yên: chưa cộng, không bị mất, và chạy tiếp khi bạn bật lại. Dữ liệu đã có được giữ nguyên.',
  },
  {
    key: 'pancake.external_lookup_enabled',
    label: 'Tra đơn trên Pancake khi khách nhập mã',
    description: 'Khi mã khách nhập chưa có trong sổ, hệ thống hỏi Pancake để tìm đơn. Chỉ chạy khi đã cài khoá kết nối Pancake.',
    fallback: false,
    onWarning: 'Hệ thống bắt đầu hỏi Pancake mỗi khi khách nhập mã chưa có trong sổ. Chỉ bật khi đã thử và Pancake tìm được đơn theo mã vận đơn.',
  },
  {
    key: 'pancake.external_poll_enabled',
    label: 'Tự kéo đơn sàn từ Pancake định kỳ',
    description: 'Kéo bù các đơn sàn và đơn chat bị lỡ khi Pancake gửi báo. Chỉ chạy khi đã cài khoá kết nối Pancake.',
    fallback: false,
    onWarning: 'Hệ thống bắt đầu kéo đơn từ Pancake mỗi 10 phút. Điểm vẫn chỉ cộng sau khi đơn giao thành công và qua số ngày đối soát. Chỉ bật khi Pancake đã gửi đơn về Tubu thành công và bạn đã thử kéo thử thấy đúng đơn.',
  },
  {
    key: 'loyalty.chat_order_points_enabled',
    label: 'Tích điểm cho đơn chốt qua chat hoặc điện thoại',
    description: 'Đơn nhân viên chốt trên Pancake được cộng Điểm Xanh cho khách sau khi giao thành công. Cần có SĐT khách và mã vận đơn.',
    fallback: false,
    onWarning: 'Các đơn chốt qua chat bắt đầu được ghi nhận để tích điểm. Điểm chỉ cộng sau khi đơn giao thành công và qua số ngày đối soát. Chỉ bật khi Pancake đã gửi đơn về Tubu thành công và đã khai báo nguồn đơn chat.',
  },
  {
    key: 'loyalty.pos_credit_enabled',
    label: 'Tích điểm tại quầy',
    description: 'Nhân viên thu ngân cộng Điểm Xanh cho thành viên ở màn thu ngân. Hạn mức ngày chỉnh ở thẻ Tích điểm bên dưới.',
    fallback: false,
    onWarning: 'Thu ngân bắt đầu cộng điểm cho thành viên ngay.',
  },
  {
    key: 'waste.enabled',
    label: 'Đổi rác lấy quà',
    description: 'Khách tạo yêu cầu đổi rác, điểm nhận rác của đại lý hoạt động. Từng cách giao (mang tới điểm, gửi kho, thu kèm đơn) bật riêng ở Đổi rác và game, Đổi rác, Cấu hình chung.',
    fallback: false,
    onWarning: 'Mini App và web hiện chương trình cho khách.',
  },
  {
    key: 'chat.enabled',
    label: 'Cho khách chat với cửa hàng',
    description: 'Tin khách gửi được chuyển vào nhóm Zalo qua cầu nối. Chỉ bật được khi cầu nối đang kết nối và đã chọn nhóm nhận tin, nên công tắc nằm ở mục Chat CSKH.',
    fallback: false,
    manageIn: { tab: 'supportChat', label: 'Bật/tắt ở Chat CSKH' },
  },
  {
    key: 'storefront.require_approval',
    label: 'Bắt duyệt gian hàng CTV trước khi hiện',
    description: 'Bật: gian hàng CTV mới chỉ hiện với khách sau khi bạn duyệt ở mục Gian hàng. Tắt: hiện ngay khi CTV đăng, chỉ gian hàng đã duyệt mới có dấu tick xanh.',
    fallback: true,
    onWarning: 'Gian hàng CTV chưa được duyệt sẽ bị ẩn khỏi khách ngay, kể cả gian hàng đang hiện. Gian hàng hiện lại sau khi bạn duyệt ở mục Gian hàng.',
    offWarning: 'Mọi gian hàng CTV đã đăng mà chưa duyệt sẽ hiện công khai ngay, không cần bạn duyệt. Chỉ gian hàng đã duyệt mới có dấu tick xanh.',
  },
  {
    key: 'community.public_preview',
    label: 'Cho khách chưa đăng nhập xem thử Cộng đồng',
    description: 'Khách chưa đăng nhập thấy vài bài mới nhất do người dùng viết (tối đa 5 bài). Tắt: phải đăng nhập mới xem được.',
    fallback: true,
    offWarning: 'Khách chưa đăng nhập không còn thấy bài nào, phải đăng nhập mới xem được Cộng đồng.',
  },
  {
    key: 'web.guest_cart_enabled',
    label: 'Giỏ hàng cho khách chưa đăng nhập trên web',
    description: 'Khách chưa đăng nhập trên website thêm được món vào giỏ và xem giỏ (giá, tạm tính, Miễn phí giao hàng). Đặt hàng vẫn phải đăng nhập; đăng nhập xong các món tự chuyển vào giỏ tài khoản. Mini App không đổi.',
    fallback: false,
    onWarning: 'Khách chưa đăng nhập trên web bấm Thêm vào giỏ hay Mua ngay sẽ vào giỏ ngay, không bị đưa sang trang đăng nhập.',
    offWarning: 'Khách chưa đăng nhập bấm mua lại bị đưa sang trang đăng nhập như trước. Món khách đã chọn vẫn nằm trong trình duyệt của họ và hiện lại khi bạn bật lại.',
  },
  {
    key: 'perf.rum_enabled',
    label: 'Đo tốc độ trên máy khách',
    description: 'Mini App và web gửi số đo tốc độ của từng lượt xem trang (thời gian hiện nội dung chính, độ nhảy bố cục, độ trễ khi bấm; Mini App thêm thời gian tới màn đầu bấm được), mỗi lượt một gói, theo tỉ lệ ở "perf.rum_sample_pct". Chỉ ghi mẫu trang và cỡ màn hình, không ghi đường dẫn thật hay mã khách. Kết quả ở thẻ Tốc độ trên máy khách (tab Vận hành).',
    fallback: false,
    onWarning: 'Máy khách bắt đầu gửi số đo. Web nhận cờ mới chậm tối đa khoảng 1 giờ (bộ nhớ đệm cấu hình của trang); Mini App nhận ở lần mở Trang chủ kế tiếp.',
    offWarning: 'Máy khách ngừng gửi và máy chủ bỏ mọi số đo đến sau đó. Số đo đã ghi được giữ 90 ngày rồi tự xoá.',
  },
  {
    key: 'catalog.pdp_compare_enabled',
    label: 'Bảng "So với món tương tự" trên trang sản phẩm',
    description: 'Trang sản phẩm (Mini App và web) hiện bảng so tối đa 2 món cùng phân khúc và cùng loại hàng theo tên, còn hàng: giá, dung tích, giá trên 100ml hoặc 100g và thành phần chính. Không có món nào để so thì bảng tự ẩn.',
    fallback: false,
    onWarning: 'Khách thấy bảng so sánh trên trang sản phẩm có món để so. Món được chọn và giá trên 100ml/100g tính tự động từ tên sản phẩm và tên phân loại; số liệu cập nhật chậm tối đa khoảng 15 phút.',
    offWarning: 'Bảng so sánh biến mất khỏi trang sản phẩm trong vòng khoảng 10 phút. Không dữ liệu nào bị xoá.',
  },
  {
    key: 'catalog.unit_price_enabled',
    label: 'Giá theo đơn vị và cỡ lợi hơn trên trang sản phẩm',
    description: 'Trang sản phẩm (Mini App và web) ghi giá theo 100ml, 100g hay theo món dưới giá và trong chip từng cỡ; cỡ còn hàng rẻ nhất (rẻ hơn cỡ đang chọn từ 5%) có nhãn "Lợi hơn X% mỗi 100ml". Lượng đọc từ tên phân loại; sản phẩm có một phân loại không đọc chắc thì không hiện gì.',
    fallback: false,
    onWarning: 'Khách thấy giá theo đơn vị trên trang sản phẩm. Lượng tính tự động từ tên phân loại (tên phân loại không ghi lượng thì lấy ở tên sản phẩm, chỉ khi các phân loại cùng giá), nên đổi tên phân loại khác giá (ví dụ "500ml" thành "Chai lớn") làm dòng này biến mất ở sản phẩm đó.',
    offWarning: 'Giá theo đơn vị và nhãn "Lợi hơn" biến mất khỏi trang sản phẩm trong vòng khoảng 5 phút. Không dữ liệu nào bị xoá.',
  },
  {
    key: 'shipping.pdp_eta_enabled',
    label: 'Ngày nhận dự kiến và phần còn thiếu để Miễn phí giao hàng trên trang sản phẩm',
    description: 'Dòng Vận chuyển ở trang sản phẩm (Mini App và web) ghi "Dự kiến nhận T6 20/11 – T3 24/11 · Đặt trước 15:00 giao sớm hơn" theo lịch kho (chỉ hàng kho Tubu còn hàng), thanh toán tính ngày theo cùng lịch và tỉnh của địa chỉ (TP.HCM hay tỉnh khác), và câu "Món này + … là miễn phí giao" theo giỏ của khách cộng món đang xem.',
    fallback: false,
    onWarning: 'Ngày tính theo "shipping.warehouse_schedule": cắt đơn 15:00 Thứ 2 – Thứ 7, nghỉ Chủ nhật và ngày lễ trong danh sách, TP.HCM 1–2 và tỉnh khác 2–4 ngày làm việc. Thêm ngày nghỉ lễ vào khoá đó trước dịp lễ. Chi tiết đơn vẫn dùng "shipping.eta_min_days" và "shipping.eta_max_days".',
    offWarning: 'Dòng Vận chuyển về lại câu Miễn phí giao hàng cố định như trước (trong vòng khoảng 5 phút). Không dữ liệu nào bị xoá.',
  },
  {
    key: 'mss.payment_rescue_cancel_enabled',
    label: 'Huỷ đơn chuyển khoản khi MSS báo quá hạn',
    description: 'MSS nhắc khách chuyển khoản và báo Tubu khi đơn quá hạn. Bật thì Tubu huỷ ngay đơn chuyển khoản còn chờ tiền, chưa có khoản nào về và đã qua hạn thanh toán ghi cho khách (mặc định 24 giờ): hoàn kho, mã giảm giá, Điểm Xanh và báo khách một lần như cron tự huỷ.',
    fallback: false,
    onWarning: 'Tin của MSS không huỷ đơn đã trả, đã xác nhận, COD hay chưa tới hạn. Đơn khách chuyển một phần thì tin này bỏ qua, nhưng cron tự huỷ vẫn huỷ ở hạn và ghi hoàn số đã nhận như trước. MSS chỉ gửi tin khi bên MSS đã bật nhắc chuyển khoản.',
    offWarning: 'Tubu bỏ qua tin quá hạn của MSS; cron tự huỷ vẫn huỷ đơn quá hạn mỗi 10 phút như trước.',
  },
  {
    key: 'orders.timeline_v2_enabled',
    label: 'Một dòng thời gian ở chi tiết đơn',
    description: 'Chi tiết đơn (Mini App và web) gộp thanh tiến trình và khối hành trình thành một: 4 bước kèm giờ, ngày giao dự kiến, mốc hãng vận chuyển gập dưới "Đang giao hàng", dòng "Đã báo qua Zalo" khi tin hành trình đã tới khách.',
    fallback: false,
    onWarning: 'Khách mở chi tiết đơn chỉ còn một dòng thời gian. Đơn đang giao quá số giờ ở "orders.tracking_stale_hours" mà hãng không có mốc mới thì ghi "Đang chờ hãng vận chuyển cập nhật".',
    offWarning: 'Chi tiết đơn về lại hai khối cũ (thanh tiến trình và hành trình 5 bước). Không dữ liệu nào bị xoá.',
  },
  {
    key: 'referral.share_card_enabled',
    label: 'Trang đích link "Mời bạn sống xanh"',
    description: 'Link mời trong khối "Mời bạn sống xanh" trỏ tubutree.com/moi/<mã>: lời chào chung, quà cho bạn mới, ảnh xem trước riêng, nút "Bắt đầu mua sắm". Khối mời hiện thêm tiến độ: số bạn đã nhận mã, đã mua đơn đầu, đã đủ điều kiện. Không đổi thưởng.',
    fallback: false,
    onWarning: 'Link mời mới khách chép hay chia sẻ từ lúc này trỏ trang đích. Link cũ (/?ref=) vẫn chạy.',
    offWarning: 'Trang đích /moi/<mã> trả "Không tìm thấy", khối mời về lại link cũ. Link trang đích đã gửi đi sẽ không mở được tới khi bật lại.',
  },
  {
    key: 'catalog.restock_alert_enabled',
    label: 'Nút "Báo tôi khi có hàng" trên trang sản phẩm',
    description: 'Biến thể hết hàng: nút chính đổi từ "Tạm hết hàng" thành "Báo tôi khi có hàng". Hàng về thì mỗi khách đã bấm nhận đúng một tin, tối đa 100 tin mỗi phút.',
    fallback: false,
    onWarning: 'Khách thấy nút "Báo tôi khi có hàng" ở mọi biến thể hết hàng, trên Mini App và web. Hàng về là tin được gửi.',
    offWarning: 'Nút về lại "Tạm hết hàng" màu xám và không gửi tin hàng về nữa. Đăng ký khách đã bấm vẫn được giữ, bật lại thì gửi tiếp.',
  },
  {
    key: 'catalog.pancake_ignore_zero_stock',
    label: 'Giữ tồn Tubu khi Pancake báo 0',
    description: 'Pancake báo tồn 0 cho một phân loại mà Tubu còn hàng thì Tubu giữ nguyên số tồn đang có, chỉ ghi số 0 của Pancake để màn đối chiếu tồn thấy chỗ lệch. Áp cho đồng bộ 15 phút, nút đồng bộ ghi đè tồn kho, webhook tồn kho của Pancake và tồn MSS đẩy sang. Pancake báo số lớn hơn 0 thì Tubu lấy số đó trừ phần đơn app đang giữ như thường; đơn app vẫn trừ tồn Tubu.',
    fallback: false,
    onWarning: 'Chỉ bật khi kho Pancake chưa nhập đủ hàng mà hàng thật vẫn có ở kho. Khách đặt được tới hết số tồn Tubu đang ghi, kể cả khi Pancake báo hết: kiểm hàng thật trước khi bật. Áp từ lượt đồng bộ kế tiếp (tối đa khoảng 15 phút).',
    offWarning: 'Từ lượt đồng bộ kế tiếp, Pancake báo 0 là phân loại hết hàng trên Tubu như trước. Không dữ liệu nào bị xoá.',
  },
  {
    key: 'catalog.search_fuzzy_enabled',
    label: 'Ô tìm chịu gõ sai',
    description: 'Khách gõ sai chính tả hay gõ dính ("nuoc gait", "nuocgiat") vẫn ra hàng, kèm dòng "Đang hiện kết quả cho …". Từ đồng nghĩa ("nước rửa bát" ra "nước rửa chén") sửa ở /admin/tu-khoa-tim. Chỉ chạy khi tìm chính xác ra dưới 3 món.',
    fallback: false,
    onWarning: 'Từ khoá ra ít hàng sẽ có thêm món gần đúng. Kết quả cập nhật chậm tối đa khoảng 5 phút.',
    offWarning: 'Ô tìm về khớp chính xác như trước; từ đồng nghĩa không còn tác dụng. Không dữ liệu nào bị xoá.',
  },
  {
    key: 'catalog.search_popular_enabled',
    label: 'Hàng "Tìm phổ biến" ở ô tìm',
    description: 'Ô tìm trống (Mini App và web) hiện tối đa 8 cụm khách hay tìm trong 14 ngày (mỗi cụm từ 3 người trở lên, bỏ cụm có số điện thoại hay email). Chưa đủ 4 cụm thì bù bằng danh sách dự phòng ở /admin/tu-khoa-tim.',
    fallback: false,
    onWarning: 'Khách bấm vào ô tìm thấy một hàng chip từ khoá. Danh sách tính lại mỗi giờ.',
    offWarning: 'Hàng chip biến mất khỏi ô tìm trong vòng khoảng 1 giờ (bộ đệm). Không dữ liệu nào bị xoá.',
  },
  {
    key: 'reviews.green_corner_enabled',
    label: 'Góc Sống Xanh: đánh giá ảnh có duyệt',
    description:
      'Đánh giá có ảnh của khách chờ duyệt ở tab Đánh giá (chip "Chờ duyệt") rồi mới hiện. Duyệt xong khách được cộng reviews.photo_reward_points Điểm Xanh (mặc định 100), mỗi khách tối đa reviews.photo_reward_daily_cap đánh giá được cộng cho các đánh giá viết cùng ngày. Trang chủ hiện dải "Khách hàng sống xanh cùng Tubu Tree" khi có từ 3 đánh giá ảnh đã duyệt.',
    fallback: false,
    onWarning:
      'Chỉ bật khi Mini App bản có Góc Sống Xanh đã lên Zalo: bản cũ cho chọn 5 ảnh (máy chủ từ chối quá 3), báo đánh giá chờ duyệt là "đã ẩn" và vẫn hứa thưởng lúc gửi. Bảng thưởng cũ lúc gửi (5.000 / 10.000 / 15.000 điểm) ngừng hẳn. Đánh giá có ảnh mới chỉ hiện sau khi được duyệt; đánh giá chỉ chữ vẫn hiện ngay nhưng không còn được cộng điểm.',
    offWarning:
      'Đánh giá mới về lại bảng thưởng cũ lúc gửi và hiện ngay. Đánh giá đang chờ vẫn nằm ở chip "Chờ duyệt", duyệt vẫn cộng điểm như đã báo khách. Dải ở Trang chủ ẩn.',
  },
  {
    key: 'checkout.return_packaging_nudge_enabled',
    label: 'Gợi ý gửi lại bao bì từ đơn đã giao',
    description:
      'Thẻ "Đổi rác kèm đơn" ở thanh toán (Mini App và web) điền sẵn thùng carton và vỏ chai/hộp Tubu Tree của các đơn đã giao tới cùng địa chỉ trong 60 ngày. Đủ ngưỡng điểm thì một chạm là gửi kèm đơn, miễn phí giao kiện Tubu. Chi tiết đơn đã giao nêu đúng bao bì của đơn.',
    fallback: false,
    onWarning: 'Thẻ đổi rác ở thanh toán sẽ tải danh sách món ngay khi mở trang và có thể bật một chạm. Điểm Xanh vẫn chỉ cộng khi kho kiểm nhận.',
    offWarning: 'Thẻ đổi rác về lại như cũ: khách tự mở ngăn và chọn món. Phiếu đã gửi kèm đơn không bị ảnh hưởng.',
  },
  {
    key: 'commerce.freeship_booster_enabled',
    label: 'Dải "Thêm 1 món nhỏ để đủ Miễn phí giao hàng" ở giỏ',
    description: 'Giỏ hàng (Mini App và web) chưa đủ mức Miễn phí giao hàng: dải gợi ý chọn món Tubu giao còn hàng, chưa có trong giỏ, giá từ số còn thiếu tới số còn thiếu + 45.000đ, bán chạy 30 ngày trước. Mỗi món một chạm "+ Thêm", không rời giỏ.',
    fallback: false,
    onWarning: 'Dải gợi ý ở giỏ đổi tiêu đề và đổi món theo số tiền còn thiếu của từng giỏ. Danh sách món cập nhật chậm tối đa khoảng 30 giây.',
    offWarning: 'Dải gợi ý về lại món lấy từ kệ Bán chạy nhất như trước (trong vòng khoảng 5 phút). Không dữ liệu nào bị xoá.',
  },
  {
    key: 'notify.proactive_cap_enabled',
    label: 'Trần tin nhắc chủ động mỗi khách',
    description: 'Tin nhắc qua Zalo (ZNS) như nhắc giỏ, mua lại, điểm sắp hết hạn, nhắc chuỗi, hàng về, khuyến mãi: tối đa 1 tin mỗi ngày và 4 tin mỗi tuần cho mỗi khách. Tin đơn hàng, thanh toán, đổi trả, đổi rác không bao giờ bị chặn. Tin trong app vẫn đủ.',
    fallback: false,
    onWarning: 'Tin nhắc vượt trần chỉ còn nằm trong app, không gửi qua Zalo. Nhiều tin cùng ngày thì tin hàng về và giỏ bỏ quên được ưu tiên.',
    offWarning: 'Tin nhắc qua Zalo gửi như trước, không giới hạn số tin mỗi ngày (vẫn giữ trần 2 tin khuyến mãi mỗi tháng).',
  },
  {
    key: 'eco.product_badges_enabled',
    label: 'Nhãn xanh có nguồn trên thẻ và trang sản phẩm',
    description:
      'Thẻ sản phẩm (Mini App và web) mang tối đa 1 nhãn xanh (Can refill, Giảm ~g nhựa, Trả vỏ đổi điểm) và trang sản phẩm có khối "Điểm cộng xanh" kèm link Nguồn. Chỉ sự thật đã duyệt ở /admin/su-that-xanh mới hiện. Mặc định TẮT: giữ tắt tới khi khối lượng bao bì đã được cân trên hàng thật.',
    fallback: false,
    onWarning:
      'Chỉ bật khi số gram nhựa của từng sự thật đã duyệt được cân trên bao bì thật, không dùng số ước. Thẻ và trang sản phẩm đổi theo trong vòng vài phút (bộ đệm trang); thẻ tác động xanh của đơn cũng bắt đầu tính nhựa bớt theo các sự thật này.',
    offWarning: 'Nhãn xanh và khối "Điểm cộng xanh" biến mất khỏi thẻ và trang sản phẩm; thẻ tác động xanh của đơn thôi tính nhựa bớt. Sự thật đã duyệt được giữ nguyên.',
  },
  {
    key: 'retention.refill_21d_reminder_enabled',
    label: 'Nhắc châm lại bằng gói Refill sau 21 ngày',
    description:
      'Mỗi sáng 9:30: khách nhận một chai có gói Refill ghép cặp từ 21 tới 28 ngày trước được một tin trong app mở thẳng trang gói Refill. Mỗi đơn nhắc tối đa một lần, mỗi khách tối đa một tin mỗi 7 ngày. Bỏ qua khách đã đặt lại gói Refill đó, đã trả chai, đã tắt tin khuyến mãi hay MSS báo từ chối tin.',
    fallback: false,
    onWarning: 'Khách bắt đầu nhận tin từ lượt 9:30 kế tiếp (sáng nay nếu chưa tới 9:30, không thì sáng mai). Chỉ đơn giao trong 21–28 ngày gần nhất, không nhắc lại đơn cũ hơn. Chai đã được nhắc ở đây thì tin "Nhắc mua lại" 30 ngày bỏ chu kỳ đó.',
    offWarning: 'Ngừng nhắc từ lượt sau. Tin đã gửi vẫn nằm trong chuông thông báo của khách.',
  },
  {
    key: 'retention.refill_21d_zns_enabled',
    label: 'Gửi tin nhắc Refill 21 ngày qua Zalo (ZNS)',
    description:
      'Khi bật, tin nhắc Refill 21 ngày gửi thêm qua Zalo nếu mẫu REORDER_REMINDER_REFILL đã gắn mã mẫu ZNS được Zalo duyệt. Tắt thì tin chỉ nằm trong app.',
    fallback: false,
    onWarning: 'Mỗi tin qua Zalo tốn phí ZNS và tính vào trần 2 tin khuyến mãi mỗi tháng cùng trần tin chủ động mỗi ngày/tuần. Chỉ bật khi mẫu đã có mã ZNS được duyệt.',
    offWarning: 'Tin nhắc Refill chỉ còn trong app, không gửi qua Zalo.',
  },
];
