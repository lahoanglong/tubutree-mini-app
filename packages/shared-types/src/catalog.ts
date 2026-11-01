/** Thành phần sản phẩm (ingredient panel ở PDP). */
export interface Ingredient {
  name: string;
  percentage?: number;
  benefit?: string;
}

export interface VariationDTO {
  id: string;
  sku: string;
  name: string;
  attributes: Record<string, string>;
  retailPrice: number;
  salePrice?: number | null;
  stock: number;
  isActive: boolean;
  weight?: number | null;
}

export interface ProductDTO {
  id: string;
  slug: string;
  brand: string;
  name: string;
  shortDesc?: string | null;
  description: string;
  images: string[];
  thumbnail?: string | null;
  tags: string[];
  isActive: boolean;
  isFeatured: boolean;
  basePrice: number;
  salePrice?: number | null;
  forSegment: string[];
  ingredients?: Ingredient[] | null;
  certifications: string[];
  variations: VariationDTO[];
}

/** Mã lỗi ổn định: thêm mục con vào gốc đang có sản phẩm gắn thẳng (hoặc chuyển mục vào gốc đó) cần admin xác nhận. API trả 400 mang mã này; gửi lại kèm `confirmDirectProducts: true` thì làm. */
export const CATEGORY_PARENT_HAS_PRODUCTS = 'CATEGORY_PARENT_HAS_PRODUCTS';

export interface ProductListQuery {
  brand?: string;
  category?: string;
  q?: string;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'best_seller' | 'rating';
  page?: number;
  limit?: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}
