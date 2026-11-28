/**
 * Nhận ra trình duyệt trong Zalo (WebView của ứng dụng Zalo, kể cả khung web mở từ Mini App). UA của nó luôn có "Zalo"; bộ xem trước link của
 * Zalo (không chạy JS, không phải khách) bị loại để không ai coi nó là khách trong WebView.
 */
const ZALO_UA = /Zalo/i;
const ZALO_LINK_PREVIEW_UA = /Zalo-?Link-?Preview|Zalo-?Preview/i;

export function isZaloWebViewUserAgent(ua: string): boolean {
  return ZALO_UA.test(ua) && !ZALO_LINK_PREVIEW_UA.test(ua);
}

/** Thuộc tính trên <html> do `zaloWebViewBootScript` đặt; CSS dùng nó để đổi màn trước khi React hydrate. */
export const ZALO_WEBVIEW_ATTR = 'data-zalo-webview';

/** Lớp Tailwind theo thuộc tính trên: giấu trong WebView Zalo / chỉ hiện trong WebView Zalo. */
export const HIDE_IN_ZALO_WEBVIEW = '[html[data-zalo-webview]_&]:hidden';
export const SHOW_IN_ZALO_WEBVIEW = 'hidden [html[data-zalo-webview]_&]:block';

/**
 * Script đặt ở trang cần chặn, chạy trước khi vẽ nội dung đứng sau nó: trang dựng sẵn ở máy chủ (ISR) giống nhau cho mọi người, nên không
 * có script này khách trong Zalo sẽ thấy nội dung thật chớp lên rồi mới bị thay bằng màn chặn. Cùng luật với `isZaloWebViewUserAgent`.
 */
export function zaloWebViewBootScript(): string {
  return (
    `(function(){try{var u=navigator.userAgent||'';` +
    `if(/${ZALO_UA.source}/i.test(u)&&!/${ZALO_LINK_PREVIEW_UA.source}/i.test(u))document.documentElement.setAttribute('${ZALO_WEBVIEW_ATTR}','')` +
    `}catch(e){}})()`
  );
}
