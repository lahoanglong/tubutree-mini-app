import { openExternal } from '../services/zmp-bridge';
import { WEB_BASE_URL } from './web-base-url';

export type WebPolicySlug = 'dieu-khoan' | 'bao-mat' | 'doi-tra' | 'van-chuyen';

/** Bản đầy đủ do admin quản lý nằm ở web (/chinh-sach/[loai]); Mini App mở bằng trình duyệt ngoài. */
export const openWebPolicyPage = (slug: WebPolicySlug) => void openExternal(`${WEB_BASE_URL}/chinh-sach/${slug}`);
