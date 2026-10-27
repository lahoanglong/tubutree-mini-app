import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_LEGAL_SUPPORT, LEGAL_DRAFT_NOTICE, LEGAL_PAGES, defaultLegalContent } from '@tubutree/app-core/legal';
import { fetchLegalDoc, type LegalSlug } from '../services/legal-api';
import { usePublicConfig } from '../hooks/use-public-config';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { ErrorState } from './ui/empty-state';
import { Skeleton } from './ui/skeleton';
import { Text } from './ui/text';
import { LegalMarkdown } from './legal-markdown';
import { getLoadErrorMessage } from '../services/api';

export const POLICY_TITLES: Record<LegalSlug, string> = {
  'dieu-khoan': LEGAL_PAGES['dieu-khoan'].title,
  'bao-mat': LEGAL_PAGES['bao-mat'].title,
  'doi-tra': LEGAL_PAGES['doi-tra'].title,
  'van-chuyen': LEGAL_PAGES['van-chuyen'].title,
};

/** Chính sách hiện ngay trong app (popup), không mở trang ngoài. `slug` null = đóng. */
export function PolicySheet({ slug, onClose }: { slug: LegalSlug | null; onClose: () => void }) {
  // Giữ slug cuối để nội dung không biến mất trong lúc sheet trượt xuống.
  const [shown, setShown] = useState<LegalSlug>('dieu-khoan');
  useEffect(() => {
    if (slug) setShown(slug);
  }, [slug]);
  const [linked, setLinked] = useState<LegalSlug | null>(null);
  useEffect(() => {
    setLinked(null);
  }, [slug]);
  const active = linked ?? slug ?? shown;
  const cfg = usePublicConfig();
  const q = useQuery({ queryKey: ['legal-doc', active], queryFn: () => fetchLegalDoc(active), enabled: slug !== null || linked !== null, staleTime: 10 * 60_000 });

  return (
    <BottomSheet
      open={slug !== null}
      onClose={onClose}
      title={POLICY_TITLES[active]}
      size="full"
      footer={
        <Button fullWidth onPress={onClose}>
          Đã hiểu
        </Button>
      }
    >
      {q.isLoading ? (
        <div data-testid="policy-loading" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <Skeleton height={14} />
          <Skeleton height={14} width="90%" />
          <Skeleton height={14} width="75%" />
        </div>
      ) : q.isError ? (
        <ErrorState variant="inline" message={getLoadErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data?.content ? (
        <LegalMarkdown source={q.data.content} onPolicy={setLinked} />
      ) : q.data ? (
        <>
          <div role="note" data-testid="legal-draft-banner" style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 12, background: 'var(--color-status-warning-bg)', color: 'var(--color-status-warning-fg)' }}>
            <Text variant="body-sm" as="p" style={{ margin: 0, fontWeight: 600, color: 'inherit' }}>
              {LEGAL_DRAFT_NOTICE}. Nội dung dưới đây là bản soạn sẵn, các chỗ trong dấu [ ] sẽ được điền khi Tubu Tree duyệt.
            </Text>
          </div>
          <LegalMarkdown
            onPolicy={setLinked}
            source={defaultLegalContent(active, q.data.vars, {
              hotline: cfg.support?.hotline?.trim() || DEFAULT_LEGAL_SUPPORT.hotline,
              email: cfg.support?.email?.trim() || DEFAULT_LEGAL_SUPPORT.email,
            })}
          />
        </>
      ) : null}
    </BottomSheet>
  );
}
