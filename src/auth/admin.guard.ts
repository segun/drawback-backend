import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UserRole } from '../users/enums/user-role.enum';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AdminGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // First, validate the JWT using the parent guard
    const isAuthenticated = await super.canActivate(context);
    if (!isAuthenticated) {
      return false;
    }

    // Extract the user from the request (set by JwtStrategy)
    const request = context.switchToHttp().getRequest();
    const user = request.user as User;

    if (!user || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
