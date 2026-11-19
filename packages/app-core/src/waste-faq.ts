import type { WasteItemDTO, WastePublicFlags, WastePublicWarehouseDTO } from '@tubutree/shared-types';
import { summarizeOpeningHours } from './waste-hours';

export interface WasteFaqItem {
  q: string;
  a: string;
}

export const WASTE_FAQ_TITLE = 'Câu hỏi thường gặp';

/** Tên cách giao "Thu kèm đơn mua" như trên màn tạo yêu cầu (web `METHOD_LABELS.PICKUP`, spec web giữ hai bên khớp). */
export const WASTE_FAQ_PICKUP_LABEL = 'Thu kèm đơn mua';

const MAX_ITEM_NAMES = 12;

export interface WasteFaqInput {
  /** Cờ công khai `waste` của /config/public: chương trình và từng cách giao đang mở. */
  flags: WastePublicFlags;
  /** Kho Tubu đang nhận (GET /waste/warehouses); rỗng khi API chưa có route hoặc chưa có kho nào. */
  warehouses: readonly WastePublicWarehouseDTO[];
  /** Danh mục món công khai (GET /waste/catalogue); thiếu thì bỏ câu "nhận đổi những món nào". */
  items?: readonly Pick<WasteItemDTO, 'name' | 'status' | 'sortOrder'>[];
}

/** "a", "a hoặc b", "a, b hoặc c". */
function orList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} hoặc ${parts.at(-1)}`;
}

function warehouseLine(w: WastePublicWarehouseDTO): string {
  const name = w.name.trim();
  const province = w.provinceName.trim();
  const where = province && !name.toLowerCase().includes(province.toLowerCase()) ? `${name} (${province})` : name;
  const hours = summarizeOpeningHours(w.openingHours);
  return hours.length > 0 ? `${where} mở cửa nhận rác ${hours.join('; ')}.` : `${where} nhận rác; giờ mở cửa hiện khi bạn chọn điểm nhận lúc tạo yêu cầu.`;
}

/**
 * Câu hỏi thường gặp của trang Đổi rác, dựng từ dữ liệu thật: chỉ nêu cách giao đang mở theo cờ công khai (cách đang tắt, ví dụ
 * tự gửi về kho, không xuất hiện), giờ mở cửa lấy từ chính điểm kho trong cơ sở dữ liệu, danh sách món lấy từ danh mục công khai.
 * Không nêu con số do admin cấu hình (mức điểm, trần, ngưỡng tối thiểu) vì chúng đổi theo thời gian. Chương trình tắt thì không có
 * câu nào, để trang không khai FAQPage cho một chương trình khách không tham gia được.
 * Cùng một danh sách vẽ phần hiển thị và dữ liệu có cấu trúc, nên hai bên luôn khớp nhau.
 */
export function wasteFaq({ flags, warehouses, items }: WasteFaqInput): WasteFaqItem[] {
  if (!flags.enabled) return [];
  const hasWarehouse = flags.dropoff && warehouses.length > 0;
  const ways: string[] = [];
  if (flags.dropoff) ways.push(hasWarehouse ? 'mang tới kho Tubu' : 'mang tới điểm nhận');
  if (flags.pickup) ways.push('gửi người giao hàng khi nhận đơn Tubu');
  if (flags.mailin) ways.push('tự gửi về kho Tubu');

  const out: WasteFaqItem[] = [
    {
      q: 'Đổi vỏ chai, bao bì lấy Điểm Xanh ở Tubu Tree thế nào?',
      a:
        `Đăng nhập bằng số điện thoại để Tubu cộng điểm đúng tài khoản, chọn món và số lượng bạn có, rồi ` +
        `${ways.length > 0 ? `chọn cách giao: ${orList(ways)}` : 'chọn cách giao đang mở khi tạo yêu cầu'}. Tubu đếm xong là cộng Điểm Xanh cho bạn.`,
    },
  ];

  const names = [
    ...new Set(
      (items ?? [])
        .filter((i) => i.status === 'ACTIVE')
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => i.name.trim())
        .filter(Boolean),
    ),
  ];
  if (names.length > 0) {
    const shown = names.slice(0, MAX_ITEM_NAMES).join(', ');
    out.push({
      q: 'Tubu Tree nhận đổi những món nào?',
      a: `Tubu đang nhận: ${shown}${names.length > MAX_ITEM_NAMES ? ' và một số món khác' : ''}. Mức điểm của từng món hiện ngay trên trang Đổi rác.`,
    });
  }

  if (hasWarehouse) {
    out.push({
      q: 'Kho Tubu nhận vỏ chai, bao bì vào giờ nào?',
      a: `${warehouses.map(warehouseLine).join(' ')} Tạo yêu cầu trên trang Đổi rác trước, địa chỉ kho hiện khi bạn chọn điểm nhận, rồi mang bao bì sạch tới. Cách này miễn phí, Điểm Xanh được cộng khi người ở kho xác nhận số món.`,
    });
  } else if (flags.dropoff) {
    out.push({
      q: 'Mang vỏ chai, bao bì tới điểm nhận thế nào?',
      a: 'Tạo yêu cầu trên trang Đổi rác rồi chọn điểm nhận, giờ mở cửa của từng điểm hiện ngay khi chọn. Cách này miễn phí, Điểm Xanh được cộng khi người ở điểm nhận xác nhận số món.',
    });
  }

  if (flags.pickup) {
    out.push({
      q: 'Người giao hàng có thu vỏ chai, bao bì kèm đơn không?',
      a: `Có. Tạo yêu cầu, chọn “${WASTE_FAQ_PICKUP_LABEL}” rồi gắn vào đơn Tubu kế tiếp: người giao đơn (tài xế hoặc bưu tá) lấy rác luôn, miễn phí. Yêu cầu thu kèm cần đạt mức điểm tối thiểu hiện khi tạo yêu cầu.`,
    });
  }

  if (flags.mailin) {
    out.push({
      q: 'Có tự gửi vỏ chai, bao bì về kho Tubu được không?',
      a: 'Được. Bạn tự gửi qua hãng vận chuyển bất kỳ về kho Tubu TP.HCM và tự trả phí ship; yêu cầu gửi kho cần đạt mức điểm tối thiểu hiện khi tạo yêu cầu.',
    });
  }

  out.push(
    {
      q: 'Cần chuẩn bị vỏ chai, bao bì thế nào?',
      a: 'Rửa sạch, để khô và tách đúng loại. Món ướt, bẩn, lẫn vật lạ hoặc sai loại có thể không được tính điểm khi Tubu đếm.',
    },
    {
      q: 'Khi nào được cộng Điểm Xanh và dùng điểm vào việc gì?',
      a: 'Điểm Xanh chỉ được cộng khi kho Tubu (hoặc điểm nhận) xác nhận số món nhận được, không cộng lúc tạo yêu cầu. Điểm Xanh dùng để đổi quà và mã giảm giá.',
    },
  );
  return out;
}
