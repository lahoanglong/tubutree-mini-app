import { describe, it, expect } from 'vitest';
import config from './tailwind.config';

describe('web tailwind.config', () => {
  it('extends the shared design-tokens preset (no independent color palette)', () => {
    expect(config.presets?.length).toBeGreaterThan(0);
    const ext = config.theme?.extend as Record<string, unknown> | undefined;
    expect(ext?.colors).toBeUndefined();
  });
});
