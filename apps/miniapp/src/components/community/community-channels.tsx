import { ExternalLink } from 'lucide-react';
import { usePublicConfig } from '../../hooks/use-public-config';
import { vi } from '../../i18n/vi';
import { openExternal } from '../../services/zmp-bridge';
import { haptic } from '../../utils/haptic';
import { Text } from '../ui/text';

/** Chip mở kênh cộng đồng của chủ shop (nhóm Zalo, Facebook, TikTok); chỉ vẽ kênh admin đã nhập link https, không có kênh nào thì không vẽ gì. */
export function CommunityChannels() {
  const { community } = usePublicConfig();
  const all: { label: string; url: string | null | undefined }[] = [
    { label: vi.community.channelZalo, url: community?.zaloGroupUrl },
    { label: vi.community.channelFacebook, url: community?.facebookUrl },
    { label: vi.community.channelTiktok, url: community?.tiktokUrl },
  ];
  const channels = all.filter((c): c is { label: string; url: string } => typeof c.url === 'string' && c.url.startsWith('https://'));
  if (channels.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={vi.community.channelsLabel}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 16px 12px', background: 'var(--color-bg-surface)' }}
    >
      {channels.map((c) => (
        <button
          key={c.label}
          type="button"
          className="tubu-press"
          onClick={() => {
            haptic('light');
            void openExternal(c.url);
          }}
          style={{
            minHeight: 44,
            padding: '0 14px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--color-bg-canvas)',
            cursor: 'pointer',
          }}
        >
          <ExternalLink size={14} aria-hidden />
          <Text variant="caption" tone="brand" style={{ fontWeight: 600 }}>
            {c.label}
          </Text>
        </button>
      ))}
    </div>
  );
}
