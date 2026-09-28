// packages/design-tokens/src/index.ts
import { fileURLToPath } from 'node:url';

export { tailwindPreset } from './tailwind-preset';
export const TOKENS_CSS_PATH = fileURLToPath(new URL('./tokens.css', import.meta.url));
