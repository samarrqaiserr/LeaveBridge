import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MockHcmModule } from './mock-hcm.module';

let app: any;
let hcmApp: any;

beforeAll(async () => {
  // Start mock HCM server
  hcmApp = await NestFactory.create(MockHcmModule);
  await hcmApp.listen(3001);

  // Start main application
  app = await NestFactory.create(AppModule);
  await app.listen(3000);
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
  if (hcmApp) {
    await hcmApp.close();
  }
});

// Helper to get HTTP client for main app
export const getApp = () => app;

// Helper to get HTTP client for mock HCM
export const getHcmApp = () => hcmApp;
