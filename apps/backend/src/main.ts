import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Pino 구조화 로깅
  app.useLogger(app.get(Logger));

  // 글로벌 유효성 검사 파이프
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 전역 API 프리픽스 지정 (/api/*, 단 /notebook 경로는 프록시 라우팅을 위해 제외)
  app.setGlobalPrefix("api", {
    exclude: ["notebook/(.*)"],
  });

  // Swagger API 문서
  const config = new DocumentBuilder()
    .setTitle("Kyverno Governance API")
    .setDescription("PaC 정책 위반 및 예외 관리 API")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  // CORS (ALB 및 다양한 Origin 허용)
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger UI: http://localhost:${port}/api`);
}

bootstrap();
