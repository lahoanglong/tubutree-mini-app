import { Smartphone } from 'lucide-react';
import { ui } from '@/lib/guest-ui';
import { miniAppLink, miniAppPathLink } from '@/lib/zalo-mini-app';

/**
 * Chức năng chỉ chạy được trong Zalo (SĐT đã xác minh, chấm công, quét QR): nói rõ thay vì để trang hỏng, kèm nút mở đúng
 * màn Mini App tương ứng với `path` (đường dẫn web đang xem) hoặc `miniappPath` (đường dẫn Mini App đã biết, khi màn đó
 * không có trang web để tra ngược). Chưa cấu hình app id thì chỉ còn dòng giải thích.
 */
export function MiniAppOnlyNotice({ path, miniappPath }: { path?: string; miniappPath?: string }) {
  const href = miniappPath ? miniAppPathLink(miniappPath) : miniAppLink(path);
  return (
    <div role="status" className="py-16 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-600 shadow-card">
        <Smartphone className="h-8 w-8 stroke-[1.5]" aria-hidden="true" />
      </div>
      <p className="mx-auto mt-4 max-w-sm text-stone-700">Tính năng này cần mở Tubu Tree trên Zalo.</p>
      {href && (
        <a href={href} className={`${ui.btnPrimary} mt-4`}>
          Mở trên Zalo
        </a>
      )}
    </div>
  );
}
