// ========================================
// TypeScript Types — Tubu Tree
// ========================================

// === User ===
export interface User {
  id: number;
  zalo_uid: string;
  name: string | null;
  phone: string | null;
  avatar: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// === Product (từ Pancake POS) ===
export interface ProductVariation {
  id: string;
  name: string;
  sku: string;
  retail_price: number;
  weight: number;
  fields: Record<string, string>;
  in_stock?: number;
  images?: string[];
}

export interface Product {
  id: string;
  name: string;
  display_id: number;
  image: string | null;
  type: string;
  note_product: string;
  categories: Category[];
  variations: ProductVariation[];
  product_attributes: any[];
  tags: string[];
}

export interface ProductsResponse {
  data: Product[];
  total?: number;
}

// === Category ===
export interface Category {
  id: number;
  text: string;
  is_admin_category: boolean;
}

// === Cart ===
export interface CartItem {
  id: number;
  user_id: number;
  pos_product_id: string;
  variant_id: string | null;
  qty: number;
  created_at: string;
  // Enriched client-side
  product?: Product;
  variation?: ProductVariation;
}

// === Address ===
export interface Address {
  id: number;
  user_id: number;
  name: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  detail: string;
  is_default: boolean;
}

// === Order ===
export interface OrderRef {
  id: number;
  user_id: number;
  pos_order_id: string;
  payment_method: string;
  payment_status: 'PENDING' | 'WAITING_PAYMENT' | 'COMPLETED' | 'CANCELLED';
  created_at: string;
  updated_at: string;
}

export interface OrderDetail {
  db_ref: OrderRef;
  pos_data: any;
}

// === Review ===
export interface Review {
  id: number;
  user_id: number;
  pos_product_id: string;
  rating: number;
  comment: string | null;
  images: string | null;
  created_at: string;
  user?: { name: string; avatar: string | null };
}

// === Wishlist ===
export interface WishlistItem {
  id: number;
  user_id: number;
  pos_product_id: string;
  created_at: string;
}

// === Notification ===
export interface Notification {
  id: number;
  user_id: number;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// === Banner ===
export interface Banner {
  id: number;
  image_url: string;
  link: string | null;
  sort_order: number;
  is_active: boolean;
}
