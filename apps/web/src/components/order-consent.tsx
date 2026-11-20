import Link from 'next/link';

const LINK = 'tubu-hit-44 whitespace-nowrap font-medium text-forest-700 underline underline-offset-2';

/**
 * Dòng đồng ý điều khoản ngay cạnh nút Đặt hàng (không có ô tick): đặt hàng là hành vi đồng ý. Đủ năm chính sách Bộ Công Thương yêu cầu,
 * vì ở điện thoại trang thanh toán ẩn chân trang (thanh Đặt hàng dính đáy) nên đây là lối duy nhất tới các chính sách. Năm link nằm ở khối
 * riêng dưới câu (`.tubu-consent-links`, mỗi dòng cao 44px): link không bị cắt giữa chữ, và khi phải xuống dòng thì vùng chạm 44px của link
 * dòng trên không chồng lên link dòng dưới. Vùng chạm là ::after định vị (`tubu-hit-44`, như Mini App), không phải đệm inline: đệm của dòng
 * link cuối nằm ngoài hộp dòng (lề âm) nên trình duyệt không nhận chạm ở đó. Link ngắn mang tên đầy đủ cho trình đọc màn hình. Chữ giống
 * Mini App (checkout.tsx).
 */
export function OrderConsent({ className = '' }: { className?: string }) {
  return (
    <p data-testid="order-consent" className={`text-caption text-stone-600 ${className}`}>
      Bằng việc đặt hàng, bạn đồng ý với:{' '}
      <br />
      <span className="tubu-consent-links">
        <Link href="/chinh-sach/dieu-khoan" className={LINK}>
          Điều khoản
        </Link>
        ,{' '}
        <Link href="/chinh-sach/bao-mat" aria-label="Chính sách bảo mật" className={LINK}>
          Bảo mật
        </Link>
        ,{' '}
        <Link href="/chinh-sach/doi-tra" aria-label="Chính sách đổi trả" className={LINK}>
          Đổi trả
        </Link>
        ,{' '}
        <Link href="/chinh-sach/van-chuyen" aria-label="Chính sách vận chuyển" className={LINK}>
          Vận chuyển
        </Link>
        ,{' '}
        <Link href="/chinh-sach/thanh-toan" aria-label="Chính sách thanh toán" className={LINK}>
          Thanh toán
        </Link>
        .
      </span>
    </p>
  );
}
