import { Box, Text, Button } from 'zmp-ui';
import { Skeleton } from '../ui/skeleton';
import { vi } from '../../i18n/vi';

export function GameSkeleton() {
  return (
    <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
      <Skeleton style={{ height: 180, borderRadius: 'var(--radius-lg)' }} />
      <Skeleton style={{ height: 56, borderRadius: 'var(--radius-lg)' }} />
      <Skeleton style={{ height: 56, borderRadius: 'var(--radius-lg)' }} />
      <Skeleton style={{ height: 140, borderRadius: 'var(--radius-lg)' }} />
    </Box>
  );
}

export function GameLoginGate({ onLogin }: { onLogin: () => void }) {
  return (
    <Box style={{ textAlign: 'center', padding: 48 }}>
      <Text style={{ fontSize: 48 }}>🌱</Text>
      <Text style={{ marginTop: 8 }}>{vi.community.loginToView}</Text>
      <Button style={{ marginTop: 12, background: 'var(--leaf-600)' }} onClick={() => onLogin()}>
        {vi.auth.loginCta}
      </Button>
    </Box>
  );
}
