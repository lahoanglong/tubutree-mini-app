import { buildMessage, ValidateBy, type ValidationOptions } from 'class-validator';

/** Chuỗi cách nhau bằng dấu phẩy có tối đa `max` phần tử khác rỗng (sau khi bỏ khoảng trắng). Giá trị không phải chuỗi để @IsString xử lý. */
export function MaxCsvItems(max: number, validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'maxCsvItems',
      constraints: [max],
      validator: {
        validate: (value: unknown) => typeof value !== 'string' || value.split(',').filter((x) => x.trim() !== '').length <= max,
        defaultMessage: buildMessage((eachPrefix) => `${eachPrefix}Danh sách chỉ nhận tối đa ${max} mục, cách nhau bằng dấu phẩy.`, validationOptions),
      },
    },
    validationOptions,
  );
}
