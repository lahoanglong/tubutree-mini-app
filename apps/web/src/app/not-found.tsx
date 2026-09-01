import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-24 text-center">
      <div className="text-5xl">🌿</div>
      <h1 className="mt-4 text-xl font-bold">Không tìm thấy trang</h1>
      <p className="mt-2 text-neutral-600">Trang bạn tìm không tồn tại hoặc đã được chuyển đi.</p>
      <Link href="/" className="mt-6 inline-block rounded-full bg-primary-600 px-6 py-2.5 font-semibold text-white">
        Về trang chủ
      </Link>
    </main>
  );
}
