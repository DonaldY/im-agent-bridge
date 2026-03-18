import fs from 'node:fs/promises';
import { parseToml } from '../toml.js';
import type { AppConfig } from './types.js';
import { defaultConfigPath, validatePlatformConfig } from './core.js';
import { normalizeConfig } from './normalizers.js';

export async function loadConfig(configPath = defaultConfigPath()): Promise<AppConfig> {
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = parseToml(raw) as Record<string, unknown>;
  const config = normalizeConfig({ configPath, parsed });
  validatePlatformConfig(config.platform.kind, config);
  return config;
}
