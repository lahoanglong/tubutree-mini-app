import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  getMe(@CurrentUser('sub') userId: string) {
    return this.users.getMe(userId);
  }

  @Patch('me')
  updateMe(@CurrentUser('sub') userId: string, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(userId, dto);
  }

  @Get('me/addresses')
  listAddresses(@CurrentUser('sub') userId: string) {
    return this.users.listAddresses(userId);
  }

  @Post('me/addresses')
  createAddress(@CurrentUser('sub') userId: string, @Body() dto: CreateAddressDto) {
    return this.users.createAddress(userId, dto);
  }

  @Patch('me/addresses/:id')
  updateAddress(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.users.updateAddress(userId, id, dto);
  }

  @Delete('me/addresses/:id')
  deleteAddress(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.users.deleteAddress(userId, id);
  }
}
