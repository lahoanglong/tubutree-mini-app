'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Share2 } from 'lucide-react';
import { fetchContentKit } from '@tubutree/app-core/api/affiliate';
import { coreHttp } from '@/lib/core-http';
import { platformBridge } from '@/lib/platform-bridge';
import { SITE_URL } from '@/lib/site';
import { ui } from '@/lib/guest-ui';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { QrCode } from '@/components/ui/qr-code';
import { absoluteKitLink, shareCaptions, shareFallbackText, storefrontShareUrl, withAbsoluteLink } from './storefront-rules';
import { loadErrorText } from '@/lib/error-text';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';

const errText = loadErrorText;
const COPY_FAILED = 'Không sao chép được — hãy chọn và chép thủ công.';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type Note = { text: string; error: boolean } | null;

/** Thành công đọc lịch sự qua vùng `status` có sẵn; lỗi là `alert` riêng nên trình đọc màn hình đọc ngay. */
function NoteLine({ note }: { note: Note }) {
  return (
    <>
      <div role="status" aria-live="polite">
        {note && !note.error && <p className="mb-2 text-sm font-medium text-success-fg">{note.text}</p>}
      </div>
      {note?.error && (
        <p role="alert" className="mb-2 text-sm text-danger-fg">
          {note.text}
        </p>
      )}
    </>
  );
}

/**
 * Một việc chia sẻ/sao chép chạy tại một thời điểm: bấm thêm lúc đang chạy bị bỏ qua, khỏi gọi lặp hộp chia sẻ
 * hay clipboard. Ref chặn hai cú bấm sát nhau trước khi state kịp vẽ lại; `active` là loại việc đang chạy để nút
 * đúng loại báo bận. Nút báo khoá bằng `aria-disabled`, không dùng `disabled` thật: nút đang giữ focus mà
 * `disabled` thì Chromium thả focus về body.
 */
export function useActionLock() {
  const lockRef = useRef(false);
  const [active, setActive] = useState<string | null>(null);
  const run = useCallback(async (kind: string, task: () => Promise<unknown>) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setActive(kind);
    try {
      await task();
    } finally {
      lockRef.current = false;
      setActive(null);
    }
  }, []);
  return { busy: active !== null, active, run };
}

/** Hàng chạm-để-sao-chép: nút thật để có Tab/Enter và vùng chạm >= 44px. */
function CopyRow({ onPress, busy, children }: { onPress: () => void; busy: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-disabled={busy || undefined}
      onClick={onPress}
      className="mb-1.5 block min-h-11 w-full rounded-control bg-stone-100 px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-200 aria-disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/** Chia sẻ gian hàng: QR, nút chia sẻ, sao chép link và bài mẫu; mã giới thiệu của chủ đi kèm ở MỌI lối. */
export function StorefrontShareSheet({
  open,
  onClose,
  slug,
  title,
  referralCode,
  heading,
  home,
  captions: captionsProp,
}: {
  open: boolean;
  onClose: () => void;
  /** Bắt buộc khi không chia sẻ trang chủ (`home`). */
  slug?: string;
  title: string;
  referralCode?: string | null;
  /** Tiêu đề bảng; mặc định "Chia sẻ gian hàng". */
  heading?: string;
  /** Chia sẻ trang chủ kèm mã giới thiệu (CTV chia sẻ mã) thay cho một gian hàng. */
  home?: boolean;
  /** Lời đăng gợi ý riêng; link được nối thêm nếu lời chưa có. */
  captions?: string[];
}) {
  const [note, setNote] = useState<Note>(null);
  const lock = useActionLock();
  useEffect(() => {
    setNote(null);
  }, [open, slug]);
  const path = home ? `/${referralCode ? `?ref=${referralCode}` : ''}` : `/s/${slug}${referralCode ? `?ref=${referralCode}` : ''}`;
  const url = home ? `${SITE_URL}${path}` : storefrontShareUrl(SITE_URL, slug ?? '', referralCode);
  const captions = captionsProp ? captionsProp.map((c) => (c.includes(url) ? c : `${c} ${url}`)) : shareCaptions(url);

  const copy = (text: string) =>
    lock.run('copy', async () => {
      const ok = await copyText(text);
      setNote(ok ? { text: 'Đã sao chép', error: false } : { text: COPY_FAILED, error: true });
    });
  const share = () =>
    lock.run('share', async () => {
      const result = await platformBridge.share({ title, text: captions[0], path });
      if (result === 'copied') setNote({ text: 'Đã sao chép', error: false });
      else if (result === 'failed') setNote({ text: 'Chưa chia sẻ được — hãy chọn rồi chép liên kết thủ công.', error: true });
      else setNote(null);
    });

  return (
    <Sheet open={open} onClose={onClose} title={heading ?? 'Chia sẻ gian hàng'}>
      <div className="mb-3 flex justify-center">
        <QrCode value={url} />
      </div>
      <NoteLine note={note} />
      <div className="mb-3 flex flex-col gap-2">
        <button
          type="button"
          className={ui.btnPrimary}
          aria-disabled={lock.busy || undefined}
          aria-busy={lock.active === 'share' || undefined}
          onClick={() => void share()}
        >
          <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Chia sẻ
        </button>
        <button type="button" className={ui.btnSecondary} aria-disabled={lock.busy || undefined} onClick={() => void copy(url)}>
          <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Sao chép link
        </button>
      </div>
      <section aria-label="Lời đăng gợi ý (chạm để sao chép)">
        <div className="mb-1.5 text-sm font-medium text-stone-800">Lời đăng gợi ý (chạm để sao chép)</div>
        {captions.map((c) => (
          <CopyRow key={c} busy={lock.busy} onPress={() => void copy(c)}>
            {c}
          </CopyRow>
        ))}
      </section>
    </Sheet>
  );
}

/** "Bộ nội dung bán hàng" theo từng sản phẩm: bài mẫu đã chèn tên CTV + link giới thiệu, USP, FAQ, video tham khảo. */
export function ContentKitSheet({ open, onClose, productSlug }: { open: boolean; onClose: () => void; productSlug: string }) {
  const [note, setNote] = useState<Note>(null);
  const lock = useActionLock();
  useEffect(() => {
    setNote(null);
  }, [open, productSlug]);
  const q = useQuery({
    queryKey: ['content-kit', productSlug],
    queryFn: () => fetchContentKit(coreHttp, productSlug),
    enabled: open && productSlug !== '',
  });

  const copyNow = async (text: string) => {
    const ok = await copyText(text);
    setNote(ok ? { text: 'Đã sao chép', error: false } : { text: COPY_FAILED, error: true });
  };
  const copy = (text: string) => lock.run('copy', () => copyNow(text));

  const data = q.data;
  const link = data ? absoluteKitLink(SITE_URL, data.shareLink) : '';
  const captions = data ? data.captions.map((c) => withAbsoluteLink(c, data.shareLink, link)) : [];
  const hasContent = data && (captions.length > 0 || data.usps.length > 0 || data.faqs.length > 0 || data.videoUrls.length > 0);

  const share = () =>
    lock.run('share', async () => {
      if (!data) return;
      // Hộp chia sẻ của web chỉ dựng link từ đường dẫn của chính web; URL tuyệt đối của nơi khác thì chép sẵn để dán.
      if (!link.startsWith(SITE_URL)) return copyNow(shareFallbackText(captions[0], link));
      const url = new URL(link);
      const result = await platformBridge.share({ title: data.productName, text: captions[0] ?? data.productName, path: `${url.pathname}${url.search}` });
      if (result === 'copied') setNote({ text: 'Đã sao chép', error: false });
      else if (result === 'failed') await copyNow(shareFallbackText(captions[0], link));
      else setNote(null);
    });

  return (
    <Sheet open={open} onClose={onClose} title="Nội dung bán hàng">
      {q.isLoading && (
        <div role="status" aria-busy="true" className="space-y-2">
          <Skeleton height={60} />
          <Skeleton height={60} />
        </div>
      )}
      {q.isError && (
        <ErrorState
          message={errText(q.error)}
          onRetry={() => (q.isFetching ? undefined : q.refetch())}
        />
      )}
      {data && (
        <>
          {data.images.length > 0 && (
            <div className="mb-3 flex gap-2 overflow-x-auto">
              {data.images.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt={data.productName} className="h-[72px] w-[72px] shrink-0 rounded-control object-cover" onError={hideBrokenImage} />
              ))}
            </div>
          )}
          <NoteLine note={note} />
          <div className="mb-3 flex flex-col gap-2">
            <button
              type="button"
              className={ui.btnPrimary}
              aria-disabled={lock.busy || undefined}
              aria-busy={lock.active === 'share' || undefined}
              onClick={() => void share()}
            >
              <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Chia sẻ
            </button>
            <button type="button" className={ui.btnSecondary} aria-disabled={lock.busy || undefined} onClick={() => void copy(link)}>
              <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Sao chép link
            </button>
          </div>
          {!hasContent && <p className="text-sm text-stone-600">Sản phẩm này chưa có nội dung mẫu.</p>}
          {captions.length > 0 && (
            <section aria-label="Bài mẫu (chạm để sao chép)" className="mb-3">
              <h3 className="mb-1.5 text-sm font-semibold text-stone-900">Bài mẫu (chạm để sao chép)</h3>
              {captions.map((c, i) => (
                <CopyRow key={i} busy={lock.busy} onPress={() => void copy(c)}>
                  {c}
                </CopyRow>
              ))}
            </section>
          )}
          {data.usps.length > 0 && (
            <section aria-label="Điểm bán hàng" className="mb-3">
              <h3 className="mb-1.5 text-sm font-semibold text-stone-900">Điểm bán hàng</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-stone-800">
                {data.usps.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </section>
          )}
          {data.faqs.length > 0 && (
            <section aria-label="Câu hỏi thường gặp" className="mb-3">
              <h3 className="mb-1.5 text-sm font-semibold text-stone-900">Câu hỏi thường gặp</h3>
              {data.faqs.map((f, i) => (
                <div key={i} className="mb-2 text-sm">
                  <div className="font-semibold text-stone-900">{f.q}</div>
                  <div className="text-stone-700">{f.a}</div>
                </div>
              ))}
            </section>
          )}
          {data.videoUrls.length > 0 && (
            <section aria-label="Video tham khảo" className="mb-3">
              <h3 className="mb-1.5 text-sm font-semibold text-stone-900">Video tham khảo</h3>
              {data.videoUrls.map((u, i) => (
                <CopyRow key={i} busy={lock.busy} onPress={() => void copy(u)}>
                  <span className="break-all text-forest-700">{u}</span>
                </CopyRow>
              ))}
            </section>
          )}
        </>
      )}
    </Sheet>
  );
}
