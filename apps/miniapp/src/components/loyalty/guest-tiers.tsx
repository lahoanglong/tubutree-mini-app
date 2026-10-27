import { useQuery } from '@tanstack/react-query';
import { guestPreviewCopy, tierRequirementText } from '@tubutree/app-core/guest-preview';
import { loyaltyPreviewQuery } from '@tubutree/app-core/queries/loyalty';
import { coreHttp } from '../../services/core-http';
import { getLoadErrorMessage } from '../../services/api';
import { useAuthStore } from '../../store/auth';
import { formatMultiplier, formatPoints } from '../../utils/format';
import { moneyShort } from '../../utils/loyalty-copy';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { ErrorState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';

const COLUMN = { display: 'flex', flexDirection: 'column' } as const;

/** Nút đăng nhập của màn xem trước dành cho khách. */
export function GuestLoginButton() {
  const login = useAuthStore((s) => s.login);
  return <Button fullWidth onPress={() => void login()}>{guestPreviewCopy.loginCta}</Button>;
}

/** Màn Hạng thành viên cho khách chưa đăng nhập: chỉ xem bảng hạng, muốn đổi hay xem điểm của mình thì đăng nhập. */
export function GuestTiers() {
  const q = useQuery(loyaltyPreviewQuery(coreHttp));
  return (
    <div style={{ ...COLUMN, padding: 16, gap: 16 }}>
      <Text variant="body-md" tone="secondary" as="div">{guestPreviewCopy.hint}</Text>
      <GuestLoginButton />
      <Heading variant="title-md" as="h2">{guestPreviewCopy.tiersTitle}</Heading>
      {q.isError && !q.data ? (
        <ErrorState message={getLoadErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton height={120} />
      ) : (
        <div style={{ ...COLUMN, gap: 12 }}>
          {q.data.tiers.map((t) => (
            <Card key={t.id} variant="outline">
              <div data-tier style={{ ...COLUMN, gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>{t.name}</Text>
                  <Text variant="caption" tone="brand" as="div">{`Điểm x${formatMultiplier(t.multiplier)}`}</Text>
                </div>
                <Text variant="caption" tone="secondary" as="div">{tierRequirementText(t, formatPoints, moneyShort)}</Text>
                {t.perks.map((p) => (
                  <Text key={p} variant="caption" tone="tertiary" as="div">{p}</Text>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
