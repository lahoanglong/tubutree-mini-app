import { Suspense } from 'react';
import { AuthLoading } from '@/components/login-required';
import { PAGE_WIDE } from '@/lib/page-frame';
import VouchersView from './vouchers-view';

// Khung rộng (không AccountShell): kho mã xếp lưới ba cột từ lg. View đọc useSearchParams (?tab=), build tĩnh bắt buộc có Suspense bao ngoài.
export default function VouchersPage() {
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:pt-0`}>
      <Suspense fallback={<AuthLoading />}>
        <VouchersView />
      </Suspense>
    </main>
  );
}
