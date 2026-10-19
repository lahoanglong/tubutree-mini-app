'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { coreHttp } from '@/lib/core-http';

/** Chip mở kênh cộng đồng của chủ shop (nhóm Zalo, Facebook, TikTok); chỉ vẽ kênh admin đã nhập link https, không có kênh nào thì không vẽ gì. */
export function CommunityChannels({ initialConfig }: { initialConfig?: PublicConfig }) {
  const { data } = useQuery({ ...publicConfigQuery(coreHttp), ...(initialConfig ? { initialData: initialConfig } : {}), staleTime: 60_000 });
  const c = data?.community;
  const channels = [
    { label: 'Nhóm Zalo', url: c?.zaloGroupUrl },
    { label: 'Facebook', url: c?.facebookUrl },
    { label: 'TikTok', url: c?.tiktokUrl },
  ].filter((x): x is { label: string; url: string } => typeof x.url === 'string' && x.url.startsWith('https://'));
  if (channels.length === 0) return null;

  return (
    <div role="group" aria-label="Kênh cộng đồng của Tubu Tree" className="flex flex-wrap gap-2">
      {channels.map((ch) => (
        <a
          key={ch.label}
          href={ch.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-stone-200 bg-stone-0 px-3.5 text-xs font-semibold text-forest-700 hover:bg-stone-50"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          {ch.label}
        </a>
      ))}
    </div>
  );
}
