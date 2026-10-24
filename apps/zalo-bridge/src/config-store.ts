import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './fs-atomic';

export interface BridgeConfig {
  groupId: string | null;
}

export class ConfigStore {
  private readonly path: string;
  private config: BridgeConfig;

  constructor(dir: string) {
    this.path = join(dir, 'config.json');
    this.config = this.read();
  }

  get(): BridgeConfig {
    return { ...this.config };
  }

  async set(groupId: string | null): Promise<void> {
    await writeFileAtomic(this.path, JSON.stringify({ groupId }));
    this.config = { groupId };
  }

  private read(): BridgeConfig {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as { groupId?: unknown };
      return { groupId: typeof parsed.groupId === 'string' ? parsed.groupId : null };
    } catch {
      return { groupId: null };
    }
  }
}
