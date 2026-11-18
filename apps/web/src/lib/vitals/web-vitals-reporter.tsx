'use client';

import { useEffect } from 'react';
import type { RumConfig } from './rum-config';
import { startWebVitals } from './web-vitals';

/** Gắn một lần ở layout gốc. Cờ tắt thì không làm gì (không tải thư viện đo, không gửi request). */
export function WebVitalsReporter({ enabled, samplePct }: RumConfig) {
  useEffect(() => {
    if (enabled) startWebVitals(samplePct);
  }, [enabled, samplePct]);
  return null;
}
