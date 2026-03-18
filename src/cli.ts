#!/usr/bin/env node
import { applyRuntimeEnvironment, defaultConfigPath, loadConfig } from './config/index.js';
import { StateStore } from './storage/index.js';
import { createPlatformClient } from './client/index.js';
import { BridgeFacade } from './bridge/index.js';
import { runDoctor } from './doctor.js';
import { runServiceCommand } from './service/index.js';
import { toErrorMessage } from './utils.js';

function printUsage() {
  console.log([
    'Usage:',
    '  im-agent-bridge serve [--config path]',
    '  im-agent-bridge doctor [--config path] [--remote]',
    '  im-agent-bridge service <install|start|stop|restart|status|logs|uninstall> [options]',
    '    --label value',
    '    --keepawake none|idle|system|on_ac   (service install only)',
    '    --lines number                       (service logs only)',
    '',
    `Default config: ${defaultConfigPath()}`,
  ].join('\n'));
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const serviceSubcommand = command === 'service' && args[0] && !args[0].startsWith('-')
    ? args.shift()
    : undefined;
  const options = {
    configPath: defaultConfigPath(),
    remote: false,
    label: undefined,
    keepAwake: 'none',
    lines: 80,
  };

  while (args.length > 0) {
    const current = args.shift();
    if (current === '--config') {
      options.configPath = args.shift() || options.configPath;
      continue;
    }
    if (current === '--remote') {
      options.remote = true;
      continue;
    }

    if (current === '--label') {
      options.label = args.shift() || options.label;
      continue;
    }

    if (current === '--keepawake') {
      options.keepAwake = args.shift() || options.keepAwake;
      continue;
    }

    if (current === '--lines') {
      const parsed = Number.parseInt(args.shift() || '', 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        options.lines = parsed;
      }
      continue;
    }
  }

  return { command, serviceSubcommand, options };
}

async function serve(config) {
  const store = new StateStore(config.stateDir);
  await store.init();

  const client = createPlatformClient(config, { debug: config.bridge.debug });
  const bridge = new BridgeFacade(config, store, client);

  const shutdown = async () => {
    await client.stop();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await client.start(async (incomingMessage) => {
    await bridge.handleIncomingMessage(incomingMessage);
  });

  const suffix = config.platform.kind === 'telegram' ? ` (${config.telegram.mode})` : '';
  console.log(`[serve] ${config.platform.kind} client connected${suffix}`);
  await new Promise(() => {});
}

async function main() {
  const { command, serviceSubcommand, options } = parseArgs(process.argv.slice(2));

  if (!command || command === '-h' || command === '--help' || command === 'help') {
    printUsage();
    return;
  }

  if (command === 'doctor') {
    const config = await loadConfig(options.configPath);
    applyRuntimeEnvironment(config);
    console.log(await runDoctor(config, { remote: options.remote }));
    return;
  }

  if (command === 'serve') {
    const config = await loadConfig(options.configPath);
    applyRuntimeEnvironment(config);
    await serve(config);
    return;
  }

  if (command === 'service') {
    const output = await runServiceCommand(
      serviceSubcommand,
      serviceSubcommand === 'install'
        ? async () => {
          const config = await loadConfig(options.configPath);
          applyRuntimeEnvironment(config);
          return config;
        }
        : null,
      {
        label: options.label,
        keepAwake: options.keepAwake,
        lines: options.lines,
      },
    );
    console.log(output);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(toErrorMessage(error));
  process.exit(1);
});
