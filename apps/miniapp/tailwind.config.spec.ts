import { describe, it, expect } from 'vitest';
import config from './tailwind.config';

describe('miniapp tailwind.config', () => {
  it('extends the shared design-tokens preset', () => {
    expect(config.presets).toBeDefined();
    expect(config.presets!.length).toBeGreaterThan(0);
  });
  it('scans miniapp source files', () => {
    expect(config.content).toContain('./src/**/*.{ts,tsx}');
  });
});
