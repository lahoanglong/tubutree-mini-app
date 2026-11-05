import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { NO_HTML } from '../../users/dto/address.dto';
import { Trim } from '../../../common/decorators/trim.decorator';

export class ForfeitCommissionsDto {
  @Trim() @IsString() @MinLength(3) @MaxLength(500) @Matches(NO_HTML, { message: 'Lý do không được chứa ký tự < hoặc >.' }) reason!: string;
}
