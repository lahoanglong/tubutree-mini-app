import { applyDecorators } from '@nestjs/common';
import { registerDecorator, ValidateIf } from 'class-validator';

/** Tên ràng buộc trong ValidationError.constraints; validation-pipe.ts dùng để nói đúng một câu thay vì kèm câu "phải là chuỗi/số…". */
export const NOT_NULL_CONSTRAINT = 'optionalNotNull';

/**
 * Trường tuỳ chọn của body PATCH/PUT ứng với cột (hoặc giá trị) không có null: bỏ trường = giữ nguyên, nhưng `null` là
 * một giá trị chứ không phải "bỏ trường". @IsOptional() cho qua cả null, nên null lọt xuống Prisma và thành lỗi 500; dùng
 * decorator này thay cho @IsOptional() để null bị chặn 400. Các luật còn lại của trường (@IsString, @Min…) giữ nguyên.
 * Trường mà null có nghĩa (xoá giá trị) thì khai báo `?: T | null` và dùng @IsOptional() + @ValidateIf((_, v) => v !== null).
 */
export function OptionalNotNull(): PropertyDecorator {
  return applyDecorators(
    ValidateIf((_object, value) => value !== undefined),
    (target: object, propertyKey: string | symbol) =>
      registerDecorator({
        name: NOT_NULL_CONSTRAINT,
        target: target.constructor,
        propertyName: propertyKey as string,
        validator: {
          validate: (value: unknown) => value !== null,
          defaultMessage: (args) => `${args?.property ?? 'value'} must not be null`,
        },
      }),
  );
}
