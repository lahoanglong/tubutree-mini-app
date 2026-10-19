'use client';

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

type Note = { text: string; error: boolean } | null;

/**
 * Chia sẻ link sản phẩm: hộp chia sẻ của hệ điều hành (Web Share API) khi trình duyệt có, không thì sao chép link.
 * Khách đã đăng nhập thì link kèm mã giới thiệu của chính họ (?ref=), cùng cách Mini App chia sẻ; khách chưa đăng nhập
 * chia sẻ link thường để không đứng tên mã của người khác.
 */
export default function ShareButton({ title, path }: { title: string; path: string }) {
  const { user } = useAuth();
  const [note, setNote] = useState<Note>(null);

  const onShare = async () => {
    const ref = user?.referralCode;
    const url = `${window.location.origin}${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (e) {
        // Khách đóng hộp chia sẻ: không phải lỗi, không sao chép thay.
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setNote({ text: 'Đã sao chép liên kết sản phẩm.', error: false });
    } catch {
      setNote({ text: 'Không sao chép được. Bạn chép liên kết trên thanh địa chỉ nhé.', error: true });
    }
  };

  return (
    <div className="flex flex-col items-end">
      <button type="button" onClick={() => void onShare()} className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm font-semibold text-forest-700 hover:underline">
        <Share2 className="h-4 w-4" aria-hidden="true" />
        Chia sẻ
      </button>
      {note && (
        <p role="status" className={`text-xs ${note.error ? 'text-danger-fg' : 'text-success-fg'}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
