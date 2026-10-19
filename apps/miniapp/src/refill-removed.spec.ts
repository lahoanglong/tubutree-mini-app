import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('./', import.meta.url));

describe('Refill đã gỡ khỏi mini app (spec 13)', () => {
  it('/refill chuyển thẳng sang /recycle, không còn trang Refill', () => {
    const app = readFileSync(join(SRC, 'components/app.tsx'), 'utf-8');
    expect(app).toContain('<Route path="/refill" element={<Navigate to="/recycle" replace />} />');
    expect(app).not.toMatch(/pages\/refill['"]/);
    expect(app).not.toContain('RefillPage');
  });
  it('file Refill không còn', () => {
    for (const f of ['pages/refill.tsx', 'services/refill-api.ts', 'components/refill-location-picker.tsx']) {
      expect(existsSync(join(SRC, f))).toBe(false);
    }
  });
});
