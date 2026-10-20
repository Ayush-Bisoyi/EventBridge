import 'dotenv/config';
import process from 'node:process';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  webhookSecret: required('WEBHOOK_SECRET'),
  adminPassword: required('ADMIN_PASSWORD'),
  sessionSecret: required('SESSION_SECRET'),
  downstreamUrl: process.env.DOWNSTREAM_URL || null,
  maxEvents: Math.min(Math.max(Number(process.env.MAX_EVENTS ?? 100), 1), 500)
};

