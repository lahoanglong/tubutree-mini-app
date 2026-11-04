// Thư viện UI của lane 3: mở Mini App 375x812, web 375x812, web 1280x800 và chụp một màn.
import fs from 'node:fs';
import { H, SHOTS, RES } from './lib3.mjs';

const mini = await import(`${H}/miniapp-session.mjs`);
const web = await import(`${H}/web-session.mjs`);
export const SURFACES = {
  mini375: { kind: 'mini', viewport: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  web375: { kind: 'web', viewport: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  web1280: { kind: 'web', viewport: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false } },
};
export const BAD_WORDS = [/Vui lòng/i, /chúng tôi/i, /\.\.\./, /undefined/, /\bnull\b/, /NaN/, /\[object/];

export async function openSurface(surface, persona, startPath) {
  const S = SURFACES[surface];
  if (S.kind === 'mini') return { kind: 'mini', s: await mini.open(3, persona, { path: startPath, viewport: S.viewport }) };
  return { kind: 'web', s: await web.openWeb(3, persona, { path: startPath, viewport: S.viewport }) };
}

export async function shoot(sess, surface, persona, route, name, { full = true, settle = 1200, actions } = {}) {
  const { s, kind } = sess;
  const reqStart = s.requests.length;
  const errStart = s.errors.length, conStart = s.consoleErrors.length;
  await s.goto(route);
  await s.page.waitForTimeout(settle);
  if (actions) await actions(s.page);
  const file = `${SHOTS}/${name}-${surface}.png`;
  await s.page.screenshot({ path: file, fullPage: full });
  const info = await s.page.evaluate(() => ({
    text: document.body.innerText.slice(0, 6000),
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    sh: document.documentElement.scrollHeight,
    url: location.pathname + location.search,
  }));
  const reqs = s.requests.slice(reqStart);
  const bad = reqs.filter((r) => r.status >= 400 || r.status === 0);
  const words = BAD_WORDS.filter((re) => re.test(info.text)).map(String);
  const row = {
    name, surface, persona, route, url: info.url, file, overflowX: info.sw > info.iw + 1, sw: info.sw, iw: info.iw, sh: info.sh,
    pageErrors: s.errors.slice(errStart), consoleErrors: s.consoleErrors.slice(conStart), badRequests: bad, nReq: reqs.length, badWords: words,
    text: info.text,
  };
  return row;
}
export function saveRows(file, rows) {
  fs.writeFileSync(`${RES}/${file}.json`, JSON.stringify(rows, null, 2));
}
