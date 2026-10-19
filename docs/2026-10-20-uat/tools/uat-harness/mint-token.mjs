#!/usr/bin/env node
// Ký JWT access đúng payload JwtStrategy kiểm (apps/api/src/modules/auth/strategies/jwt.strategy.ts; payload như AuthService.issueTokens).
// Dùng: mint-token.mjs <lane> <userId|zaloId|SĐT|bí danh> [--ttl giây] [--json] [--login] [--web]
//   mặc định  in access token (ký tại chỗ bằng JWT_ACCESS_SECRET của lane, mặc định sống 12 giờ) — dùng: TOKEN=$(node mint-token.mjs 1 admin)
//   --json    in {accessToken, refreshToken, user} kiểu LoginResponse; refreshToken là dòng refresh_tokens THẬT trong DB lane
//   --login   để CHÍNH API lane cấp cặp token (chèn refresh token rồi POST /auth/refresh) — đi qua issueTokens thật
//   --web     kèm --login: gửi x-client: web, in thêm Set-Cookie tubu_rt
// Secret lấy từ state/lane-N/lane.env (lane-up sinh, đè apps/api/.env cho API lane), nên token lane này không dùng được ở lane khác.
import { closePrisma, findUser, jsonOut, lane, laneEnv, mintRefresh, realLogin, signAccess, toAuthUser } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const ttlIdx = args.indexOf('--ttl');
const ttl = ttlIdx >= 0 ? Number(args[ttlIdx + 1]) : 12 * 3600;
const pos = args.filter((a, i) => !a.startsWith('--') && !(ttlIdx >= 0 && i === ttlIdx + 1));
if (pos.length < 2) {
  console.error('dùng: mint-token.mjs <lane> <userId|zaloId|SĐT|bí danh> [--ttl giây] [--json] [--login] [--web]');
  process.exit(2);
}
const L = lane(pos[0]);
try {
  if (flag('--login')) {
    const r = await realLogin(L, pos[1], { web: flag('--web') });
    if (r.status !== 200) {
      console.error(`POST /auth/refresh → ${r.status}: ${JSON.stringify(r.body)}`);
      process.exitCode = 1;
    } else jsonOut({ ...r.body, ...(r.setCookie ? { setCookie: r.setCookie } : {}) });
  } else {
    const u = await findUser(L, pos[1]);
    const accessToken = signAccess(laneEnv(L).JWT_ACCESS_SECRET, u, ttl);
    if (flag('--json')) jsonOut({ accessToken, refreshToken: await mintRefresh(L, u.id), user: toAuthUser(u) });
    else process.stdout.write(`${accessToken}\n`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closePrisma();
}
