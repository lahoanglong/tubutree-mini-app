import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Tách một file SQL migration thành từng câu lệnh để chạy qua Prisma ($executeRawUnsafe dùng giao thức
 * prepared, không nhận nhiều câu một lần). Tôn trọng chuỗi '...', định danh "...", khối $tag$...$tag$
 * (DO $$ ... $$ chứa nhiều dấu ;) và chú thích -- / block.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end + 1;
      buf += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      buf += ' ';
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      buf += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? sql.length : end + tag[0].length;
        buf += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

export function readApiSql(relPath: string): string {
  return readFileSync(join(__dirname, '..', '..', relPath), 'utf8');
}

/**
 * Chạy cả file trong MỘT transaction (như `psql -1`) với search_path trỏ vào `schema`: tên bảng không
 * kèm schema trong SQL rơi vào bảng của schema nháp, không đụng bảng public mà các race spec khác dùng.
 */
export async function runSqlScriptIn(prisma: PrismaClient, schema: string, sql: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`schema không hợp lệ: ${schema}`);
  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${schema}`);
      for (const stmt of splitSqlStatements(sql)) await tx.$executeRawUnsafe(stmt);
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
