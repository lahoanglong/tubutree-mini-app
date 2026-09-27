import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsObject, IsOptional, IsString, IsUUID,
  ValidateNested,
} from 'class-validator';

export class EventEnvelopeDto {
  @IsUUID() eventId!: string;
  @IsString() eventName!: string;
  @IsDateString() occurredAt!: string;
  @IsOptional() @IsString() anonymousId?: string;
  @IsOptional() @IsString() sessionId?: string;
  @IsIn(['miniapp', 'web']) platform!: 'miniapp' | 'web';
  @IsOptional() @IsString() appVersion?: string;
  @IsOptional() @IsString() entrySource?: string;
  @IsOptional() @IsString() notificationId?: string;
  @IsOptional() @IsString() refCode?: string;
  @IsOptional() @IsString() storefrontSlug?: string;
  @IsOptional() @IsObject() props?: Record<string, unknown>;
}

export class IngestEventsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EventEnvelopeDto)
  events!: EventEnvelopeDto[];
}
