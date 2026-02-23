import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { UserMode } from '../users/enums/user-mode.enum';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const emailTaken = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (emailTaken) {
      throw new ConflictException('Email is already in use');
    }

    const nameTaken = await this.usersRepository.findOne({
      where: { displayName: dto.displayName.toLowerCase() },
    });
    if (nameTaken) {
      throw new ConflictException('Display name is already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const activationToken = randomUUID();

    const user = this.usersRepository.create({
      email: dto.email.toLowerCase(),
      passwordHash,
      displayName: dto.displayName.toLowerCase(),
      isActivated: false,
      activationToken,
      mode: UserMode.PRIVATE,
    });

    await this.usersRepository.save(user);
    await this.mailService.sendActivationEmail(user.email, activationToken);

    return {
      message:
        'Registration successful. Please check your email to activate your account.',
    };
  }

  async confirmEmail(token: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findOne({
      where: { activationToken: token },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired activation token');
    }

    user.isActivated = true;
    user.activationToken = null;
    await this.usersRepository.save(user);

    return { message: 'Account activated. You can now log in.' };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const user = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActivated) {
      throw new UnauthorizedException(
        'Account not activated. Please check your email.',
      );
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
    };

    const accessToken = this.jwtService.sign(payload);
    return { accessToken };
  }
}
