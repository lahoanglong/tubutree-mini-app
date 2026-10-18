// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { FeedPreviewItem } from '@tubutree/app-core/api/feed';
import { render, type Rendered } from '@/test-utils/dom';
import { PublicPreviewList } from './public-preview-list';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const PREVIEW = (kind: string): FeedPreviewItem =>
  ({
    id: 'p1',
    kind,
    title: null,
    snippet: 'Đoạn đầu',
    image: null,
    createdAt: new Date().toISOString(),
    author: 'Lan',
    badge: null,
    category: null,
    isPinned: false,
    likeCount: 0,
    commentCount: 0,
  }) as unknown as FeedPreviewItem;

describe('PublicPreviewList', () => {
  it('loại bài chưa biết (API thêm trước khi web deploy) không làm vỡ trang, vẫn hiện nội dung', () => {
    const r = render(<PublicPreviewList posts={[PREVIEW('NEW_KIND')]} />);
    mounted.push(r);
    expect(r.container.textContent).toContain('Đoạn đầu');
  });
});
