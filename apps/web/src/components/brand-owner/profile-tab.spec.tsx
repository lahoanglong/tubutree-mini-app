// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { OwnedBrand } from '@tubutree/app-core/api/brand-owner';
import { render, type Rendered } from '@/test-utils/dom';
import { ProfileTab } from './profile-tab';

const brand: OwnedBrand = {
  id: 'b1',
  slug: 'nhan-mot',
  name: 'Nhãn một',
  logoUrl: null,
  coverUrl: null,
  tagline: null,
  story: null,
  origin: null,
  isVerified: false,
  isPublished: true,
  followerCount: 0,
  promotions: [],
};

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('tab Hồ sơ chủ nhãn', () => {
  it('ô câu chuyện thương hiệu có trần 20000 ký tự, khớp API', () => {
    mounted = render(<ProfileTab brand={brand} />);
    const area = mounted.container.querySelector('textarea');
    expect(area).not.toBeNull();
    expect(area!.maxLength).toBe(20000);
  });
});
