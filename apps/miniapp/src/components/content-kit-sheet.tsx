import { Box, Sheet, Text, Button, useSnackbar } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchContentKit } from '../services/affiliate-api';
import { getErrorMessage } from '../services/api';
import { shareLink } from '../services/zmp-bridge';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { Skeleton } from './ui/skeleton';
import { ErrorState } from './ui/empty-state';

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
  const q = useQuery({
    queryKey: ['content-kit', productSlug],
    queryFn: () => fetchContentKit(productSlug),
    enabled: visible,
  });

  const copy = (text: string) => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      haptic('light');
      openSnackbar({ text: vi.contentKit.copied, type: 'success' });
    }
  };

  const data = q.data;
  const hasContent =
    data && (data.captions.length > 0 || data.usps.length > 0 || data.faqs.length > 0 || data.videoUrls.length > 0);

  return (
    <Sheet visible={visible} onClose={onClose} autoHeight>
      <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))', maxHeight: '80vh', overflowY: 'auto' }}>
        <Text bold size="large" style={{ marginBottom: 12 }}>
          {vi.contentKit.sheetTitle}
        </Text>

        {q.isLoading && (
          <Box flex flexDirection="column" style={{ gap: 8 }}>
            <Skeleton style={{ height: 60, borderRadius: 12 }} />
            <Skeleton style={{ height: 60, borderRadius: 12 }} />
          </Box>
        )}

        {q.isError && <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />}

        {data && (
          <>
            {data.images.length > 0 && (
              <Box flex style={{ gap: 8, overflowX: 'auto', marginBottom: 12 }}>
                {data.images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={data.productName}
                    style={{ width: 72, height: 72, borderRadius: 'var(--radius-md)', objectFit: 'cover', flexShrink: 0 }}
                  />
                ))}
              </Box>
            )}

            <Button
              fullWidth
              style={{ background: 'var(--primary-600)', marginBottom: 8 }}
              onClick={() => {
                haptic('light');
                void shareLink({
                  title: data.productName,
                  description: data.captions[0] ?? data.productName,
                  thumbnail: data.images[0],
                  path: data.shareLink,
                }).catch(() => {});
              }}
            >
              ↗ {vi.contentKit.shareZalo}
            </Button>
            <Button fullWidth variant="secondary" style={{ marginBottom: 12 }} onClick={() => copy(data.shareLink)}>
              📋 {vi.contentKit.copyLink}
            </Button>

            {!hasContent && (
              <Text size="small" style={{ color: 'var(--neutral-400)' }}>
                {vi.contentKit.empty}
              </Text>
            )}

            {data.captions.length > 0 && (
              <Section title={vi.contentKit.captionsHeading}>
                {data.captions.map((c, i) => (
                  <Box
                    key={i}
                    className="tubu-press"
                    onClick={() => copy(c)}
                    p={2}
                    style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-sm)', marginBottom: 6 }}
                  >
                    <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
                      {c}
                    </Text>
                  </Box>
                ))}
              </Section>
            )}

            {data.usps.length > 0 && (
              <Section title={vi.contentKit.uspsHeading}>
                {data.usps.map((u, i) => (
                  <Text key={i} size="small" style={{ marginBottom: 4 }}>
                    • {u}
                  </Text>
                ))}
              </Section>
            )}

            {data.faqs.length > 0 && (
              <Section title={vi.contentKit.faqHeading}>
                {data.faqs.map((f, i) => (
                  <Box key={i} style={{ marginBottom: 8 }}>
                    <Text size="small" bold>
                      {f.q}
                    </Text>
                    <Text size="small" style={{ color: 'var(--neutral-600)' }}>
                      {f.a}
                    </Text>
                  </Box>
                ))}
              </Section>
            )}

            {data.videoUrls.length > 0 && (
              <Section title={vi.contentKit.videosHeading}>
                {data.videoUrls.map((url, i) => (
                  <Box
                    key={i}
                    className="tubu-press"
                    onClick={() => copy(url)}
                    p={2}
                    style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-sm)', marginBottom: 6 }}
                  >
                    <Text size="xSmall" style={{ color: 'var(--primary-700)' }}>
                      {url}
                    </Text>
                  </Box>
                ))}
              </Section>
            )}
          </>
        )}
      </Box>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box style={{ marginTop: 4, marginBottom: 12 }}>
      <Text size="xSmall" bold style={{ marginBottom: 6 }}>
        {title}
      </Text>
      {children}
    </Box>
  );
}
