import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsObject, IsOptional, IsString, IsUUID,
  MaxLength, registerDecorator, ValidateNested, type ValidationOptions,
} from 'class-validator';
import { CLIENT_EVENT_NAMES } from '@tubutree/shared-types';

export const MAX_EVENTS_PER_BATCH = 50;
export const MAX_PROPS_KEYS = 30;
export const MAX_PROPS_BYTES = 4096;

/** props do client tự khai: chặn theo số khoá và kích thước JSON để không nhồi blob vào analytics_events. */
function IsBoundedProps(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isBoundedProps',
      target: target.constructor,
      propertyName: propertyKey as string,
      options: {
        message: `props tối đa ${MAX_PROPS_KEYS} khoá và ${MAX_PROPS_BYTES} byte`,
        ...options,
      },
      validator: {
        validate(value: unknown): boolean {
          if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
          if (Object.keys(value).length > MAX_PROPS_KEYS) return false;
          return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_PROPS_BYTES;
        },
      },
    });
  };
}

export class EventEnvelopeDto {
  @IsUUID() eventId!: string;
  // Chỉ nhận tên mà FE đang phát; order_paid/order_placed... do server ghi, client gửi là 400.
  @IsIn(CLIENT_EVENT_NAMES) eventName!: string;
  @IsDateString() occurredAt!: string;
  @IsOptional() @IsString() @MaxLength(64) anonymousId?: string;
  @IsOptional() @IsString() @MaxLength(64) sessionId?: string;
  @IsIn(['miniapp', 'web']) platform!: 'miniapp' | 'web';
  @IsOptional() @IsString() @MaxLength(32) appVersion?: string;
  // Nhãn nguồn/chiến dịch chỉ kiểm kiểu và độ dài ở đây; controller chuẩn hoá và bỏ nhãn sai khuôn
  // (common/attribution.ts) để một nhãn sai không làm cả lô 50 sự kiện bị 400.
  @IsOptional() @IsString() @MaxLength(64) entrySource?: string;
  @IsOptional() @IsString() @MaxLength(64) campaign?: string;
  @IsOptional() @IsString() @MaxLength(64) notificationId?: string;
  @IsOptional() @IsString() @MaxLength(64) refCode?: string;
  @IsOptional() @IsString() @MaxLength(100) storefrontSlug?: string;
  @IsOptional() @IsObject() @IsBoundedProps() props?: Record<string, unknown>;
}

export class IngestEventsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_EVENTS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => EventEnvelopeDto)
  events!: EventEnvelopeDto[];
}
