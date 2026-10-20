import { formatVnd } from './format-vnd';

export const LEGAL_SLUGS = ['dieu-khoan', 'bao-mat', 'doi-tra', 'van-chuyen'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export const LEGAL_PAGES: Record<LegalSlug, { title: string; footerLabel: string; description: string }> = {
  'dieu-khoan': {
    title: 'Điều khoản sử dụng',
    footerLabel: 'Điều khoản',
    description: 'Điều khoản khi mua hàng và sử dụng tài khoản trên Tubu Tree.',
  },
  'bao-mat': {
    title: 'Chính sách bảo mật',
    footerLabel: 'Bảo mật',
    description: 'Tubu Tree thu thập, dùng và bảo vệ thông tin cá nhân của bạn như thế nào.',
  },
  'doi-tra': {
    title: 'Chính sách đổi trả',
    footerLabel: 'Đổi trả',
    description: 'Điều kiện và cách đổi, trả hàng, hoàn tiền khi mua trên Tubu Tree.',
  },
  'van-chuyen': {
    title: 'Chính sách vận chuyển',
    footerLabel: 'Vận chuyển',
    description: 'Phí, thời gian và cách nhận hàng khi mua trên Tubu Tree.',
  },
};

export const LEGAL_DRAFT_NOTICE = 'BẢN NHÁP — chờ Tubu Tree duyệt';

/** Đường dẫn là input của người lạ: so sánh với danh sách, không tra bằng khoá đối tượng (tránh "constructor"). */
export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(value);
}

export interface LegalVars {
  returnWindowDays: number;
  freeshipThreshold: number;
}

export const DEFAULT_LEGAL_VARS: LegalVars = { returnWindowDays: 7, freeshipThreshold: 200000 };

interface Support {
  hotline: string;
  email: string;
}

function operator(support: Support): string {
  return [
    '- Đơn vị vận hành: [Tên công ty]',
    '- Mã số thuế: [Mã số thuế]',
    '- Địa chỉ: [Địa chỉ trụ sở]',
    `- Hotline: ${support.hotline}`,
    `- Email: ${support.email}`,
  ].join('\n');
}

function dieuKhoan(support: Support): string {
  return `## 1. Giới thiệu

Tubu Tree là nền tảng bán mỹ phẩm và đồ tiêu dùng thiên nhiên, do [Tên công ty] ("Tubu Tree", "chúng tôi") vận hành. Khi truy cập website, mini app Zalo hoặc đặt hàng, bạn đồng ý với các điều khoản dưới đây. Nếu không đồng ý, vui lòng ngừng sử dụng dịch vụ.

${operator(support)}

## 2. Tài khoản

- Bạn đăng nhập bằng tài khoản Zalo. Thông tin bạn cung cấp phải đúng và là của chính bạn.
- Bạn tự giữ an toàn cho tài khoản của mình. Hãy báo ngay cho chúng tôi nếu nghi ngờ bị người khác sử dụng.
- Chúng tôi có thể tạm khoá tài khoản có dấu hiệu gian lận hoặc vi phạm điều khoản này.

## 3. Đặt hàng và thanh toán

- Đơn hàng được xác nhận khi bạn nhận được thông báo xác nhận từ Tubu Tree. Chúng tôi có thể từ chối hoặc huỷ đơn khi hết hàng, sai giá rõ ràng hoặc có dấu hiệu gian lận, và hoàn lại số tiền bạn đã trả.
- Giá hiển thị là giá bán lẻ đã gồm thuế (nếu có), chưa gồm phí vận chuyển. Phí vận chuyển được hiển thị trước khi bạn bấm đặt hàng.
- Các cách thanh toán: thanh toán khi nhận hàng (COD), chuyển khoản ngân hàng (quét mã QR) và Ví Tubu. Cách khả dụng có thể khác nhau theo từng đơn và được hiển thị ở bước thanh toán.
- Với chuyển khoản, vui lòng ghi đúng nội dung chuyển khoản được hiển thị để đơn được ghi nhận nhanh.

## 4. Khuyến mãi, mã giảm giá và điểm thưởng

Mã giảm giá, Điểm Xanh và các ưu đãi khác áp dụng theo điều kiện hiển thị kèm theo từng chương trình (thời hạn, đơn tối thiểu, số lần dùng). Ưu đãi không có giá trị quy đổi thành tiền mặt trừ khi chương trình ghi rõ.

## 5. Giao hàng, đổi trả

Việc giao hàng và đổi trả thực hiện theo [Chính sách vận chuyển](/chinh-sach/van-chuyen) và [Chính sách đổi trả](/chinh-sach/doi-tra).

## 6. Bảo vệ thông tin cá nhân

Chúng tôi xử lý thông tin cá nhân của bạn theo [Chính sách bảo mật](/chinh-sach/bao-mat).

## 7. Nội dung và sở hữu trí tuệ

Hình ảnh, nội dung mô tả, nhãn hiệu và giao diện trên Tubu Tree thuộc về Tubu Tree hoặc các thương hiệu đối tác. Bạn không được sao chép, sử dụng cho mục đích thương mại khi chưa có sự đồng ý bằng văn bản.

## 8. Hành vi không được phép

- Cung cấp thông tin sai sự thật, mạo danh người khác.
- Can thiệp vào hệ thống, khai thác lỗi để trục lợi (ví dụ lạm dụng mã giảm giá, điểm thưởng).
- Đăng nội dung vi phạm pháp luật hoặc xúc phạm người khác trong phần đánh giá, cộng đồng.

## 9. Giới hạn trách nhiệm

Chúng tôi cố gắng để dịch vụ hoạt động ổn định nhưng không bảo đảm không gián đoạn. Trong phạm vi pháp luật cho phép, chúng tôi không chịu trách nhiệm về thiệt hại gián tiếp phát sinh từ việc gián đoạn dịch vụ ngoài tầm kiểm soát hợp lý. Điều này không ảnh hưởng đến quyền lợi của người tiêu dùng theo quy định pháp luật.

## 10. Thay đổi điều khoản

Chúng tôi có thể cập nhật điều khoản và sẽ đăng bản mới tại trang này. Việc bạn tiếp tục sử dụng dịch vụ sau khi bản mới có hiệu lực được hiểu là bạn đồng ý với thay đổi.

## 11. Luật áp dụng và giải quyết tranh chấp

Điều khoản này tuân theo pháp luật Việt Nam. Khi có tranh chấp, hai bên ưu tiên thương lượng; nếu không đạt được thoả thuận, tranh chấp được giải quyết tại Toà án có thẩm quyền theo quy định pháp luật.

## 12. Liên hệ

Mọi thắc mắc về điều khoản này, vui lòng liên hệ hotline ${support.hotline} hoặc email ${support.email}.`;
}

function baoMat(support: Support): string {
  return `## 1. Phạm vi

Chính sách này giải thích cách [Tên công ty] ("Tubu Tree") thu thập, sử dụng, chia sẻ và bảo vệ thông tin cá nhân của bạn khi dùng website và mini app Zalo của Tubu Tree.

${operator(support)}

## 2. Thông tin chúng tôi thu thập

- Thông tin tài khoản: tên hiển thị, mã định danh Zalo, số điện thoại, email (nếu bạn cung cấp).
- Thông tin giao hàng: họ tên người nhận, số điện thoại, địa chỉ nhận hàng.
- Thông tin đơn hàng và thanh toán: sản phẩm đã mua, giá trị đơn, phương thức thanh toán, trạng thái thanh toán. Chúng tôi không lưu số thẻ ngân hàng của bạn.
- Thông tin sử dụng: thiết bị, trình duyệt, các trang bạn xem và nguồn truy cập (ví dụ liên kết giới thiệu) để cải thiện dịch vụ và đối soát ưu đãi.

## 3. Mục đích sử dụng

- Xử lý đơn hàng, giao hàng, thanh toán, đổi trả và chăm sóc khách hàng.
- Vận hành tài khoản, điểm thưởng, mã giảm giá và chương trình giới thiệu.
- Gửi thông báo liên quan đến đơn hàng. Thông tin khuyến mãi chỉ gửi khi bạn đồng ý nhận.
- Phòng ngừa gian lận, bảo đảm an toàn hệ thống và tuân thủ quy định pháp luật.

## 4. Chia sẻ thông tin

Chúng tôi chỉ chia sẻ phần thông tin cần thiết cho các bên sau, và chỉ để thực hiện dịch vụ bạn yêu cầu:

- Đơn vị vận chuyển (họ tên, số điện thoại, địa chỉ nhận hàng).
- Ngân hàng, cổng thanh toán hoặc đối tác đối soát chuyển khoản.
- Nhà cung cấp hạ tầng, lưu trữ và công cụ vận hành làm việc theo hợp đồng bảo mật với chúng tôi.
- Cơ quan nhà nước có thẩm quyền khi có yêu cầu hợp pháp.

Chúng tôi không bán thông tin cá nhân của bạn.

## 5. Thời gian lưu trữ

Thông tin được lưu trong thời gian bạn còn sử dụng dịch vụ và thêm thời gian cần thiết để đáp ứng nghĩa vụ kế toán, thuế và giải quyết khiếu nại theo quy định pháp luật.

## 6. Bảo mật

Chúng tôi áp dụng các biện pháp kỹ thuật và quản lý hợp lý như mã hoá đường truyền, phân quyền truy cập và ghi nhật ký thao tác. Không có hệ thống nào an toàn tuyệt đối; nếu phát hiện sự cố ảnh hưởng đến bạn, chúng tôi sẽ thông báo theo quy định pháp luật.

## 7. Quyền của bạn

Theo quy định về bảo vệ dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP), bạn có quyền được biết, đồng ý hoặc rút lại sự đồng ý, truy cập, chỉnh sửa, yêu cầu xoá dữ liệu và khiếu nại. Bạn có thể tự sửa họ tên trong mục Tài khoản. Muốn đổi số điện thoại hoặc thực hiện các quyền còn lại, vui lòng gửi yêu cầu cho chúng tôi qua thông tin liên hệ bên dưới.

## 8. Cookie và công nghệ tương tự

Website dùng bộ nhớ trình duyệt và cookie cần thiết để giữ phiên đăng nhập, giỏ hàng và ghi nhận nguồn giới thiệu. Bạn có thể xoá chúng trong cài đặt trình duyệt, nhưng một số tính năng có thể không hoạt động.

## 9. Thay đổi chính sách

Khi cập nhật, chúng tôi sẽ đăng bản mới tại trang này. Xem thêm [Điều khoản sử dụng](/chinh-sach/dieu-khoan).

## 10. Liên hệ

Hotline ${support.hotline} hoặc email ${support.email}.`;
}

function doiTra(vars: LegalVars, support: Support): string {
  const days = vars.returnWindowDays;
  const window =
    days > 0
      ? `Bạn có thể yêu cầu đổi hoặc trả hàng trong vòng ${days} ngày kể từ khi đơn được giao thành công. Yêu cầu gửi ngay trong mục Đơn hàng của tài khoản.`
      : 'Hiện Tubu Tree chưa nhận yêu cầu đổi trả sau khi giao hàng thành công. Nếu sản phẩm có vấn đề khi nhận, vui lòng liên hệ ngay với chúng tôi qua thông tin ở cuối trang.';
  return `## 1. Thời hạn đổi trả

${window}

## 2. Trường hợp được chấp nhận

- Sản phẩm bị lỗi, hư hỏng, đổ vỡ hoặc hết hạn khi nhận hàng.
- Giao sai sản phẩm, sai phân loại hoặc thiếu hàng so với đơn.
- Sản phẩm không đúng mô tả đã đăng trên Tubu Tree.

## 3. Trường hợp không áp dụng

- Quá thời hạn nêu trên.
- Sản phẩm đã mở nắp hoặc đã sử dụng mà không phải do lỗi sản xuất hoặc vận chuyển, đặc biệt với mỹ phẩm và sản phẩm dùng trực tiếp lên da (vì lý do vệ sinh, an toàn).
- Sản phẩm bị hư hỏng do bảo quản hoặc sử dụng sai cách.
- Quà tặng kèm hoặc sản phẩm thuộc chương trình ghi rõ không đổi trả.

## 4. Cách yêu cầu đổi trả

1. Vào Tài khoản, chọn đơn hàng đã giao và bấm yêu cầu đổi trả.
2. Chụp ảnh sản phẩm, bao bì và tem nhãn; mô tả ngắn gọn lỗi gặp phải.
3. Tubu Tree xem xét và phản hồi. Nếu cần thêm thông tin, chúng tôi sẽ liên hệ qua số điện thoại của bạn.
4. Khi được chấp nhận, vui lòng giữ nguyên sản phẩm và bao bì để đơn vị vận chuyển đến lấy hoặc gửi lại theo hướng dẫn.

## 5. Hoàn tiền

- Tubu Tree hoàn tiền vào Ví Tubu hoặc tài khoản ngân hàng bạn chọn sau khi duyệt yêu cầu.
- Thời gian hoàn tiền: [số ngày làm việc] sau khi Tubu Tree nhận lại và kiểm tra sản phẩm.
- Điểm thưởng hoặc mã giảm giá đã dùng cho đơn được xử lý theo điều kiện của từng chương trình.

## 6. Chi phí vận chuyển đổi trả

Nếu lỗi thuộc về Tubu Tree hoặc đơn vị vận chuyển, Tubu Tree chịu phí vận chuyển đổi trả. Trường hợp khác, chi phí được thông báo trước khi bạn xác nhận.

Xem thêm [Chính sách vận chuyển](/chinh-sach/van-chuyen).

## 7. Liên hệ

${operator(support)}`;
}

function vanChuyen(vars: LegalVars, support: Support): string {
  const freeship =
    vars.freeshipThreshold > 0
      ? `Đơn từ ${formatVnd(vars.freeshipThreshold)} được miễn phí vận chuyển. Một số hạng thành viên hoặc chương trình có thể có ngưỡng miễn phí khác, được hiển thị ở giỏ hàng.`
      : 'Mọi đơn đều được miễn phí vận chuyển.';
  return `## 1. Phạm vi giao hàng

Tubu Tree giao hàng tới các khu vực mà đơn vị vận chuyển phục vụ. Nếu địa chỉ của bạn nằm ngoài vùng giao, hệ thống sẽ báo ở bước thanh toán.

## 2. Phí vận chuyển

- Phí vận chuyển được tính theo địa chỉ nhận hàng và khối lượng đơn, hiển thị trước khi bạn bấm đặt hàng.
- ${freeship}

## 3. Thời gian giao hàng dự kiến

- Nội thành: [số ngày] ngày làm việc.
- Tỉnh thành khác: [số ngày] ngày làm việc.
- Thời gian tính từ lúc đơn được xác nhận (với chuyển khoản là từ lúc Tubu Tree nhận được tiền) và không tính ngày lễ, ngày nghỉ. Đơn gặp thiên tai, dịch bệnh hoặc sự cố vận chuyển có thể lâu hơn dự kiến.

## 4. Nhận hàng và kiểm tra

- Vui lòng giữ điện thoại để nhân viên giao hàng liên hệ. Giao không thành công quá số lần quy định, đơn có thể bị hoàn về kho.
- Bạn nên kiểm tra tình trạng bên ngoài của kiện hàng khi nhận. Nếu thấy móp méo, rách hoặc ướt, hãy chụp ảnh (tốt nhất là quay video khi mở hàng) và liên hệ ngay với chúng tôi.

## 5. Thanh toán khi nhận hàng (COD)

Với đơn COD, bạn thanh toán cho nhân viên giao hàng khi nhận. Một số đơn có thể không áp dụng COD (ví dụ đơn giá trị cao), hệ thống sẽ báo ở bước thanh toán.

## 6. Theo dõi đơn hàng

Bạn xem trạng thái và mã vận đơn trong mục Đơn hàng của tài khoản.

## 7. Đổi trả

Điều kiện đổi trả xem tại [Chính sách đổi trả](/chinh-sach/doi-tra).

## 8. Liên hệ

${operator(support)}`;
}

/** Bản nháp dùng khi admin chưa nhập nội dung đã duyệt (SystemConfig legal.<loai>). */
export function defaultLegalContent(slug: LegalSlug, vars: LegalVars, support: Support): string {
  switch (slug) {
    case 'dieu-khoan':
      return dieuKhoan(support);
    case 'bao-mat':
      return baoMat(support);
    case 'doi-tra':
      return doiTra(vars, support);
    case 'van-chuyen':
      return vanChuyen(vars, support);
  }
}
