/**
 * Thuộc tính trên `<html>` giữ sẵn chỗ cho dải mời mở Zalo Mini App (W44 U4): script ở `<head>` đặt khi đoán được dải sẽ hiện, CSS ở
 * `.tubu-miniapp-slot` (components/mini/mini.css). Tách riêng để khung trang (`app/layout-shell.tsx`) gỡ được thuộc tính mà không kéo luật tự mở
 * (`lib/mini-app-auto-open.ts`) vào JS tải đầu.
 */
export const MINI_APP_BAR_ATTR = 'data-miniapp-bar';
