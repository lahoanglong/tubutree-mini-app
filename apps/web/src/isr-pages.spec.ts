// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Các trang này chạy ISR (cache theo đường dẫn). Thêm cookies()/headers() hoặc bỏ generateStaticParams sẽ lặng lẽ đưa chúng về dựng mỗi lượt.
const ISR_PAGES = ['san-pham/[slug]', 'brand/[slug]', 'chinh-sach/[loai]', 's/[slug]', 'chien-dich/[slug]'];
// Trang chỉ là khung, máy chủ không tải dữ liệu: không ISR để đường dẫn lạ không ghi file cache.
const FRAME_PAGES = ['mua-chung/[id]', 'hoc-vien/[courseId]'];
const read = (route: string) => readFileSync(join(__dirname, 'app', route, 'page.tsx'), 'utf8');

describe('trang ISR theo [slug]', () => {
  it.each(ISR_PAGES)('%s export generateStaticParams và không đọc cookies/headers', (route) => {
    const src = read(route);
    expect(src).toMatch(/export function generateStaticParams\(/);
    expect(src).not.toMatch(/from 'next\/headers'/);
  });

  it.each(FRAME_PAGES)('%s không ISR (tránh ghi file cache cho mọi id)', (route) => {
    expect(read(route)).not.toMatch(/generateStaticParams/);
  });
});
