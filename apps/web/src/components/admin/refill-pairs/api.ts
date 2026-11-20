import { apiFetch } from '@/lib/client-api';

/** Kiểu khớp `apps/api/src/modules/catalog/refill/refill-pairs.service.ts` (`AdminRefillPairs`). */
export type RefillPairStatus = 'auto' | 'manual' | 'size' | 'ambiguous' | 'near' | 'blocked';

export interface AdminRefillProduct {
  id: string;
  slug: string;
  name: string;
  sizeLabel: string | null;
}

export interface AdminRefillPairRow {
  bottle: AdminRefillProduct;
  refill: AdminRefillProduct | null;
  status: RefillPairStatus;
  candidates: number;
  ratio: number | null;
}

export interface RefillPairOverride {
  bottleSlug: string;
  refillSlug: string;
}

export interface AdminRefillPairs {
  enabled: boolean;
  maxRatio: number;
  rows: AdminRefillPairRow[];
  overrides: RefillPairOverride[];
  block: { slug: string; name: string | null }[];
  choices: { bottles: AdminRefillProduct[]; refills: AdminRefillProduct[] };
}

export interface SaveRefillPairsInput {
  enabled?: boolean;
  overrides?: RefillPairOverride[];
  /** Ghép tay một chai; máy chủ gộp vào danh sách đang lưu (không ghi đè cặp trang này chưa thấy). */
  add?: RefillPairOverride;
  /** Bỏ ghép tay một chai (slug chai) trên danh sách đang lưu. */
  remove?: string;
  block?: string[];
}

const BASE = '/admin/refill-pairs';

// Bảng vừa lưu phải đọc bản mới nhất, nên không cho trình duyệt dùng lại bản đã nhớ.
export const getRefillPairs = () => apiFetch<AdminRefillPairs>(BASE, { cache: 'no-store' });

/** Phần nào gửi thì máy chủ ghi đè phần đó; trả lại bảng mới. */
export const saveRefillPairs = (input: SaveRefillPairsInput) => apiFetch<AdminRefillPairs>(BASE, { method: 'PUT', body: input });
