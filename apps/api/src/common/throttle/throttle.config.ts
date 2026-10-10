import { Throttle, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';

export type AuthIdentity = (req: Request) => string | undefined;

export const throttlerOptions: ThrottlerModuleOptions = [{ ttl: 60_000, limit: 60 }];

export function AuthThrottle(_identify: AuthIdentity): MethodDecorator & ClassDecorator {
  return Throttle({ default: { ttl: 60_000, limit: 5 } });
}
