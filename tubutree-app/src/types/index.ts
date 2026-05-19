// ========================================
// TypeScript Types — Tubu Tree
// ========================================

// === User ===
export interface User {
  id: number;
  zalo_uid?: string;
  name: string | null;
  phone: string | null;
  avatar: string | null;
  affiliate_enabled?: boolean;
  agent_enabled?: boolean;
  is_admin?: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// === Capability & Applications ===
export type AppStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface AffiliateApplication {
  id: number;
  user_id: number;
  status: AppStatus;
  is_active: boolean;
  cccd_number: string;
  cccd_front_url: string;
  bank_name: string;
  bank_account_no: string;
  bank_account_name: string;
  email: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by_uid: string | null;
  reject_reason: string | null;
  suspended_reason: string | null;
}

export interface AgentApplication {
  id: number;
  user_id: number;
  status: AppStatus;
  is_active: boolean;
  agent_type: 'INDIVIDUAL' | 'BUSINESS';
  cccd_number: string;
  cccd_front_url: string;
  cccd_back_url: string;
  selfie_url: string;
  warehouse_address: string;
  expected_monthly_revenue: string;
  bank_name: string;
  bank_account_no: string;
  bank_account_name: string;
  email: string | null;
  company_name: string | null;
  tax_code: string | null;
  business_license_url: string | null;
  representative_name: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by_uid: string | null;
  reject_reason: string | null;
  suspended_reason: string | null;
}

export interface MyCapabilities {
  user: {
    id: number;
    name: string | null;
    phone: string | null;
    avatar: string | null;
    affiliate_enabled: boolean;
    agent_enabled: boolean;
    is_admin: boolean;
    is_banned: boolean;
    ban_reason: string | null;
  };
  affiliate_application: AffiliateApplication | null;
  agent_application: AgentApplication | null;
}

export interface AdminUserItem {
  id: number;
  zalo_uid: string;
  name: string | null;
  phone: string | null;
  avatar: string | null;
  affiliate_enabled: boolean;
  agent_enabled: boolean;
  is_admin: boolean;
  is_banned: boolean;
  ban_reason: string | null;
  banned_at: string | null;
  created_at: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// === Points (B) ===
export interface PointsBalance {
  balance: number;
  lifetime: { earned: number; redeemed: number };
  config: {
    earn_per_vnd: number;
    vnd_per_point: number;
    min_redeem: number;
    max_redeem_pct: number;
  };
}
export interface PointsLedgerItem {
  id: number;
  user_id: number;
  type: 'EARN' | 'REDEEM' | 'REVERSE_EARN' | 'REVERSE_REDEEM' | 'ADJUST';
  amount: number;
  order_id: number | null;
  note: string | null;
  created_at: string;
}

// === Affiliate / Commission (C) ===
export interface AffiliateProfile {
  user_id: number;
  referral_code: string;
  commission_rate_pct: number | null;
  total_referrals: number;
  total_orders: number;
  total_commission: string; // BigInt → string
  created_at: string;
}
export interface Referral {
  id: number;
  referrer_user_id: number;
  referred_user_id: number;
  created_at: string;
  expires_at: string;
}
export interface CommissionItem {
  id: number;
  user_id: number;
  type: 'EARN' | 'REVERSE' | 'PAYOUT';
  amount: string;
  order_id: number | null;
  referred_user_id: number | null;
  note: string | null;
  created_at: string;
}

// === Wallet ===
export interface WalletItem {
  id: number;
  user_id: number;
  type: string;
  amount: string;
  ref_id: number | null;
  note: string | null;
  created_at: string;
}

// === Agent Tier (D) ===
export interface AgentTier {
  id: number;
  code: string;
  name: string;
  discount_pct: number;
  min_order_vnd: string;
  sort_order: number;
  is_active: boolean;
}
export interface AgentProfileInfo {
  tier_code: string;
  tier_name: string;
  discount_pct: number;
  min_order_vnd: string;
}
export interface WholesalePreview {
  retail: string;
  wholesale: string | null;
}

// === Payout (E) ===
export interface Payout {
  id: number;
  user_id: number;
  amount_vnd: string;
  status: 'PENDING' | 'APPROVED' | 'COMPLETED' | 'REJECTED';
  bank_name: string;
  bank_account_no: string;
  bank_account_name: string;
  proof_url: string | null;
  reject_reason: string | null;
  requested_at: string;
  reviewed_at: string | null;
  completed_at: string | null;
}

// === Voucher (F) ===
export interface Voucher {
  id: number;
  code: string;
  description: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  max_discount_vnd: string | null;
  min_order_vnd: string;
  total_uses: number | null;
  per_user_uses: number;
  used_count: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
}
export interface VoucherApplyResult {
  valid: boolean;
  voucher_id?: number;
  code?: string;
  discount_vnd?: string;
  error?: string;
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
