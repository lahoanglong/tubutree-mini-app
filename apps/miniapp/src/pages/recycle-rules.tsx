import { Page } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { getWasteRules, WASTE_QUERY_KEYS } from '../services/waste-api';
import { getErrorMessage } from '../services/api';
import { ErrorState } from '../components/ui/empty-state';
import { Skeleton } from '../components/ui/skeleton';
import { PageHeader } from '../components/ui/page-header';
import { Text } from '../components/ui/text';

export default function RecycleRulesPage() {
  const rulesQ = useQuery({ queryKey: [...WASTE_QUERY_KEYS.all, 'rules'], queryFn: getWasteRules });

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Thể lệ Đổi rác lấy quà" />
      <div style={{ padding: 16 }}>
        {rulesQ.isPending ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton height={16} />
            <Skeleton height={16} />
            <Skeleton height={16} width="70%" />
          </div>
        ) : rulesQ.isError ? (
          <ErrorState message={getErrorMessage(rulesQ.error)} onRetry={() => void rulesQ.refetch()} variant="inline" />
        ) : (
          <Text variant="body-md" as="div" style={{ whiteSpace: 'pre-line' }}>
            {rulesQ.data.text ?? 'Thể lệ đang được cập nhật'}
          </Text>
        )}
      </div>
    </Page>
  );
}
