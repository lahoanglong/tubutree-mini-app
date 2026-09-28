import type { Config } from 'tailwindcss';
import { tailwindPreset } from '@tubutree/design-tokens';

const config: Config = {
  presets: [tailwindPreset],
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
