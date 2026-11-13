// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('./brand-story-view', () => ({ BrandStoryView: () => null }));

import BrandStoryPage, { metadata } from './page';

describe('/cau-chuyen — trang công khai có metadata', () => {
  it('có tiêu đề, mô tả, canonical và được lập chỉ mục', () => {
    expect(metadata.title).toBe('Hành trình nguyên liệu');
    expect(metadata.description).toContain('Tubu Tree');
    expect(metadata.description).toContain('bản đồ vùng nguyên liệu Việt Nam');
    expect(metadata.description).not.toMatch(/gỗ|3D/);
    expect(metadata.alternates?.canonical).toBe('/cau-chuyen');
    expect(metadata.robots).toBeUndefined();
  });

  it('dựng được trang', () => {
    expect(BrandStoryPage()).toBeTruthy();
  });
});
