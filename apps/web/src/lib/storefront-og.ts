import type { StorefrontDetail } from './api';

const DEFAULT_COLOR = '#16a34a';
const NAME_MAX = 60;
const MAX_THUMBNAILS = 3;

export interface OgCardData {
  name: string;
  avatar: string | null;
  thumbnails: string[];
  color: string;
  /** Gian hàng mẫu: thẻ chia sẻ mang nhãn "Gian hàng mẫu" để người nhận không tưởng là người bán thật. */
  isSample: boolean;
}

/** Chỉ URL http(s): ảnh base64 làm thẻ chia sẻ nặng và bị nhiều nền tảng bỏ, đường dẫn tương đối không có gốc để tải. */
const isRemoteImage = (v: string | null | undefined): v is string => typeof v === 'string' && /^https?:\/\//i.test(v);

/** Dữ liệu thẻ chia sẻ (ảnh OG) của gian hàng: tên, ảnh đại diện và tối đa 3 ảnh sản phẩm đầu tiên, bỏ ảnh không dùng được. */
export function ogCardData(sf: Pick<StorefrontDetail, 'title' | 'avatarUrl' | 'themeColor' | 'collections'> & { isSample?: boolean }): OgCardData {
  const thumbnails: string[] = [];
  for (const col of sf.collections ?? []) {
    for (const it of col.items ?? []) {
      const src = it.product?.thumbnail;
      if (isRemoteImage(src) && !thumbnails.includes(src)) thumbnails.push(src);
      if (thumbnails.length === MAX_THUMBNAILS) break;
    }
    if (thumbnails.length === MAX_THUMBNAILS) break;
  }
  const title = sf.title.trim();
  return {
    name: title.length > NAME_MAX ? `${title.slice(0, NAME_MAX - 1).trimEnd()}…` : title,
    avatar: isRemoteImage(sf.avatarUrl) ? sf.avatarUrl : null,
    thumbnails,
    isSample: sf.isSample === true,
    color: sf.themeColor && /^#[0-9a-fA-F]{6}$/.test(sf.themeColor) ? sf.themeColor : DEFAULT_COLOR,
  };
}
