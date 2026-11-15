import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { AuthenticatedUser } from './authenticated-user';

const ROLE_HIERARCHY: Record<'admin' | 'operator' | 'viewer', number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const userRank = ROLE_HIERARCHY[user.role] ?? 0;

    // Check if user has at least the minimum rank of any required role
    const hasPermission = requiredRoles.some((role) => {
      const requiredRank = ROLE_HIERARCHY[role as 'admin' | 'operator' | 'viewer'] ?? 99;
      return userRank >= requiredRank;
    });

    if (!hasPermission) {
      throw new ForbiddenException(`Forbidden: required role [${requiredRoles.join(', ')}] but user has role [${user.role}]`);
    }

    return true;
  }
}
