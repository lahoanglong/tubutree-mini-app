import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFileAtomic } from './fs-atomic';

describe('writeFileAtomic', () => {
  it('nhiều lần ghi đồng thời không đè lên tệp tạm của nhau, tệp đích luôn là một bản nguyên vẹn', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fa-'));
    const path = join(dir, 'config.json');
    const bodies = Array.from({ length: 20 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(50_000) }));
    await Promise.all(bodies.map((b) => writeFileAtomic(path, b)));
    expect(bodies).toContain(await readFile(path, 'utf8'));
    expect(await readdir(dir)).toEqual(['config.json']);
  });
});
