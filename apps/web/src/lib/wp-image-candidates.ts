'use client';

import type { Tone } from './recycling';
import { apiFetch } from './client-api';

/** CANDIDATE: gợi ý tự động theo tên, chưa ai kiểm bao bì. NONE: sản phẩm rỗng ảnh nhưng WordPress không có gì đủ giống (không có thao tác duyệt). */
export type WpTier = 'EXACT' | 'SAME_LINE' | 'WEAK' | 'COMPOSITE' | 'CANDIDATE' | 'NONE';
export type WpRowState = 'PENDING' | 'SKIPPED' | 'APPLIED' | 'HAS_IMAGES';

export interface WpResolved {
  id: number;
  slug: string;
  name: string | null;
  imageUrls: string[];
  /** Khác null khi WordPress không trả được sản phẩm này (trang cũ đã tắt, hết sản phẩm, không có ảnh). */
  error: string | null;
}

/** Một dòng của `GET /admin/catalog-wp-images`. `wp` và `defaultImageUrls` là null khi chưa hỏi WordPress (`live=1`) hoặc dòng đã xử lý xong. */
export interface WpImageRow {
  productId: string;
  productSlug: string;
  name: string;
  isActive: boolean;
  variations: string[];
  tier: WpTier;
  tierLabel: string;
  note: string;
  state: WpRowState;
  decidedBy: string | null;
  decidedAt: string | null;
  appliedCount: number | null;
  wp: WpResolved[] | null;
  defaultImageUrls: string[] | null;
  /** true: chưa đọc được kho WordPress nên chưa biết có gợi ý hay không (khác "đã đối chiếu mà không có gì giống"); chỉ đi với tier NONE. */
  suggestUnavailable: boolean;
}

export interface WpImageList {
  items: WpImageRow[];
  counts: Record<WpRowState, number>;
}

export interface WpImageActionResult {
  productId: string;
  state: WpRowState;
  appliedCount?: number;
}

export const WP_TIER_TONE: Record<WpTier, Tone> = {
  EXACT: 'success',
  SAME_LINE: 'info',
  WEAK: 'warning',
  COMPOSITE: 'warning',
  CANDIDATE: 'warning',
  NONE: 'neutral',
};

/** Khớp PRODUCT_IMAGES_LIMIT của API. */
export const WP_IMAGES_MAX = 8;

const base = '/admin/catalog-wp-images';
const one = (productId: string) => `${base}/${encodeURIComponent(productId)}`;

export const listWpImageCandidates = (live: boolean) => apiFetch<WpImageList>(live ? `${base}?live=1` : base);
/** `imageUrls` thiếu = bộ ảnh mặc định của máy chủ; có = tập con ảnh WordPress đang hiện trên dòng (máy chủ kiểm lại). */
export const approveWpImages = (productId: string, imageUrls?: string[]) =>
  apiFetch<WpImageActionResult>(`${one(productId)}/approve`, { method: 'POST', body: imageUrls ? { imageUrls } : {} });
export const skipWpImages = (productId: string) => apiFetch<WpImageActionResult>(`${one(productId)}/skip`, { method: 'POST', body: {} });
export const restoreWpImages = (productId: string) => apiFetch<WpImageActionResult>(`${one(productId)}/restore`, { method: 'POST', body: {} });
