import { done } from './lib3.mjs';
import { openSurface, shoot, saveRows } from './ui-lib.mjs';
const surface = process.argv[2] ?? 'mini375';
const persona = process.argv[3] ?? 'returning';
const routes = process.argv[4] ? process.argv[4].split(',') : null;
const MINI = [['profile', '/profile'], ['edit-profile', '/edit-profile'], ['addresses', '/addresses'], ['notifications', '/notifications'], ['loyalty', '/loyalty'], ['wallet', '/wallet'], ['subscriptions', '/subscriptions'], ['settings', '/settings']];
const WEB = [['profile', '/tai-khoan'], ['edit-profile', '/tai-khoan/ho-so'], ['addresses', '/tai-khoan/dia-chi'], ['notifications', '/tai-khoan/thong-bao'], ['loyalty', '/tai-khoan/diem-xanh'], ['wallet', '/tai-khoan/vi-tubu'], ['subscriptions', '/tai-khoan/don-hang?tab=subscriptions'], ['settings', '/tai-khoan/cai-dat']];
const list = (surface.startsWith('mini') ? MINI : WEB).filter(([n]) => !routes || routes.includes(n));
const sess = await openSurface(surface, persona, list[0][1]);
const rows = [];
for (const [n, r] of list) {
  const row = await shoot(sess, surface, persona, r, `${persona}-${n}`);
  rows.push(row);
  console.log(n, row.url, 'overflowX=', row.overflowX, 'bad=', JSON.stringify(row.badRequests), 'err=', row.pageErrors.length, row.consoleErrors.length, 'words=', row.badWords.join(' '));
}
saveRows(`u1-${persona}-${surface}`, rows.map(({ text, ...x }) => ({ ...x, textHead: text.slice(0, 1500) })));
await sess.s.close();
await done();
