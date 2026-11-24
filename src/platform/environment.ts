import type { AnalyticsEngineDataset, D1Database, D1PreparedStatement, D1Result, R2Bucket } from '@cloudflare/workers-types';

// The optional binding is absent when telemetry is disabled in Preview.
export interface TelemetryEnvironment {
  ANALYTICS?: Pick<AnalyticsEngineDataset, 'writeDataPoint'>;
  TELEMETRY_ENABLED?: string;
  TELEMETRY_INTERACTIONS?: string;
  TELEMETRY_ENVIRONMENT?: string;
  TELEMETRY_RELEASE?: string;
  TELEMETRY_SAMPLE_RATE?: string;
  TELEMETRY_POLL_SAMPLE_RATE?: string;
  OBSERVABILITY_LOGS?: string;
}

export interface AttachmentStorageEnvironment {
  MAX_R2_BYTES?: string;
}

export interface PioneerEnvironment extends TelemetryEnvironment, AttachmentStorageEnvironment {
  DB: { withSession(...args: Parameters<D1Database['withSession']>): Database };
  ATTACHMENTS: Pick<R2Bucket, 'get' | 'put' | 'delete'>;
  JWT_SECRET: string;
  PII_ENCRYPTION_KEY: string;
  SCAN_QR_SECRET?: string;
  WARRANTY_CAPTCHA_ORIGIN?: string;
}

export interface DatabaseStatement extends Pick<D1PreparedStatement, 'first' | 'all' | 'run'> {
  bind(...values: unknown[]): DatabaseStatement;
}

export interface Database {
  prepare(sql: string): DatabaseStatement;
  batch<T = unknown>(statements: DatabaseStatement[]): Promise<D1Result<T>[]>;
}
