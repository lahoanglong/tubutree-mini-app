import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_LEGAL_SUPPORT, DEFAULT_LEGAL_VARS, LEGAL_DRAFT_NOTICE, LEGAL_PAGES, legalSummary, legalWebAddress, merchantIdentityOrDefault, type LegalVars } from '@tubutree/app-core/legal-core';
import { fetchLegalDoc, type LegalSlug } from '../services/legal-api';
import { usePublicConfig } from '../hooks/use-public-config';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { ErrorState } from './ui/empty-state';
import { Skeleton } from './ui/skeleton';
import { Text } from './ui/text';
import { LegalMarkdown } from './legal-markdown';
import { getLoadErrorMessage } from '../services/api';
import { WEB_BASE_URL } from '../utils/web-base-url';

export const POLICY_TITLES: Record<LegalSlug, string> = {
  'dieu-khoan': LEGAL_PAGES['dieu-khoan'].title,
  'bao-mat': LEGAL_PAGES['bao-mat'].title,
  'doi-tra': LEGAL_PAGES['doi-tra'].title,
  'van-chuyen': LEGAL_PAGES['van-chuyen'].title,
  'thanh-toan': LEGAL_PAGES['thanh-toan'].title,
};

/**
 * Số liệu cho bản tóm tắt: vars của endpoint khi admin chưa nhập nội dung; không tải được thì số chuẩn và mức miễn phí giao của cấu hình công khai.
 * Đơn vị vận hành luôn có tên (admin chưa nhập thì là thương nhân đã đăng ký), để bản tóm tắt không lộ chỗ trống "[Tên công ty]".
 */
function summaryVars(vars: LegalVars | undefined, freeshipThreshold: number | undefined): LegalVars {
  const base = vars ?? { ...DEFAULT_LEGAL_VARS, ...(typeof freeshipThreshold === 'number' ? { freeshipThreshold } : {}) };
  return { ...base, ...merchantIdentityOrDefault(base) };
}

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
  const support = {
    hotline: cfg.support?.hotline?.trim() || DEFAULT_LEGAL_SUPPORT.hotline,
    email: cfg.support?.email?.trim() || DEFAULT_LEGAL_SUPPORT.email,
  };
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
      ) : q.data?.content ? (
        <LegalMarkdown source={q.data.content} onPolicy={setLinked} />
      ) : q.data || q.isError ? (
        <>
          {q.isError ? (
            <ErrorState variant="inline" message={getLoadErrorMessage(q.error)} onRetry={() => q.refetch()} />
          ) : (
            <div role="note" data-testid="legal-draft-banner" style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 12, background: 'var(--color-status-warning-bg)', color: 'var(--color-status-warning-fg)' }}>
              <Text variant="body-sm" as="p" style={{ margin: 0, fontWeight: 600, color: 'inherit' }}>
                {LEGAL_DRAFT_NOTICE}. Dưới đây là bản tóm tắt, bản đầy đủ đăng tại {legalWebAddress(active, WEB_BASE_URL)}.
              </Text>
            </div>
          )}
          <LegalMarkdown onPolicy={setLinked} source={legalSummary(active, summaryVars(q.data?.vars, cfg.freeshipThreshold), support, WEB_BASE_URL)} />
        </>
      ) : null}
    </BottomSheet>
  );
}
