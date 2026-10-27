import Link from 'next/link';

const LINK = 'tubu-inline-link font-medium text-forest-700 underline underline-offset-2';

/** Dòng đồng ý điều khoản ngay cạnh nút Đặt hàng (không có ô tick): đặt hàng là hành vi đồng ý. */
export function OrderConsent({ className = '' }: { className?: string }) {
  return (
    <p data-testid="order-consent" className={`text-xs text-stone-600 ${className}`}>
      Bằng việc đặt hàng, bạn đồng ý với{' '}
      <Link href="/chinh-sach/dieu-khoan" className={LINK}>
        Điều khoản
      </Link>{' '}
      và{' '}
      <Link href="/chinh-sach/doi-tra" className={LINK}>
        Chính sách đổi trả
      </Link>
      .
    </p>
  );
}
