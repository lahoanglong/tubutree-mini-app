/** ID Mini App chính thức (https://zalo.me/s/2070857098114207963/), cùng giá trị `appId` trong app-config.json. */
export const DEFAULT_MINIAPP_ID = '2070857098114207963';

/** Biến để trống hoặc không phải số thì rơi về ID chính thức, nếu không link thành "zalo.me/s//..." không mở được. */
export function resolveMiniAppId(raw: string | undefined): string {
  const id = raw?.trim() ?? '';
  return /^\d+$/.test(id) ? id : DEFAULT_MINIAPP_ID;
}

/**
 * Link mở thẳng một màn của Mini App (`https://zalo.me/s/<id>/<path>`). Dùng cho mọi link chia sẻ phát ra từ Mini App
 * (sao chép, lời đăng gợi ý, QR): người nhận trong Zalo ở lại Mini App, không phải đăng nhập lại như khi mở link web.
 */
export function miniAppLink(path: string, id: string = resolveMiniAppId(import.meta.env.VITE_ZALO_MINIAPP_ID as string | undefined)): string {
  return `https://zalo.me/s/${id}${path.startsWith('/') ? path : `/${path}`}`;
}
