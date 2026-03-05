import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.setGlobalPrefix('api');

  const parseAllowedOrigins = (raw?: string) => {
    if (!raw) return [];

    const trimmed = raw.trim();
    // Try JSON parse for arrays
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      trimmed.startsWith('{')
    ) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map((s: any) => String(s));
      } catch {
        // fall through to comma-split
      }
    }

    // Comma-separated fallback
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

  if (allowedOrigins.length === 0) {
    console.error(
      '❌ ALLOWED_ORIGINS environment variable is required but not set.',
    );
    process.exit(1);
  }

  console.log('Allowed Origins:', allowedOrigins);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
