import fs from 'node:fs';
const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs';
const m = await import(WT + '/docs/2026-10-28-review/tools/perf/api.mjs');
m.API_ENDPOINTS.push(
  { key: 'me_summary', path: '/me/summary', auth: 'returning' },
  { key: 'orders_home_todo', path: '/orders/home-todo', auth: 'returning' },
  { key: 'wishlist_ids', path: '/me/wishlist/ids', auth: 'returning' },
  { key: 'me_loyalty', path: '/me/loyalty', auth: 'returning' },
  { key: 'me_coupons', path: '/me/coupons', auth: 'returning' },
  { key: 'daily_check_in', path: '/me/daily-check-in', auth: 'returning' },
  { key: 'notifications', path: '/me/notifications', auth: 'returning' },
  { key: 'orders_list', path: '/orders?page=1&limit=10', auth: 'returning' },
  { key: 'flash_active', path: '/flash-sales/active' },
  { key: 'feed', path: '/feed', auth: 'returning' },
  { key: 'combos', path: '/bundles/combos' },
  { key: 'coupons_collectable', path: '/coupons/collectable' },
  { key: 'categories', path: '/categories' },
);
const res = await m.runSqlCount();
fs.writeFileSync(process.argv[2], JSON.stringify(res, null, 1));
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(20), v.path.padEnd(36), 'status', v.first?.status, 'sql', v.first?.sql, '->', v.second?.sql, 'writes', v.first?.write, v.second?.write);
process.exit(0);
