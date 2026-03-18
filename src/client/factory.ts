import type { AppConfig } from '../config/types.js';
import type { ClientLike } from './types.js';
import { PLATFORM_CLIENT_REGISTRY } from './registry.js';
import type { ClientFactoryOptions } from './registry.js';

export function createPlatformClient(config: AppConfig, options: ClientFactoryOptions = {}): ClientLike {
  const platformKind = config.platform.kind;
  const createClient = PLATFORM_CLIENT_REGISTRY[platformKind];

  if (!createClient) {
    throw new Error(`Unsupported platform client: ${platformKind}`);
  }

  return createClient(config, options);
}
