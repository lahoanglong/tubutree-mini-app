// @vitest-environment jsdom
import { describe } from 'vitest';
import { segmentedTabsContract } from '@/test-utils/segmented-tabs-contract';
import { SegmentedTabs } from './segmented-tabs';

// Bản Mini App của web: style nội tuyến, y hệt apps/miniapp/src/components/ui/segmented-tabs.tsx.
describe('SegmentedTabs (components/mini): bàn phím, roving tabindex, count', () => {
  segmentedTabsContract(SegmentedTabs, (badge) => badge.style.fontVariantNumeric === 'tabular-nums');
});
