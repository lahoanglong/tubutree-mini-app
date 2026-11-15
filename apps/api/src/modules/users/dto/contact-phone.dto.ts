import { IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

export class ContactPhoneDto {
  @Trim()
  @IsString()
  @MinLength(9)
  @MaxLength(32)
  phone!: string;
}
