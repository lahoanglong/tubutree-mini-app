import type { CampaignAudience, CampaignLinkType, CampaignPlacement } from '@tubutree/app-core/api/campaign';
import { apiFetch } from './client-api';

export type AdminCampaignStatus = 'live' | 'scheduled' | 'ended' | 'off';

export interface AdminCampaignRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  placement: CampaignPlacement;
  /** Tham chiếu công khai của ảnh (không phải ảnh nguyên bản): chỉ để xem trước trong danh sách. */
  image: string | null;
  linkType: CampaignLinkType;
  linkValue: string | null;
  audience: CampaignAudience;
  startAt: string;
  endAt: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  couponCount: number;
  status: AdminCampaignStatus;
  /** Kết quả kiểm trước khi bật, tính như thể chiến dịch đang bật. */
  health: { blockers: number; warnings: number };
}

export type CampaignIssueLevel = 'BLOCK' | 'WARN';

export interface CampaignIssue {
  code: string;
  level: CampaignIssueLevel;
  message: string;
}

export interface CampaignCheckResult {
  issues: CampaignIssue[];
  blockers: number;
  warnings: number;
  /** Phán quyết lần lưu này theo cùng luật với máy chủ lúc lưu; API cũ không trả (form không khoá, máy chủ vẫn quyết). */
  verdict?: { blocked: boolean; codes: string[]; reason?: string };
}

/** Thân kiểm trước khi lưu: cùng trường với tạo/sửa (không cần ảnh), kèm sản phẩm và mã đang soạn. `id` có khi sửa chiến dịch đã lưu. */
export interface CampaignCheckInput {
  id?: string;
  placement: CampaignPlacement;
  linkType: CampaignLinkType;
  linkValue?: string;
  audience: CampaignAudience;
  startAt: string;
  endAt: string;
  sortOrder: number;
  /** Mặc định bật khi không gửi (kiểm "như thể đã bật"). */
  isActive?: boolean;
  productIds: string[];
  couponCodes: string[];
}

export interface AdminCampaignDetail extends Omit<AdminCampaignRow, 'image' | 'productCount' | 'couponCount' | 'health'> {
  /** Ảnh nguyên bản (link https hoặc ảnh nén) để form sửa gửi lại đúng giá trị. */
  image: string;
  products: { id: string; name: string; slug: string }[];
  couponCodes: string[];
}

export interface AdminCampaignInput {
  title: string;
  subtitle?: string;
  slug?: string;
  placement: CampaignPlacement;
  image: string;
  linkType?: CampaignLinkType;
  linkValue?: string;
  audience?: CampaignAudience;
  startAt: string;
  endAt: string;
  sortOrder?: number;
  isActive?: boolean;
  /** Thay hết danh sách trong cùng lệnh lưu (một giao dịch); không gửi thì giữ nguyên. */
  productIds?: string[];
  couponCodes?: string[];
}

/** Sửa: không có slug (đổi slug làm gãy link đã chia sẻ); subtitle/linkValue null là xoá. */
export type AdminCampaignPatch = Partial<Omit<AdminCampaignInput, 'slug' | 'subtitle' | 'linkValue'>> & { subtitle?: string | null; linkValue?: string | null };

const BASE = '/admin/campaigns';
const path = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export const listAdminCampaigns = (placement?: CampaignPlacement) => apiFetch<AdminCampaignRow[]>(placement ? `${BASE}?placement=${placement}` : BASE);
export const getAdminCampaign = (id: string) => apiFetch<AdminCampaignDetail>(path(id));
export const createAdminCampaign = (body: AdminCampaignInput) => apiFetch<AdminCampaignDetail>(BASE, { method: 'POST', body });
export const updateAdminCampaign = (id: string, body: AdminCampaignPatch) => apiFetch<AdminCampaignDetail>(path(id), { method: 'PATCH', body });
export const deleteAdminCampaign = (id: string) => apiFetch<{ ok: boolean }>(path(id), { method: 'DELETE' });
export const checkAdminCampaign = (body: CampaignCheckInput) => apiFetch<CampaignCheckResult>(`${BASE}/check`, { method: 'POST', body });
