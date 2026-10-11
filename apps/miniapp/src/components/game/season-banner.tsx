import { Box, Text } from 'zmp-ui';
import type { Season } from '../../services/game-api';

export function SeasonBanner({ season }: { season: Season }) {
  return (
    <Box mx={3} mt={2} p={3} style={{ background: 'linear-gradient(120deg, var(--leaf-50), var(--primary-50))', borderRadius: 'var(--radius-lg)', border: '1px solid var(--leaf-400)' }}>
      <Box flex alignItems="center" justifyContent="space-between">
        <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>
          🍃 {season.name}
        </Text>
        <Text style={{ fontSize: 18 }}>
          {season.featuredSpecies.map((s) => s.emoji).join(' ')}
        </Text>
      </Box>
      {(season.theme || season.region) && (
        <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
          {[season.theme, season.region].filter(Boolean).join(' · ')}
        </Text>
      )}
      {season.featuredSpecies.length > 0 && (
        <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
          Loài nổi bật mùa này: {season.featuredSpecies.map((s) => s.name).join(', ')}
        </Text>
      )}
    </Box>
  );
}
