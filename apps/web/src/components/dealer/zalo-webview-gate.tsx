'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { copyText } from '@/lib/copy-text';
import { ui } from '@/lib/guest-ui';
import { PAGE_NARROW } from '@/lib/page-frame';
import { SITE_URL } from '@/lib/site';
import { useHydrated } from '@/lib/use-hydrated';
import { HIDE_IN_ZALO_WEBVIEW, SHOW_IN_ZALO_WEBVIEW, isZaloWebViewUserAgent } from '@/lib/zalo-webview';

export const ZALO_GATE_TITLE = 'Mở trên trình duyệt ngoài';
export const ZALO_GATE_BODY = 'Kênh đại lý chạy trên trình duyệt của điện thoại, không chạy trong Zalo. Sao chép liên kết, mở Safari hoặc Chrome rồi dán vào thanh địa chỉ.';
export const ZALO_GATE_COPY_LABEL = 'Sao chép liên kết';
const COPIED = 'Đã sao chép liên kết. Dán vào Safari hoặc Chrome để mở.';
const COPY_FAILED = 'Chưa sao chép được, hãy giữ vào liên kết ở trên để chép.';

/** Link khách dán vào trình duyệt ngoài: trang gốc của kênh đại lý, không kèm tham số nào của lần mở này. */
export const DEALER_BROWSER_URL = `${SITE_URL}/dai-ly`;

function ZaloWebViewGateScreen() {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const copy = async () => {
    const ok = await copyText(DEALER_BROWSER_URL);
    setStatus({ ok, text: ok ? COPIED : COPY_FAILED });
  };
  return (
    <main className={`${PAGE_NARROW} py-10`} data-zalo-webview-gate>
      <div className={`${ui.card} flex flex-col items-center gap-3 p-6 text-center`}>
        <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-forest-50 text-forest-700">
          <ExternalLink className="h-7 w-7" strokeWidth={1.75} />
        </span>
        <h1 className={ui.pageTitle}>{ZALO_GATE_TITLE}</h1>
        <p className="max-w-sm text-sm text-stone-700">{ZALO_GATE_BODY}</p>
        <code className="max-w-full select-all break-all rounded bg-stone-100 px-2 py-1.5 text-sm text-stone-900">{DEALER_BROWSER_URL}</code>
        <button type="button" onClick={() => void copy()} className={`${ui.btnPrimary} w-full max-w-sm`}>
          {ZALO_GATE_COPY_LABEL}
        </button>
        <p role="status" className={`min-h-5 text-sm ${status && !status.ok ? 'text-danger-fg' : 'text-stone-700'}`}>
          {status?.text}
        </p>
        <Link href="/" className={ui.btnText}>
          Về trang chủ
        </Link>
      </div>
    </main>
  );
}

/**
 * Chặn `/dai-ly` trong WebView của Zalo (w33-01: Mini App không mở kênh đại lý có đăng ký và thanh toán bên trong Zalo, nhưng link web vẫn dẫn
 * tới đây). Trang dựng sẵn (ISR) giống nhau cho mọi người nên nhận diện ở trình duyệt:
 * - Trước hydrate: HTML có cả nội dung thật lẫn màn chặn; script ở <head> của `app/layout.tsx` đặt `data-zalo-webview` lên <html> trước khi vẽ, CSS giấu
 *   nội dung thật và hiện màn chặn nên khách trong Zalo không thấy nội dung thật chớp lên. Khách ngoài Zalo thấy nội dung ngay như cũ.
 * - Sau hydrate: UA là Zalo thì gỡ hẳn nội dung thật (không gọi API, không dựng form) và chỉ giữ màn chặn; ngoài Zalo thì gỡ màn chặn.
 *   Nội dung thật luôn là con đầu của cùng một thẻ bọc nên không bị dựng lại khi hydrate xong.
 */
export function ZaloWebViewGate({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const inZalo = hydrated && isZaloWebViewUserAgent(navigator.userAgent);
  return (
    <>
      <div className={hydrated ? undefined : HIDE_IN_ZALO_WEBVIEW}>{inZalo ? null : children}</div>
      {(!hydrated || inZalo) && (
        <div className={hydrated ? undefined : SHOW_IN_ZALO_WEBVIEW}>
          <ZaloWebViewGateScreen />
        </div>
      )}
    </>
  );
}
