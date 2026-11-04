// Ghi kết quả L5-B01 vào results: chạy repro (Huỷ đơn thua race với "Đã nhận tiền") 6 đơn, đếm số lần API báo 2xx mà đơn không bị huỷ.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rec, save } from './_lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [path.join(here, 'repro-L5-B01-cancel-race.mjs')], { cwd: process.cwd(), encoding: 'utf8', timeout: 240000 });
const out = `${r.stdout}${r.stderr}`;
const n = Number(out.match(/TÁI HIỆN (\d+)\/6/)?.[1] ?? 0);
const lines = out.split('\n').filter((l) => l.startsWith('#'));
rec('L5-B01', 'cskh', 'api', 'Huỷ đơn đồng thời với Đã nhận tiền', 'Kế toán bấm "Đã nhận tiền" và CSKH bấm "Huỷ đơn" cùng một lúc trên cùng đơn chuyển khoản (6 đơn)', 'Huỷ thành công (đơn CANCELLED) hoặc API báo lỗi rõ ràng khi không huỷ được; không báo thành công mà đơn vẫn chạy', `${n}/6 lần API báo 2xx mà đơn không bị huỷ`, lines, n > 0 ? 'FAIL' : 'PASS');
save('19-b01');
process.exit(0);
