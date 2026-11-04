export const A = process.env.API || 'http://localhost:3261/api';
export async function req(method, path, { tok, body, headers = {}, raw = false } = {}) {
  const r = await fetch(A + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: r.status, body: j, headers: r.headers, text };
}
export async function guest(deviceId) {
  const r = await req('POST', '/auth/guest', { body: { deviceId } });
  return { tok: r.body.accessToken, refresh: r.body.refreshToken, user: r.body.user, status: r.status };
}
export const short = (x, n = 300) => (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, n);
