// Load apps/api/.env for tests (same file the app uses locally; CI copies .env.example).
// Variables already set in the shell/CI take precedence (process.loadEnvFile does not override them).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(__dirname, '..', '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
