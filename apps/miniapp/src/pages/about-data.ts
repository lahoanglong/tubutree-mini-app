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
    a: '10.000đ chi tiêu trên đơn đã giao = 1 Điểm Xanh. 1 Điểm Xanh đổi 1.000đ khi thanh toán, tối đa 20% giá trị đơn. Điểm có hạn 12 tháng.',
  },
  {
    cat: 'Mua sắm',
    q: 'Tôi thanh toán bằng cách nào?',
    a: 'Bạn có thể thanh toán khi nhận hàng (COD), chuyển khoản ngân hàng, trả bằng Ví Tubu hoặc TubuXu.',
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

export async function fetchSupportContact(): Promise<SupportContact> {
  const cfg = (await getPublicConfig()) as { support?: Partial<SupportContact> };
  return {
    hotline: cfg.support?.hotline ?? null,
    email: cfg.support?.email ?? null,
    zaloOaName: cfg.support?.zaloOaName ?? null,
  };
}
