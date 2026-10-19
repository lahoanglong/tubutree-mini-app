'use client';

import { useState, type ReactNode } from 'react';
import { Copy, Share2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { contentKitQuery } from '@tubutree/app-core/queries/affiliate';
import { Sheet } from '@/components/ui/sheet';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { absoluteLink, shareFallbackText, withAbsoluteLink } from '@/lib/content-kit-link';

type Note = { text: string; error: boolean } | null;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * "Bộ nội dung bán hàng" theo từng sản phẩm: bài mẫu đã chèn tên CTV và link giới thiệu, điểm bán hàng, hỏi đáp, video.
 * Chỉ mở cho CTV (trang cha kiểm), cùng endpoint với Mini App.
 */
export function ContentKitSheet({ visible, onClose, productSlug }: { visible: boolean; onClose: () => void; productSlug: string }) {
  const [note, setNote] = useState<Note>(null);
  const q = useQuery({ ...contentKitQuery(coreHttp, productSlug), enabled: visible });

  const data = q.data;
  const link = data ? absoluteLink(data.shareLink, window.location.origin) : '';
  // API thay {link} trong bài mẫu bằng đúng `shareLink`; khi đó là đường dẫn tương đối thì bài mẫu cũng phải mang link tuyệt đối.
  const captions = data ? data.captions.map((c) => withAbsoluteLink(c, data.shareLink, link)) : [];
  const hasContent = data && (captions.length > 0 || data.usps.length > 0 || data.faqs.length > 0 || data.videoUrls.length > 0);

  const doCopy = async (text: string) => {
    const ok = await copy(text);
    setNote(ok ? { text: 'Đã sao chép', error: false } : { text: 'Không sao chép được — hãy chọn và chép thủ công.', error: true });
  };

  const doShare = async () => {
    if (!data) return;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: data.productName, text: captions[0] ?? data.productName, url: link });
        return;
      } catch (e) {
        // Khách đóng hộp chia sẻ: không phải lỗi, không chép thay.
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    await doCopy(shareFallbackText(captions[0], link));
  };

  return (
    <Sheet open={visible} onClose={onClose} title="Nội dung bán hàng" size="full">
      {q.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton height={60} />
          <Skeleton height={60} />
        </div>
      )}
      {q.isError && <ErrorState message={q.error instanceof Error ? q.error.message : undefined} onRetry={() => void q.refetch()} />}

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

          <div className="mb-3 flex flex-col gap-2">
            <button type="button" className={`${ui.btnPrimary} w-full gap-2`} onClick={() => void doShare()}>
              <Share2 className="h-4 w-4" aria-hidden="true" />
              Chia sẻ
            </button>
            <button type="button" className={`${ui.btnSecondary} w-full gap-2`} onClick={() => void doCopy(link)}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              Sao chép link
            </button>
            {note && (
              <p role="status" className={`text-sm ${note.error ? 'text-danger-fg' : 'text-success-fg'}`}>
                {note.text}
              </p>
            )}
          </div>

          {!hasContent && <p className="text-sm text-stone-600">Sản phẩm này chưa có nội dung mẫu.</p>}

          {captions.length > 0 && (
            <Section title="Bài mẫu (chạm để sao chép)">
              {captions.map((c, i) => (
                <CopyRow key={i} onPress={() => void doCopy(c)}>
                  <span className="text-sm text-stone-700">{c}</span>
                </CopyRow>
              ))}
            </Section>
          )}

          {data.usps.length > 0 && (
            <Section title="Điểm bán hàng">
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                {data.usps.map((u, i) => (
                  <li key={i} className="text-sm text-stone-900">
                    {u}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {data.faqs.length > 0 && (
            <Section title="Câu hỏi thường gặp">
              {data.faqs.map((f, i) => (
                <div key={i} className="mb-2">
                  <div className="text-sm font-semibold text-stone-900">{f.q}</div>
                  <div className="text-sm text-stone-700">{f.a}</div>
                </div>
              ))}
            </Section>
          )}

          {data.videoUrls.length > 0 && (
            <Section title="Video tham khảo">
              {data.videoUrls.map((url, i) => (
                <CopyRow key={i} onPress={() => void doCopy(url)}>
                  <span className="break-all text-sm text-forest-700">{url}</span>
                </CopyRow>
              ))}
            </Section>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Hàng chạm-để-sao-chép: `<button>` thật để có Tab/Enter và vùng chạm >= 44px. */
function CopyRow({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onPress} className="mb-1.5 block min-h-11 w-full rounded-control bg-stone-100 px-3 py-2 text-left hover:bg-stone-200">
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3 mt-1">
      <h3 className="mb-1.5 text-base font-semibold text-stone-900">{title}</h3>
      {children}
    </section>
  );
}
