/**
 * `app.miniapp_base_url` chưa cấu hình thì API trả đường dẫn tương đối của Mini App ('/product/<slug>?ref=..'): dán vào Zalo/Facebook
 * không mở được nên ghép tên miền web, và trỏ thẳng tới trang thật /san-pham/<slug> (route /product/<slug> của web chỉ là redirect
 * cho link cũ). URL tuyệt đối do API dựng từ `app.miniapp_base_url` trỏ vào Mini App nên giữ nguyên.
 */
export function absoluteLink(link: string, origin: string): string {
  if (!link.startsWith('/')) return link;
  return `${origin}${link.replace(/^\/product\//, '/san-pham/')}`;
}

/**
 * Thay `relative` bằng `absolute` trong bài mẫu, chỉ khi nó đứng đầu từ (đầu chuỗi, sau khoảng trắng hay ngoặc mở): nếu không,
 * link tuyệt đối admin gõ sẵn sẽ bị chèn tên miền lần thứ hai.
 */
export function withAbsoluteLink(caption: string, relative: string, absolute: string): string {
  if (absolute === relative) return caption;
  const escaped = relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return caption.replace(new RegExp(`(^|[\\s(\\[])${escaped}`, 'g'), (_m, lead: string) => `${lead}${absolute}`);
}

/** Bài mẫu do admin soạn tay có thể thiếu {link}: chép thiếu mã giới thiệu thì CTV mất hoa hồng. */
export function shareFallbackText(caption: string | undefined, link: string): string {
  if (!caption) return link;
  return caption.includes('ref=') ? caption : `${caption} ${link}`;
}
