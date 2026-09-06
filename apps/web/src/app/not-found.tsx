import Link from 'next/link';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-24 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-leaf-50 text-leaf-600 shadow-sm ring-8 ring-leaf-50/50">
        <Compass className="h-8 w-8 text-primary-600" />
      </div>
      <h1 className="mt-5 text-2xl font-bold text-neutral-900">Không tìm thấy trang</h1>
      <p className="mt-2 text-neutral-600">Trang bạn tìm không tồn tại hoặc đã được chuyển đi.</p>
      <Link href="/" className="mt-6 inline-block rounded-full bg-primary-600 px-6 py-2.5 font-semibold text-white shadow-sm hover:bg-primary-700 transition">
        Về trang chủ
      </Link>
    </main>
  );
}
