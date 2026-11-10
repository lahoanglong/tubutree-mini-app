/* eslint-disable @typescript-eslint/no-explicit-any -- client giả tạo model theo tên bảng lúc chạy nên kiểu động */
import { tick, type RaceDb } from './race-db.fake';

/**
 * Client của RaceDb gần Postgres hơn ở hai chỗ mà service của tiền đang dựa vào:
 *
 *  - `deleteMany` (RaceDb chỉ có `delete` một dòng): chạy như `DELETE ... WHERE`: chọn dòng theo WHERE, chờ khoá từng dòng, được khoá thì xét
 *    lại WHERE trên bản mới nhất (dòng người trước đã xoá thì không đếm), nên hai lần xoá cùng một dòng chỉ một bên thấy count = 1.
 *  - COMMIT là một vòng đi về riêng: sau câu cuối của callback transaction vẫn giữ khoá và chưa hiện dữ liệu thêm một nhịp, nên transaction khác
 *    kịp đọc giữa câu cuối và lúc commit. Không có nhịp này thì câu cuối của mỗi transaction luôn xong kèm commit trước khi bên kia bắt đầu câu của nó,
 *    và các lỗi "đọc trạng thái người kia chưa commit ở câu cuối" không bao giờ lộ ra.
 */
export function pgLikeClient(db: RaceDb): any {
  db.handlers.push({
    match: /delete-row-lock/,
    run: async (c) => {
      await c.lockRow(c.params[0] as string, c.params[1] as string);
      return [];
    },
  });

  const patch = (client: any): any => {
    const out: any = { ...client };
    for (const [table, model] of Object.entries<any>(client)) {
      if (!model || typeof model.findMany !== 'function') continue;
      out[table] = {
        ...model,
        deleteMany: async (args?: { where?: Record<string, unknown> }) => {
          const candidates = await model.findMany({ where: args?.where });
          let count = 0;
          for (const row of candidates) {
            await client.$queryRaw`SELECT 1 /* delete-row-lock */ ${table} ${row.id}`;
            const still = await model.findMany({ where: { AND: [args?.where ?? {}, { id: row.id }] } });
            if (still.length === 0) continue;
            await model.delete({ where: { id: row.id } });
            count += 1;
          }
          return { count };
        },
      };
    }
    if (typeof client.$transaction === 'function') {
      out.$transaction = (fn: (tx: any) => Promise<unknown>) =>
        client.$transaction(async (tx: any) => {
          const result = await fn(patch(tx));
          await tick();
          return result;
        });
    }
    return out;
  };
  return patch(db.client);
}
