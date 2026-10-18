// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('./group-buy-view', () => ({ GroupBuyView: () => null }));

import GroupBuyPage, { metadata } from './page';
import InvitedGroupBuyPage, { metadata as invitedMetadata } from './[id]/page';

describe('/mua-chung — trang công khai có metadata', () => {
  it('danh sách có tiêu đề, mô tả, canonical và được lập chỉ mục', () => {
    expect(metadata.title).toBe('Mua chung giá tốt — Tubu Tree');
    expect(metadata.description).toBeTruthy();
    expect(metadata.alternates?.canonical).toBe('/mua-chung');
    expect(metadata.robots).toBeUndefined();
  });

  it('danh sách dựng GroupBuyView không có nhóm được mời', () => {
    const el = GroupBuyPage() as ReactElement<{ invitedId?: string }>;
    expect(el.props.invitedId).toBeUndefined();
  });

  it('link mời /mua-chung/[id] truyền id vào view và không bị lập chỉ mục', async () => {
    const el = (await InvitedGroupBuyPage({ params: Promise.resolve({ id: 'g1' }) })) as ReactElement<{ invitedId?: string }>;
    expect(el.props.invitedId).toBe('g1');
    expect(invitedMetadata.robots).toEqual({ index: false, follow: true });
    expect(invitedMetadata.title).toContain('Tubu Tree');
  });
});
