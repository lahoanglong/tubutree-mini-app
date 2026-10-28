'use client';

import { useState } from 'react';
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

function NoteLine({ note }: { note: Note }) {
  return (
    <div role="status" aria-live="polite">
      {note && <p className={`mb-2 text-sm ${note.error ? 'text-danger-fg' : 'font-medium text-success-fg'}`}>{note.text}</p>}
    </div>
  );
}

/** Hàng chạm-để-sao-chép: nút thật để có Tab/Enter và vùng chạm >= 44px. */
function CopyRow({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onPress} className="mb-1.5 block min-h-11 w-full rounded-control bg-stone-100 px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-200">
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
  const path = home ? `/${referralCode ? `?ref=${referralCode}` : ''}` : `/s/${slug}${referralCode ? `?ref=${referralCode}` : ''}`;
  const url = home ? `${SITE_URL}${path}` : storefrontShareUrl(SITE_URL, slug ?? '', referralCode);
  const captions = captionsProp ? captionsProp.map((c) => (c.includes(url) ? c : `${c} ${url}`)) : shareCaptions(url);

  const copy = async (text: string) => {
    const ok = await copyText(text);
    setNote(ok ? { text: 'Đã sao chép', error: false } : { text: COPY_FAILED, error: true });
  };
  const share = async () => {
    const result = await platformBridge.share({ title, text: captions[0], path });
    if (result === 'copied') setNote({ text: 'Đã sao chép', error: false });
    else if (result === 'failed') setNote({ text: 'Chưa chia sẻ được — hãy chọn rồi chép liên kết thủ công.', error: true });
    else setNote(null);
  };

  return (
    <Sheet open={open} onClose={onClose} title={heading ?? 'Chia sẻ gian hàng'}>
      <div className="mb-3 flex justify-center">
        <QrCode value={url} />
      </div>
      <NoteLine note={note} />
      <div className="mb-3 flex flex-col gap-2">
        <button type="button" className={ui.btnPrimary} onClick={() => void share()}>
          <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Chia sẻ
        </button>
        <button type="button" className={ui.btnSecondary} onClick={() => void copy(url)}>
          <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Sao chép link
        </button>
      </div>
      <div className="mb-1.5 text-sm font-medium text-stone-800">Lời đăng gợi ý (chạm để sao chép)</div>
      {captions.map((c) => (
        <CopyRow key={c} onPress={() => void copy(c)}>
          {c}
        </CopyRow>
      ))}
    </Sheet>
  );
}

/** "Bộ nội dung bán hàng" theo từng sản phẩm: bài mẫu đã chèn tên CTV + link giới thiệu, USP, FAQ, video tham khảo. */
export function ContentKitSheet({ open, onClose, productSlug }: { open: boolean; onClose: () => void; productSlug: string }) {
  const [note, setNote] = useState<Note>(null);
  const q = useQuery({
    queryKey: ['content-kit', productSlug],
    queryFn: () => fetchContentKit(coreHttp, productSlug),
    enabled: open && productSlug !== '',
  });

  const copy = async (text: string) => {
    const ok = await copyText(text);
    setNote(ok ? { text: 'Đã sao chép', error: false } : { text: COPY_FAILED, error: true });
  };

  const data = q.data;
  const link = data ? absoluteKitLink(SITE_URL, data.shareLink) : '';
  const captions = data ? data.captions.map((c) => withAbsoluteLink(c, data.shareLink, link)) : [];
  const hasContent = data && (captions.length > 0 || data.usps.length > 0 || data.faqs.length > 0 || data.videoUrls.length > 0);

  const share = async () => {
    if (!data) return;
    // Hộp chia sẻ của web chỉ dựng link từ đường dẫn của chính web; URL tuyệt đối của nơi khác thì chép sẵn để dán.
    if (!link.startsWith(SITE_URL)) return void copy(shareFallbackText(captions[0], link));
    const url = new URL(link);
    const result = await platformBridge.share({ title: data.productName, text: captions[0] ?? data.productName, path: `${url.pathname}${url.search}` });
    if (result === 'copied') setNote({ text: 'Đã sao chép', error: false });
    else if (result === 'failed') void copy(shareFallbackText(captions[0], link));
    else setNote(null);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Nội dung bán hàng">
      {q.isLoading && (
        <div className="space-y-2">
          <Skeleton height={60} />
          <Skeleton height={60} />
        </div>
      )}
      {q.isError && <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />}
      {data && (
        <>
          {data.images.length > 0 && (
            <div className="mb-3 flex gap-2 overflow-x-auto">
              {data.images.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt={data.productName} className="h-[72px] w-[72px] shrink-0 rounded-control object-cover" />
              ))}
            </div>
          )}
          <NoteLine note={note} />
          <div className="mb-3 flex flex-col gap-2">
            <button type="button" className={ui.btnPrimary} onClick={() => void share()}>
              <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Chia sẻ
            </button>
            <button type="button" className={ui.btnSecondary} onClick={() => void copy(link)}>
              <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Sao chép link
            </button>
          </div>
          {!hasContent && <p className="text-sm text-stone-600">Sản phẩm này chưa có nội dung mẫu.</p>}
          {captions.length > 0 && (
            <section className="mb-3">
              <h3 className="mb-1.5 text-sm font-semibold text-stone-900">Bài mẫu (chạm để sao chép)</h3>
              {captions.map((c, i) => (
                <CopyRow key={i} onPress={() => void copy(c)}>
                  {c}
                </CopyRow>
              ))}
            </section>
          )}
          {data.usps.length > 0 && (
            <section className="mb-3">
              <h3 className="mb-1.5 text-sm font-semibold text-stone-900">Điểm bán hàng</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-stone-800">
                {data.usps.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </section>
          )}
          {data.faqs.length > 0 && (
            <section className="mb-3">
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
            <section className="mb-3">
              <h3 className="mb-1.5 text-sm font-semibold text-stone-900">Video tham khảo</h3>
              {data.videoUrls.map((u, i) => (
                <CopyRow key={i} onPress={() => void copy(u)}>
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
