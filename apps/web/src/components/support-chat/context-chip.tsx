import { Text } from '@/components/mini';

export function ContextChip({ label }: { label: string }) {
  return (
    <div style={{ padding: '8px 12px 0', background: 'var(--color-bg-surface)' }}>
      <span
        style={{
          display: 'inline-block',
          maxWidth: '100%',
          padding: '4px 10px',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--color-bg-subtle)',
          boxSizing: 'border-box',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        <Text variant="caption" tone="brand">{label}</Text>
      </span>
    </div>
  );
}
