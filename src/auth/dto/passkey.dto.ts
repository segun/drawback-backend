import { IsEmail, IsObject, MaxLength } from 'class-validator';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';

export class StartPasskeyLoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class FinishPasskeyRegistrationDto {
  @IsObject()
  data!: RegistrationResponseJSON;
}

export class FinishPasskeyLoginDto {
  @IsObject()
  data!: AuthenticationResponseJSON;
}

/**
 * Response DTO for listing user's passkeys.
 * Excludes sensitive fields like credentialId and publicKey.
 */
export class CredentialResponseDto {
  id!: string;
  createdAt!: Date;
  lastUsedAt!: Date | null;
  transports!: string[] | null;
}
