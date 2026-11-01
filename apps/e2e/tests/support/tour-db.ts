import { seedShopScreens } from './a11y-db';

/**
 * Thương hiệu và gian hàng công khai do máy chủ web đọc từ API thật (SSR) nên mock trình duyệt không chạm tới; seed không có hai thứ này.
 * Dùng chung hàm của axe smoke (a11y-db.ts) để hai spec luôn thấy cùng một dữ liệu, cùng một rào ghi (writableTempDb: DB tạm của web-gate.sh hoặc DB của job CI).
 */
export async function seedTourPublicData(): Promise<void> {
  await seedShopScreens();
}
