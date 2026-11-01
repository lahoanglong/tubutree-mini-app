import { readFileSync } from 'fs';

/** Đọc file `.env` kiểu KEY=VALUE (bỏ dòng trống, dòng `#`, dấu nháy bao ngoài). File không đọc được thì trả `{}`. */
export function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const result: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}
