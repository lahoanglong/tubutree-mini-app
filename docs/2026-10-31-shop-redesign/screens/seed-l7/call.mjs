// node call.mjs <user> <METHOD> <path> [jsonBody]
import { api, lane } from '../../../2026-10-20-uat/tools/uat-harness/lib.mjs';
const [user, method, p, body] = process.argv.slice(2);
const r = await api(lane(7), method, p, { user: user === 'none' ? undefined : user, body: body ? JSON.parse(body) : undefined });
console.log(r.status, JSON.stringify(r.body, null, 1).slice(0, Number(process.env.MAX ?? 4000)));
process.exit(0);
