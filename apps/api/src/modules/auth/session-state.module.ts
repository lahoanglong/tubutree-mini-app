import { Global, Module } from '@nestjs/common';
import { SessionStateService } from './session-state.service';

/** Global: JwtStrategy đọc, các luồng khoá/đổi quyền ở module khác gọi invalidate(). */
@Global()
@Module({
  providers: [SessionStateService],
  exports: [SessionStateService],
})
export class SessionStateModule {}
