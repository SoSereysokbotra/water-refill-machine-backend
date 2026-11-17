import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../application/auth.service';
import { ConfigService } from '../../../platform/config/config.service';
import { UsersService } from '../application/users.service';
import { SessionAuthGuard } from '../../../platform/security/session-auth.guard';
import { Public } from '../../../platform/security/public.decorator';
import { CurrentUser } from '../../../platform/security/current-user.decorator';
import { AuthenticatedUser } from '../application/auth.service';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

const verifyTotpSchema = z.object({
  code: z.string().length(6),
});

@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(UsersService) private readonly usersService: UsersService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Validation failed: email and password are required');
    }

    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    const userAgent = req.headers['user-agent'];

    const result = await this.authService.login({
      email: parsed.data.email,
      password: parsed.data.password,
      totpCode: parsed.data.totpCode,
      ipAddress,
      userAgent,
    });

    // Set HTTP-only session cookie if setCookie is available
    if (typeof (reply as unknown as { setCookie?: (...args: unknown[]) => void }).setCookie === 'function') {
      (reply as unknown as { setCookie: (...args: unknown[]) => void }).setCookie('wrm_session', result.token, {
        httpOnly: true,
        // HTTPS-only outside local development (the servers run behind Caddy/TLS)
        secure: this.config.get('APP_ENV') !== 'local',
        path: '/',
        sameSite: 'lax',
        // same lifetime as the server-side session (SESSION_TTL_DAYS)
        maxAge: this.config.get('SESSION_TTL_DAYS') * 24 * 3600,
      });
    }

    return {
      data: {
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
        user: result.user,
      },
    };
  }

  @UseGuards(SessionAuthGuard)
  @Post('logout')
  async logout(
    @Req() req: FastifyRequest & { headers: Record<string, string | undefined>; cookies?: Record<string, string> },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    let token = '';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.cookies?.wrm_session) {
      token = req.cookies.wrm_session;
    }

    if (token) {
      await this.authService.logout(token);
    }

    if (typeof (reply as unknown as { clearCookie?: (...args: unknown[]) => void }).clearCookie === 'function') {
      (reply as unknown as { clearCookie: (...args: unknown[]) => void }).clearCookie('wrm_session', { path: '/' });
    }

    return { data: { success: true } };
  }

  @UseGuards(SessionAuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return { data: user };
  }

  @UseGuards(SessionAuthGuard)
  @Post('totp/setup')
  async setupTotp(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.usersService.setupTotp(user.id);
    return { data: result };
  }

  @UseGuards(SessionAuthGuard)
  @Post('totp/verify')
  async verifyTotp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = verifyTotpSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Validation failed: 6-digit TOTP code is required');
    }
    const result = await this.usersService.verifyAndEnableTotp(user.id, parsed.data.code);
    return { data: result };
  }
}
