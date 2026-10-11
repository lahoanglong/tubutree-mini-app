import { useSnackbar } from 'zmp-ui';
import { Share2, Copy } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchContentKit } from '../services/affiliate-api';
import { getErrorMessage } from '../services/api';
import { useShareWithFallback } from './share-sheet';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Heading, Text } from './ui/text';
import { Skeleton } from './ui/skeleton';
import { ErrorState } from './ui/empty-state';
import { copyText } from '../utils/clipboard';
import { WEB_BASE_URL } from '../utils/web-base-url';

/**
 * `app.miniapp_base_url` chưa cấu hình thì API trả đường dẫn tương đối ('/product/..?ref=..'): dán
 * vào Zalo/Facebook không mở được. Ghép domain web (cùng nguồn với share-sheet/affiliate).
 */
function absoluteLink(link: string): string {
  if (!link.startsWith('/')) return link;
  return `${WEB_BASE_URL}${link}`;
}

/** Bài mẫu do admin soạn tay có thể thiếu {link}: chép thiếu mã giới thiệu thì CTV mất hoa hồng. */
function shareFallbackText(caption: string | undefined, link: string): string {
  if (!caption) return link;
  return caption.includes('ref=') ? caption : `${caption} ${link}`;
}

/**
 * "Bộ nội dung bán hàng" theo từng sản phẩm — CTV mở lên là copy/chia sẻ được ngay:
 * bài mẫu đã tự chèn tên CTV + link giới thiệu, USP, FAQ, video tham khảo.
 */
export function ContentKitSheet({
  visible,
  onClose,
  productSlug,
}: {
  visible: boolean;
  onClose: () => void;
  productSlug: string;
}) {
  const { openSnackbar } = useSnackbar();
  const shareWithFallback = useShareWithFallback();
  const q = useQuery({
    queryKey: ['content-kit', productSlug],
    queryFn: () => fetchContentKit(productSlug),
    enabled: visible,
  });

  // Trước đây không có clipboard thì `return` im lặng: chạm vào bài mẫu không có gì xảy ra và
  // cũng không nói vì sao. copyText còn có phương án execCommand cho webview cũ.
  const copy = async (text: string) => {
    const ok = await copyText(text);
    if (ok) haptic('light');
    openSnackbar(
      ok
        ? { text: vi.contentKit.copied, type: 'success' }
        : { text: 'Không sao chép được — hãy chọn và chép thủ công.', type: 'error' },
    );
  };

  const data = q.data;
  const link = data ? absoluteLink(data.shareLink) : '';
  const hasContent =
    data && (data.captions.length > 0 || data.usps.length > 0 || data.faqs.length > 0 || data.videoUrls.length > 0);

  return (
    <BottomSheet open={visible} onClose={onClose} title={vi.contentKit.sheetTitle}>
      <div style={{ maxHeight: '70vh', overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {q.isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton height={60} radius="var(--radius-card)" />
            <Skeleton height={60} radius="var(--radius-card)" />
          </div>
        )}

        {q.isError && <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />}

        {data && (
          <>
            {data.images.length > 0 && (
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 12 }}>
                {data.images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={data.productName}
                    style={{ width: 72, height: 72, borderRadius: 'var(--radius-media)', objectFit: 'cover', flexShrink: 0 }}
                  />
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              <Button
                fullWidth
                icon={Share2}
                onPress={() => {
                  haptic('light');
                  void shareWithFallback(
                    {
                      title: data.productName,
                      description: data.captions[0] ?? data.productName,
                      thumbnail: data.images[0],
                      path: data.shareLink,
                    },
                    shareFallbackText(data.captions[0], link),
                  );
                }}
              >
                {vi.contentKit.shareZalo}
              </Button>
              <Button fullWidth variant="secondary" icon={Copy} onPress={() => copy(link)}>
                {vi.contentKit.copyLink}
              </Button>
            </div>

            {!hasContent && (
              <Text variant="body-sm" tone="tertiary" as="div">
                {vi.contentKit.empty}
              </Text>
            )}

            {data.captions.length > 0 && (
              <Section title={vi.contentKit.captionsHeading}>
                {data.captions.map((c, i) => (
                  <CopyRow key={i} onPress={() => void copy(c)}>
                    <Text variant="caption" tone="secondary">{c}</Text>
                  </CopyRow>
                ))}
              </Section>
            )}

            {data.usps.length > 0 && (
              <Section title={vi.contentKit.uspsHeading}>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {data.usps.map((u, i) => (
                    <li key={i}>
                      <Text variant="body-sm">{u}</Text>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {data.faqs.length > 0 && (
              <Section title={vi.contentKit.faqHeading}>
                {data.faqs.map((f, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{f.q}</Text>
                    <Text variant="body-sm" tone="secondary" as="div">{f.a}</Text>
                  </div>
                ))}
              </Section>
            )}

            {data.videoUrls.length > 0 && (
              <Section title={vi.contentKit.videosHeading}>
                {data.videoUrls.map((url, i) => (
                  <CopyRow key={i} onPress={() => void copy(url)}>
                    <Text variant="caption" tone="brand" style={{ wordBreak: 'break-all' }}>{url}</Text>
                  </CopyRow>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}

/** Hàng chạm-để-sao-chép: `<button>` thật để có Tab/Enter và vùng chạm >= 44px. */
function CopyRow({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="tubu-press"
      onClick={onPress}
      style={{
        display: 'block',
        width: '100%',
        minHeight: 44,
        boxSizing: 'border-box',
        marginBottom: 6,
        padding: '8px 12px',
        textAlign: 'left',
        border: 'none',
        cursor: 'pointer',
        background: 'var(--color-bg-subtle)',
        borderRadius: 'var(--radius-control)',
      }}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 4, marginBottom: 12 }}>
      <Heading variant="title-sm" style={{ marginBottom: 6 }}>{title}</Heading>
      {children}
    </section>
  );
}
