import type { ReactNode } from 'react';
import { Box, Text } from 'zmp-ui';

export function GameCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
      <Text bold size="small" style={{ marginBottom: 8 }}>
        {title}
      </Text>
      {children}
    </Box>
  );
}
