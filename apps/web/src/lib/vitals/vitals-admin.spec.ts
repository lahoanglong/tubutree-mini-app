import { describe, expect, it } from 'vitest';
import { formatVital, pivotClientVitals, thresholdText, type ClientVitalsRow } from './vitals-admin';

const row = (over: Partial<ClientVitalsRow>): ClientVitalsRow => ({
  platform: 'web',
  name: 'LCP',
  route: '*',
  viewport: 's',
  samples: 60,
  p75: 2000,
  good: 50,
  needsImprovement: 5,
  poor: 5,
  rating: 'good',
  enoughSamples: true,
  ...over,
});

describe('formatVital', () => {
  it('mili giây dưới 1 giây, giây một số lẻ từ 1 giây, CLS hai số lẻ, dấu phẩy thập phân', () => {
    expect(formatVital('INP', 180.4)).toBe('180 ms');
    expect(formatVital('LCP', 2450)).toBe('2,5 s');
    expect(formatVital('READY', 12_000)).toBe('12,0 s');
    expect(formatVital('CLS', 0.1)).toBe('0,10');
  });

  it('ngưỡng ghi bằng lời theo Core Web Vitals', () => {
    expect(thresholdText('LCP')).toBe('LCP: tốt ≤ 2,5 s, kém > 4,0 s');
    expect(thresholdText('CLS')).toBe('CLS: tốt ≤ 0,10, kém > 0,25');
  });
});

describe('pivotClientVitals', () => {
  it('một dòng cho mỗi nền tảng + route + khung nhìn; web trước Mini App, dòng gộp trước, route nhiều mẫu trước', () => {
    const lines = pivotClientVitals([
      row({ platform: 'miniapp', name: 'READY', route: '/', samples: 9 }),
      row({ route: '/san-pham', name: 'LCP', samples: 10 }),
      row({ route: '/san-pham/[slug]', name: 'LCP', samples: 40 }),
      row({ route: '/san-pham/[slug]', name: 'CLS', samples: 41, p75: 0.02 }),
      row({ route: '*', name: 'LCP', samples: 50 }),
      row({ platform: 'miniapp', name: 'READY', route: '*', samples: 9 }),
    ]);
    expect(lines.map((l) => `${l.platform} ${l.route} ${l.viewport}`)).toEqual([
      'web * s',
      'web /san-pham/[slug] s',
      'web /san-pham s',
      'miniapp * s',
      'miniapp / s',
    ]);
    expect(Object.keys(lines[1]!.cells).sort()).toEqual(['CLS', 'LCP']);
    expect(lines[1]!.samples).toBe(41);
  });
});
