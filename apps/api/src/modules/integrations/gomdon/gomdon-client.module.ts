import { Module } from '@nestjs/common';
import { GomdonClient } from './gomdon.client';

/**
 * Chỉ GomdonClient (báo phí, kiểm tra địa chỉ, tạo/huỷ vận đơn), tách khỏi GomdonModule để luồng khách của Đổi rác dùng được
 * mà không kéo theo controller webhook, worker BullMQ và cron của Gomdon vào đồ thị module của nó. Một module = một instance
 * GomdonClient, nên GomdonModule import module này thay vì tự khai báo provider (token đăng nhập và nhịp gọi chỉ giữ một bản).
 */
@Module({ providers: [GomdonClient], exports: [GomdonClient] })
export class GomdonClientModule {}
