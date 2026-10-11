import type { ReactNode } from 'react';
import { Box, Text } from 'zmp-ui';
import { ChevronRight } from 'lucide-react';

export function GameLinkRow({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <Box
      className="tubu-press"
      mx={3}
      mt={2}
      p={3}
      onClick={onClick}
      style={{
        background: 'var(--neutral-0)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--leaf-100)',
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Box flex alignItems="center" style={{ gap: 8 }}>
        <Box
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--leaf-50)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {icon}
        </Box>
        <Box>
          <Text size="small" bold>{title}</Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
            {hint}
          </Text>
        </Box>
      </Box>
      <ChevronRight size={18} color="var(--leaf-700)" />
    </Box>
  );
}
