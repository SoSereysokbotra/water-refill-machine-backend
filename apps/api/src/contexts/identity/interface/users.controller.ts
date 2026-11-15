import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { UsersService } from '../application/users.service';
import { SessionAuthGuard } from '../../../platform/security/session-auth.guard';
import { RolesGuard } from '../../../platform/security/roles.guard';
import { Roles } from '../../../platform/security/roles.decorator';
import { CurrentUser } from '../../../platform/security/current-user.decorator';
import { AuthenticatedUser } from '../application/auth.service';
import { UserRole } from '@prisma/client';

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['admin', 'operator', 'viewer']).optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['admin', 'operator', 'viewer']).optional(),
  enabled: z.boolean().optional(),
});

@Controller('v1/users')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('admin')
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  @Post()
  async createUser(
    @Body() body: unknown,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(`Validation failed: ${parsed.error.message}`);
    }

    const user = await this.usersService.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.name,
      role: parsed.data.role ? (parsed.data.role as UserRole) : undefined,
      actorId: currentUser.id,
    });

    return { data: user };
  }

  @Get()
  async listUsers(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const users = await this.usersService.listUsers(parsedLimit);
    return { data: users };
  }

  @Get(':id')
  async getUser(@Param('id') id: string) {
    const user = await this.usersService.getUserById(id);
    return { data: user };
  }

  @Patch(':id')
  async updateUser(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(`Validation failed: ${parsed.error.message}`);
    }

    const updated = await this.usersService.updateUser(id, {
      name: parsed.data.name,
      role: parsed.data.role ? (parsed.data.role as UserRole) : undefined,
      enabled: parsed.data.enabled,
      actorId: currentUser.id,
    });

    return { data: updated };
  }
}
