/**
 * Audit-only Vite config for the miniapp (used by scripts/audit/start-audit-env.ps1):
 *   cd apps/miniapp && node node_modules/vite/bin/vite.js --config ../../scripts/audit/vite.audit.config.mts
 *
 * Re-uses apps/miniapp/vite.config.mts unchanged and only isolates what could collide with the
 * owner's dev server on :3113 — a separate dep-optimizer cache (.audit/vite-cache instead of
 * apps/miniapp/node_modules/.vite), port 3213 (strict), loopback-only bind.
 * The API base URL comes from VITE_API_BASE_URL (read by src/services/api.ts); the /api proxy of the
 * base config follows VITE_API_TARGET, which the start script points at the audit API (:3201).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from '../../apps/miniapp/vite.config.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cfg: any = typeof base === 'function' ? await (base as any)({ command: 'serve', mode: 'development' }) : base;

export default {
  ...cfg,
  cacheDir: path.join(repo, '.audit', 'vite-cache'),
  clearScreen: false,
  server: {
    ...(cfg.server ?? {}),
    port: 3213,
    strictPort: true,
    host: '127.0.0.1',
  },
};
