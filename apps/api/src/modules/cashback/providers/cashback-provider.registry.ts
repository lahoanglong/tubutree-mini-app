import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CASHBACK_PROVIDERS, type CashbackProvider } from './cashback-provider.interface';

/** Tra CashbackProvider theo key. Đăng ký qua DI token CASHBACK_PROVIDERS. */
@Injectable()
export class CashbackProviderRegistry {
  private readonly byKey: Map<string, CashbackProvider>;

  constructor(@Inject(CASHBACK_PROVIDERS) providers: CashbackProvider[]) {
    this.byKey = new Map(providers.map((p) => [p.key, p]));
  }

  get(key: string): CashbackProvider {
    const provider = this.byKey.get(key);
    if (!provider) throw new NotFoundException(`Cashback provider không tồn tại: ${key}`);
    return provider;
  }

  all(): CashbackProvider[] {
    return [...this.byKey.values()];
  }
}
