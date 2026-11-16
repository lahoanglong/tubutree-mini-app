const formatVnd = (n: number): string => `${n.toLocaleString('vi-VN')}đ`;

export const LEGAL_SLUGS = ['dieu-khoan', 'bao-mat', 'doi-tra', 'van-chuyen', 'thanh-toan'] as const;
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
  'thanh-toan': {
    title: 'Chính sách và hình thức thanh toán',
    footerLabel: 'Thanh toán',
    description: 'Các hình thức thanh toán, hoàn tiền và bảo mật giao dịch khi mua trên Tubu Tree.',
  },
};

/** Thông tin thương nhân theo Giấy chứng nhận đăng ký doanh nghiệp, dùng khi cấu hình company.* chưa có gì. */
export const TUBU_TREE_MERCHANT = {
  legalName: 'CÔNG TY TNHH TUBU TREE',
  taxCode: '0319585995',
  address: 'Số 33, đường 1B, phường Long Bình, Thành phố Hồ Chí Minh',
} as const;

export interface MerchantIdentityInput {
  legalName?: string | null;
  taxCode?: string | null;
  address?: string | null;
}

/**
 * Admin đã nhập bất kỳ trường nào của company.* thì giữ nguyên đúng những gì họ nhập (không trộn với mặc định, tránh ghép
 * tên công ty này với MST công ty khác); chưa nhập gì thì hiện thông tin thương nhân đã đăng ký của Tubu Tree.
 */
export function merchantIdentityOrDefault(company?: MerchantIdentityInput | null): { legalName?: string; taxCode?: string; address?: string } {
  const clean = (v?: string | null) => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
  const own = { legalName: clean(company?.legalName), taxCode: clean(company?.taxCode), address: clean(company?.address) };
  return own.legalName || own.taxCode || own.address ? own : { ...TUBU_TREE_MERCHANT };
}

export interface CompanyRegistrationInput {
  representative?: string | null;
  registrationNumber?: string | null;
  registrationDate?: string | null;
  registrationPlace?: string | null;
}

/**
 * Ngày cấp ĐKDN: nhận dd/mm/yyyy, d/m/yyyy hoặc yyyy-mm-dd, trả dd/mm/yyyy; ngày không có trên lịch, trước 1990 hoặc ở tương lai là null.
 * Cùng luật với `registrationDate` ở company-config.ts của API (API không phụ thuộc app-core); form admin dùng nó để chặn lưu ngày API sẽ bỏ.
 */
export function normalizeRegistrationDate(value: unknown, now: Date = new Date()): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const [d, m, y] = vn ? [Number(vn[1]), Number(vn[2]), Number(vn[3])] : iso ? [Number(iso[3]), Number(iso[2]), Number(iso[1])] : [NaN, NaN, NaN];
  if (!Number.isInteger(d) || y < 1990) return null;
  const at = new Date(Date.UTC(y, m - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null;
  if (at.getTime() > now.getTime() + 24 * 3_600_000) return null;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

const filled = (v?: string | null): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * Dòng hồ sơ pháp lý ở chân trang web và trang Về Tubu Tree: "Người đại diện theo pháp luật: X · Giấy chứng nhận đăng ký doanh nghiệp số N
 * do P cấp ngày D". Chỉ nêu phần admin đã nhập (không suy ra số ĐKDN từ MST, không điền mặc định); chưa nhập gì thì null để ẩn cả dòng.
 */
export function companyLegalLine(company?: CompanyRegistrationInput | null): string | null {
  const representative = filled(company?.representative);
  const number = filled(company?.registrationNumber);
  const date = filled(company?.registrationDate);
  const place = filled(company?.registrationPlace);
  const parts: string[] = [];
  if (representative) parts.push(`Người đại diện theo pháp luật: ${representative}`);
  if (number || date || place) {
    let reg = 'Giấy chứng nhận đăng ký doanh nghiệp';
    if (number) reg += ` số ${number}`;
    if (place && date) reg += ` do ${place} cấp ngày ${date}`;
    else if (place) reg += ` do ${place} cấp`;
    else if (date) reg += `${number ? ',' : ''} cấp ngày ${date}`;
    parts.push(reg);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Link huy hiệu "Đã thông báo Bộ Công Thương" chỉ hợp lệ khi là https tới cổng online.gov.vn hoặc một tên miền *.gov.vn. */
export function isBctNoticeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value || value === '' || value.length > 500) return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  return u.hostname === 'online.gov.vn' || u.hostname.endsWith('.gov.vn');
}

export const LEGAL_DRAFT_NOTICE = 'BẢN NHÁP — chờ Tubu Tree duyệt';

/** Đường dẫn là input của người lạ: so sánh với danh sách, không tra bằng khoá đối tượng (tránh "constructor"). */
export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(value);
}

export interface LegalVars {
  returnWindowDays: number;
  freeshipThreshold: number;
  /** Phí giao cố định cho đơn dưới ngưỡng freeship (shipping.flat_fee_below_threshold). */
  shippingFlatFee?: number;
  /** Đơn vị vận hành (company.*); chưa nhập thì không có trường và bản nháp giữ chỗ [ ] để điền. */
  legalName?: string;
  taxCode?: string;
  address?: string;
}

export const DEFAULT_LEGAL_SUPPORT: LegalSupport = { hotline: '0984 606 774', email: 'tubutree@gmail.com' };

export const DEFAULT_LEGAL_VARS: LegalVars = { returnWindowDays: 7, freeshipThreshold: 199000, shippingFlatFee: 19000 };

const DEFAULT_SHIPPING_FLAT_FEE = 19000;

/** Mốc hoàn tiền chung của chính sách đổi trả và thanh toán. */
const REFUND_WORKING_DAYS = 7;

export interface LegalSupport {
  hotline: string;
  email: string;
}

const companyName = (vars: LegalVars) => vars.legalName ?? '[Tên công ty]';

function operator(support: LegalSupport, vars: LegalVars): string {
  return [
    `- Đơn vị vận hành: ${companyName(vars)}`,
    `- Mã số thuế: ${vars.taxCode ?? '[Mã số thuế]'}`,
    `- Địa chỉ: ${vars.address ?? '[Địa chỉ trụ sở]'}`,
    `- Hotline: ${support.hotline}`,
    `- Email: ${support.email}`,
  ].join('\n');
}

/** Câu "thời hạn báo" của mục kiểm hàng, dùng chung cho đổi trả và vận chuyển để hai trang không nói lệch nhau. */
function inspectionDeadlineText(days: number): string {
  return days > 0
    ? `Thời hạn báo: nếu hàng có vấn đề, bạn báo cho Tubu Tree trong vòng ${days} ngày kể từ khi đơn được giao thành công, kèm ảnh hoặc video.`
    : 'Thời hạn báo: Tubu Tree chưa nhận yêu cầu đổi trả sau khi giao thành công, vì vậy hãy kiểm tra và báo ngay tại thời điểm nhận hàng, kèm ảnh hoặc video.';
}

function dieuKhoan(vars: LegalVars, support: LegalSupport): string {
  return `## 1. Giới thiệu

Tubu Tree là nền tảng bán mỹ phẩm và đồ tiêu dùng thiên nhiên, do ${companyName(vars)} ("Tubu Tree", "chúng tôi") vận hành. Khi truy cập website, mini app Zalo hoặc đặt hàng, bạn đồng ý với các điều khoản dưới đây. Nếu không đồng ý, vui lòng ngừng sử dụng dịch vụ.

${operator(support, vars)}

## 2. Tài khoản

- Bạn đăng nhập bằng tài khoản Zalo. Thông tin bạn cung cấp phải đúng và là của chính bạn.
- Bạn tự giữ an toàn cho tài khoản của mình. Hãy báo ngay cho chúng tôi nếu nghi ngờ bị người khác sử dụng.
- Chúng tôi có thể tạm khoá tài khoản có dấu hiệu gian lận hoặc vi phạm điều khoản này.

## 3. Đặt hàng và thanh toán

- Đơn hàng được xác nhận khi bạn nhận được thông báo xác nhận từ Tubu Tree. Chúng tôi có thể từ chối hoặc huỷ đơn khi hết hàng, sai giá rõ ràng hoặc có dấu hiệu gian lận, và hoàn lại số tiền bạn đã trả.
- Giá hiển thị là giá bán lẻ đã gồm thuế (nếu có), chưa gồm phí vận chuyển. Phí vận chuyển được hiển thị trước khi bạn bấm đặt hàng.
- Các cách thanh toán: thanh toán khi nhận hàng (COD), chuyển khoản ngân hàng (quét mã QR) và Ví Tubu. Cách khả dụng có thể khác nhau theo từng đơn và được hiển thị ở bước thanh toán.
- Với chuyển khoản, vui lòng ghi đúng nội dung chuyển khoản được hiển thị để đơn được ghi nhận nhanh.
- Chi tiết hình thức thanh toán, hoàn tiền và bảo mật giao dịch xem tại [Chính sách và hình thức thanh toán](/chinh-sach/thanh-toan).

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

function baoMat(vars: LegalVars, support: LegalSupport): string {
  return `## 1. Phạm vi

Chính sách này giải thích cách ${companyName(vars)} ("Tubu Tree") thu thập, sử dụng, chia sẻ và bảo vệ thông tin cá nhân của bạn khi dùng website và mini app Zalo của Tubu Tree.

${operator(support, vars)}

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

function doiTra(vars: LegalVars, support: LegalSupport): string {
  const days = vars.returnWindowDays;
  const window =
    days > 0
      ? `Bạn có thể yêu cầu đổi hoặc trả hàng trong vòng ${days} ngày kể từ khi đơn được giao thành công. Yêu cầu gửi ngay trong mục Đơn hàng của tài khoản.`
      : 'Hiện Tubu Tree chưa nhận yêu cầu đổi trả sau khi giao hàng thành công. Nếu sản phẩm có vấn đề khi nhận, vui lòng liên hệ ngay với chúng tôi qua thông tin ở cuối trang.';
  const inspectionDeadline = inspectionDeadlineText(days);
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
- Thời gian hoàn tiền: ${REFUND_WORKING_DAYS} ngày làm việc kể từ khi Tubu Tree nhận lại và kiểm tra sản phẩm.
- Điểm thưởng hoặc mã giảm giá đã dùng cho đơn được xử lý theo điều kiện của từng chương trình.

## 6. Chi phí vận chuyển đổi trả

Nếu lỗi thuộc về Tubu Tree hoặc đơn vị vận chuyển, Tubu Tree chịu phí vận chuyển đổi trả. Trường hợp khác, chi phí được thông báo trước khi bạn xác nhận.

Xem thêm [Chính sách vận chuyển](/chinh-sach/van-chuyen) và [Chính sách và hình thức thanh toán](/chinh-sach/thanh-toan).

## 7. Chính sách kiểm hàng khi nhận hàng

- Đồng kiểm: khi nhận hàng, bạn được cùng nhân viên giao hàng (bưu tá) kiểm tra ngoại quan kiện hàng và số lượng sản phẩm trước khi ký nhận hoặc thanh toán (với đơn COD). Đồng kiểm chưa bao gồm mở nắp hay dùng thử sản phẩm.
- Quay video: bạn nên quay video liên tục từ lúc mở kiện đến khi kiểm xong, thấy rõ nhãn vận đơn. Video giúp Tubu Tree xử lý nhanh với đơn vị vận chuyển khi hàng móp méo, thiếu hoặc sai.
- ${inspectionDeadline}
- Hoàn tiền: khi yêu cầu được chấp nhận, Tubu Tree hoàn tiền theo mục 5 ở trên.

## 8. Liên hệ

${operator(support, vars)}`;
}

function vanChuyen(vars: LegalVars, support: LegalSupport): string {
  const freeship =
    vars.freeshipThreshold > 0
      ? `Phần hàng do Tubu Tree giao từ ${formatVnd(vars.freeshipThreshold)} được miễn phí vận chuyển. Một số hạng thành viên hoặc chương trình có thể có ngưỡng miễn phí khác, được hiển thị ở giỏ hàng.`
      : 'Mọi phần hàng do Tubu Tree giao đều được miễn phí vận chuyển.';
  const fee = vars.shippingFlatFee ?? DEFAULT_SHIPPING_FLAT_FEE;
  const flatFee =
    vars.freeshipThreshold <= 0
      ? ''
      : fee > 0
        ? `- Phần hàng Tubu Tree giao chưa đạt mức miễn phí (tính trên tiền hàng của riêng phần đó) chịu phí vận chuyển cố định ${formatVnd(fee)}, không phụ thuộc địa chỉ hay khối lượng.`
        : '- Phần hàng Tubu Tree giao chưa đạt mức miễn phí cũng không mất phí vận chuyển.';
  const inspectionDeadline = inspectionDeadlineText(vars.returnWindowDays);
  return `## 1. Phạm vi giao hàng

Tubu Tree giao hàng tới các khu vực mà đơn vị vận chuyển phục vụ. Nếu địa chỉ của bạn nằm ngoài vùng giao, hệ thống sẽ báo ở bước thanh toán.

## 2. Phí vận chuyển

- ${freeship}
${flatFee}
- Sản phẩm của gian hàng đối tác được giao riêng, theo phí và mức miễn phí vận chuyển của chính gian hàng đó. Các khoản này hiển thị ở bước thanh toán trước khi bạn bấm đặt hàng.

## 3. Thời gian giao hàng dự kiến

- Nội thành: [số ngày] ngày làm việc.
- Tỉnh thành khác: [số ngày] ngày làm việc.
- Thời gian tính từ lúc đơn được xác nhận (với chuyển khoản là từ lúc Tubu Tree nhận được tiền) và không tính ngày lễ, ngày nghỉ. Đơn gặp thiên tai, dịch bệnh hoặc sự cố vận chuyển có thể lâu hơn dự kiến.

## 4. Nhận hàng và kiểm tra

- Vui lòng giữ điện thoại để nhân viên giao hàng liên hệ. Giao không thành công quá số lần quy định, đơn có thể bị hoàn về kho.

### Chính sách kiểm hàng khi nhận hàng

- Đồng kiểm: khi nhận hàng, bạn được cùng nhân viên giao hàng (bưu tá) kiểm tra ngoại quan kiện hàng và số lượng sản phẩm trước khi ký nhận hoặc thanh toán (với đơn COD). Đồng kiểm chưa bao gồm mở nắp hay dùng thử sản phẩm.
- Quay video: bạn nên quay video liên tục từ lúc mở kiện đến khi kiểm xong, thấy rõ nhãn vận đơn. Nếu thấy móp méo, rách, ướt, thiếu hoặc sai sản phẩm, hãy chụp ảnh và liên hệ ngay với Tubu Tree.
- ${inspectionDeadline}
- Hoàn tiền: khi yêu cầu được chấp nhận, tiền được hoàn vào Ví Tubu hoặc tài khoản ngân hàng bạn chọn, xem [Chính sách đổi trả](/chinh-sach/doi-tra).

## 5. Thanh toán khi nhận hàng (COD)

Với đơn COD, bạn thanh toán cho nhân viên giao hàng khi nhận. Một số đơn có thể không áp dụng COD (ví dụ đơn giá trị cao), hệ thống sẽ báo ở bước thanh toán. Các hình thức thanh toán khác xem tại [Chính sách và hình thức thanh toán](/chinh-sach/thanh-toan).

## 6. Theo dõi đơn hàng

Bạn xem trạng thái và mã vận đơn trong mục Đơn hàng của tài khoản.

## 7. Đổi trả

Điều kiện đổi trả xem tại [Chính sách đổi trả](/chinh-sach/doi-tra).

## 8. Liên hệ

${operator(support, vars)}`;
}

function thanhToan(vars: LegalVars, support: LegalSupport): string {
  return `## 1. Phạm vi

Chính sách này nêu các hình thức thanh toán, cách hoàn tiền và cách ${companyName(vars)} ("Tubu Tree") bảo vệ giao dịch của bạn khi mua trên website và mini app Zalo của Tubu Tree.

${operator(support, vars)}

## 2. Các hình thức thanh toán

- Thanh toán khi nhận hàng (COD): bạn trả tiền cho nhân viên giao hàng khi nhận. Một số đơn có thể không áp dụng COD (ví dụ đơn giá trị cao), hệ thống sẽ báo ở bước thanh toán.
- Chuyển khoản ngân hàng (quét mã VietQR): bạn chuyển đúng số tiền và đúng nội dung chuyển khoản được hiển thị ở bước thanh toán. Đơn được ghi nhận khi Tubu Tree đối soát thấy tiền về tài khoản.
- Ví Tubu: dùng số dư trong ví để thanh toán đơn hàng.
- ZaloPay: áp dụng khi hình thức này được hiển thị ở bước thanh toán; nếu không thấy, đơn của bạn chưa thanh toán được bằng ZaloPay.
- Điểm Xanh: bạn có thể dùng để trừ vào tiền hàng theo điều kiện hiển thị ở bước thanh toán.

Cách thanh toán khả dụng có thể khác nhau theo từng đơn. Số tiền cần trả, gồm cả phí vận chuyển, luôn được hiển thị trước khi bạn bấm đặt hàng.

## 3. Thời điểm thu tiền

- Với đơn COD, Tubu Tree không thu tiền trước khi giao hàng.
- Chỉ khi bạn chủ động chọn chuyển khoản, Ví Tubu hoặc thanh toán trực tuyến thì khoản tiền mới được thu trước khi giao hàng. Mọi khoản thu này đều được đối soát và ghi nhận minh bạch: bạn xem được trạng thái thanh toán của đơn trong mục Đơn hàng và lịch sử giao dịch trong Ví Tubu.
- Tubu Tree không yêu cầu bạn chuyển tiền ngoài các hình thức nêu trên. Hãy báo ngay cho Tubu Tree nếu có người nhân danh Tubu Tree đề nghị bạn chuyển tiền theo cách khác.

## 4. Hoàn tiền

- Trường hợp được hoàn: đơn bị huỷ sau khi bạn đã thanh toán trước, đơn bị từ chối do hết hàng hoặc sai giá, hoặc yêu cầu đổi trả đã được duyệt theo [Chính sách đổi trả](/chinh-sach/doi-tra).
- Hoàn về đâu: vào Ví Tubu hoặc tài khoản ngân hàng bạn chọn. Đơn COD chưa giao chưa phát sinh khoản thu nên không có tiền cần hoàn.
- Thời gian: ${REFUND_WORKING_DAYS} ngày làm việc kể từ khi Tubu Tree duyệt yêu cầu (với đổi trả là kể từ khi nhận lại và kiểm tra sản phẩm). Thời gian ghi có còn phụ thuộc ngân hàng.
- Điểm Xanh hoặc mã giảm giá đã dùng cho đơn được xử lý theo điều kiện của từng chương trình.

## 5. Bảo mật giao dịch

- Tubu Tree không lưu số thẻ ngân hàng của bạn.
- Giao dịch qua cổng hoặc ví điện tử được xác thực tại chính cổng thanh toán đó. Tubu Tree chỉ nhận kết quả thanh toán (thành công hoặc thất bại), không nhận mật khẩu hay mã OTP của bạn.
- Đường truyền được mã hoá. Cách Tubu Tree xử lý thông tin cá nhân xem tại [Chính sách bảo mật](/chinh-sach/bao-mat).

## 6. Khiếu nại về thanh toán

Nếu bạn bị trừ tiền mà đơn chưa được ghi nhận, bị trừ sai số tiền hoặc chưa nhận được tiền hoàn, hãy liên hệ hotline ${support.hotline} hoặc email ${support.email}, kèm mã đơn và ảnh chụp giao dịch. Tubu Tree tiếp nhận, kiểm tra và phản hồi bạn. Tranh chấp chưa thương lượng được giải quyết theo [Điều khoản sử dụng](/chinh-sach/dieu-khoan).`;
}

/** Bản nháp dùng khi admin chưa nhập nội dung đã duyệt (SystemConfig legal.<loai>). */
export function defaultLegalContent(slug: LegalSlug, vars: LegalVars, support: LegalSupport): string {
  switch (slug) {
    case 'dieu-khoan':
      return dieuKhoan(vars, support);
    case 'bao-mat':
      return baoMat(vars, support);
    case 'doi-tra':
      return doiTra(vars, support);
    case 'van-chuyen':
      return vanChuyen(vars, support);
    case 'thanh-toan':
      return thanhToan(vars, support);
  }
}
