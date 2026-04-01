import fs from 'node:fs/promises';
import { parseToml } from '../toml';
import type { AppConfig } from './types';
import { defaultConfigPath, validatePlatformConfig } from './core';
import { normalizeConfig } from './normalizers';

export async function loadConfig(configPath = defaultConfigPath()): Promise<AppConfig> {
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = parseToml(raw) as Record<string, unknown>;
  const config = normalizeConfig({ configPath, parsed });
  validatePlatformConfig(config.platform.kind, config);
  return config;
}
