/** Khoá link kênh cộng đồng của chủ shop (nhóm Zalo, fanpage Facebook, kênh TikTok); rỗng = chưa có, FE ẩn nút. */
export const COMMUNITY_LINK_KEYS = ['community.zalo_group_url', 'community.facebook_url', 'community.tiktok_url'] as const;

/** Chỉ https và đúng tên miền (kể cả subdomain như www., m., vt.): link ra ngoài app không được dẫn tới trang lạ. */
const ALLOWED_HOSTS = ['zalo.me', 'facebook.com', 'fb.com', 'tiktok.com'];

function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Trả null nếu hợp lệ (rỗng cũng hợp lệ), ngược lại là lý do. */
export function communityUrlProblem(value: unknown): string | null {
  if (value === '') return null;
  const hint = 'phải để trống hoặc là link https của zalo.me, facebook.com, fb.com, tiktok.com';
  if (typeof value !== 'string' || value !== value.trim() || value.length > 300) return hint;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return hint;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !isAllowedHost(url.hostname)) return hint;
  return null;
}

/** Giá trị công khai: DB lưu sai (sửa tay ngoài admin) thì trả null thay vì đưa link lạ cho khách. */
export function publicCommunityUrl(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && communityUrlProblem(value) === null ? value : null;
}
