import { api } from '../services/api';
import { getPublicConfig } from '../services/shop-api';

export interface FaqItem {
  q: string;
  a: string;
  cat: string;
}

interface FaqEntryDTO {
  id: string;
  category: string | null;
  question: string;
  answer: string;
}

export interface SupportContact {
  hotline: string | null;
  email: string | null;
  zaloOaName: string | null;
}

/** Dùng khi admin chưa nhập FAQ nào hoặc gọi API lỗi, để trang không trống. */
export const FALLBACK_FAQ: FaqItem[] = [
  {
    cat: 'Chung',
    q: 'Tubu Tree bán những gì?',
    a: 'Tubu Tree tuyển chọn sản phẩm sống xanh từ nhiều thương hiệu Việt: mỹ phẩm thiên nhiên, tẩy rửa sinh học, đồ cho mẹ & bé — ưu tiên thành phần lành tính, bao bì thân thiện môi trường.',
  },
  {
    cat: 'Điểm & Vườn',
    q: 'Điểm Xanh là gì và dùng thế nào?',
    a: '10.000đ chi tiêu trên đơn đã giao = 1 Điểm Xanh. 1 Điểm Xanh đổi 1.000đ khi thanh toán, tối đa 20% giá trị đơn. Điểm có hạn 12 tháng. Điểm quy đổi từ xu cũ thì không hết hạn và trừ được tới 100% giá trị hàng khi thanh toán, nhưng không dùng để đổi voucher.',
  },
  {
    cat: 'Mua sắm',
    q: 'Tôi thanh toán bằng cách nào?',
    a: 'Bạn có thể thanh toán khi nhận hàng (COD), chuyển khoản ngân hàng, trả bằng Ví Tubu. Dùng Điểm Xanh để giảm giá ngay ở bước thanh toán.',
  },
  {
    cat: 'Đổi trả',
    q: 'Chính sách đổi/trả thế nào?',
    a: 'Chỉ đổi/trả khi sản phẩm bị lỗi nhà sản xuất (hỏng bao bì, sai HSD, sai mã, không đúng mô tả) trong vòng 7 ngày từ khi nhận. Tubu chịu phí ship 2 chiều.',
  },
];

const DEFAULT_CAT = 'Chung';

export async function fetchFaqs(): Promise<FaqItem[]> {
  const rows = await api.get<FaqEntryDTO[]>('/faqs').then((r) => r.data);
  return rows.map((r) => ({ q: r.question, a: r.answer, cat: r.category?.trim() || DEFAULT_CAT }));
}

/** Chuỗi rỗng/toàn khoảng trắng hoặc sai kiểu = chưa có giá trị: trang ẩn dòng đó thay vì hiện nhãn trống. */
const cleanText = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export async function fetchSupportContact(): Promise<SupportContact> {
  const cfg = (await getPublicConfig()) as { support?: Partial<Record<keyof SupportContact, unknown>> };
  return {
    hotline: cleanText(cfg.support?.hotline),
    email: cleanText(cfg.support?.email),
    zaloOaName: cleanText(cfg.support?.zaloOaName),
  };
}
