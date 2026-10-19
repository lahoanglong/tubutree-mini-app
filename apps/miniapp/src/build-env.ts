/**
 * Bản build production không đặt VITE_API_BASE_URL sẽ nhúng địa chỉ dự phòng http://localhost:3001/api
 * (services/api.ts): mọi điện thoại gọi về chính máy mình, không đơn nào lên được, và chỉ biết sau khi Zalo duyệt bản đó.
 * Hàm thuần để vitest kiểm; vite.config.mts gọi khi `vite build`. Dev giữ mặc định localhost nên không kiểm.
 */
const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(\/|$)/i;

export function assertMiniappBuildEnv(mode: string, env: Record<string, string | undefined>): void {
  if (mode !== 'production') return;
  const url = (env.VITE_API_BASE_URL ?? '').trim();
  const how =
    'Đặt biến môi trường VITE_API_BASE_URL (ví dụ trong apps/miniapp/.env.production) thành địa chỉ API https thật, ví dụ https://api.tubutree.com/api, rồi build lại.';
  if (url === '') {
    throw new Error(`Build production thiếu VITE_API_BASE_URL nên bản Mini App sẽ gọi http://localhost:3001/api. ${how}`);
  }
  if (!/^https:\/\//i.test(url) || LOCAL_HOST.test(url)) {
    throw new Error(`VITE_API_BASE_URL="${url}" không dùng được cho build production (phải là https và không trỏ localhost). ${how}`);
  }
}
