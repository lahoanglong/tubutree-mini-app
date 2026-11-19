import { notFound } from 'next/navigation';
import { PrebuiltGuest } from '@/lib/auth-phase';
import GamePage from '../garden-page';

export const dynamicParams = false;

/**
 * Hai bản tĩnh của /vuon-xanh trong MỘT route (thêm route riêng làm webpack chia lại chunk dùng chung, JS tải lần đầu của các trang khác tăng):
 * - `/vuon-xanh`: bản thường, khung chờ tới khi phiên khôi phục xong.
 * - `/vuon-xanh/khach`: bản dựng sẵn cho khách chưa có phiên (middleware viết lại, URL trình duyệt vẫn /vuon-xanh; vào thẳng thì 308 về
 *   /vuon-xanh; xem lib/guest-prebuilt.ts). HTML đầu đã có khối giới thiệu cho khách (phần tử LCP ở 390px) thay vì khung chờ đăng nhập; công
 *   cụ tìm kiếm không có cookie phiên nên cũng đọc được nội dung này.
 * Metadata và JSON-LD lấy từ layout của /vuon-xanh.
 */
export function generateStaticParams() {
  return [{ variant: [] }, { variant: ['khach'] }];
}

export default async function GardenRoute({ params }: { params: Promise<{ variant?: string[] }> }) {
  const { variant = [] } = await params;
  if (variant.length === 0) return <GamePage />;
  if (variant.length !== 1 || variant[0] !== 'khach') notFound();
  return (
    <PrebuiltGuest>
      <GamePage />
    </PrebuiltGuest>
  );
}
