import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { createServerHttp } from '@/lib/core-http-server';

/**
 * Hạn chờ `/config/public` khi layout dựng ở máy chủ. `fetch` của máy chủ không có hạn riêng (undici chờ tới ~300 giây khi API treo),
 * mà layout phải chờ xong mới dựng trang: quá hạn thì coi như không đọc được và trang dựng như khi API lỗi.
 */
export const SERVER_CONFIG_TIMEOUT_MS = 2_000;

/**
 * Cấu hình công khai đọc ở máy chủ cho các layout cần cờ đặt hàng không đăng nhập. undefined khi API lỗi hay quá hạn: nơi gọi tự quyết
 * cách lùi (không bao giờ ném). `revalidate` 0 thì đọc thẳng API mỗi lượt, không qua bộ đệm dữ liệu của Next.
 */
export function readPublicConfigOnServer(revalidate: number): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), SERVER_CONFIG_TIMEOUT_MS);
    const settle = (value: unknown) => {
      clearTimeout(timer);
      resolve(value);
    };
    publicConfigQuery(createServerHttp({ revalidate }))
      .queryFn()
      .then(settle, () => settle(undefined));
  });
}
