#!/usr/bin/env node

const command = process.argv[2];

// tslint:disable-next-line: no-magic-numbers
const args = process.argv.slice(3);

// tslint:disable:no-object-mutation
if (args.includes('--production') || args.includes('-p')) {
  process.env.NODE_ENV = 'production';
}
// tslint:enable:no-object-mutation

// Makes the script crash on unhandled rejections instead of silently
// ignoring them. In the future, promise rejections that are not handled will
// terminate the Node.js process with a non-zero exit code.
process.on('unhandledRejection', (error) => {
  // tslint:disable-next-line:no-throw
  throw error;
});

import { loadConfig, loadOptions } from '../lib/config';
import {
  autoAnalyzeCommands,
  buildCommands,
  buildDocsCommands,
  helpCommands,
  lintCommands,
  testCommands
} from '../lib/config/commands';
import { EnvironmentError, ExternalError } from '../lib/errors';
import { analyze, build, buildDocs, lint, test } from '../lib/tasks';
import { Options } from '../lib/types/Options';

// Start
(async (): Promise<void> => {
  const commandToRun =
    command === undefined
      ? helpCommands[0]
      : command;

  if (process.env.NODE_ENV === undefined) {
    // tslint:disable-next-line: no-object-mutation
    process.env.NODE_ENV =
      testCommands.includes(commandToRun)
        ? 'test'
        : 'development';
  }

  if (!(process.env.NODE_ENV === 'production' ||
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test')) {
    return Promise.reject(new EnvironmentError());
  }

  const options = getOptions(args);

  if (options instanceof Error) {
    return Promise.reject(options);
  }

  const config = await loadConfig(options, commandToRun);

  // tslint:disable: one-line

  // Build.
  if (buildCommands.includes(commandToRun)) {
    await build(options, config);
  }
  // Build Docs.
  else if (buildDocsCommands.includes(commandToRun)) {
    await buildDocs(options, config);
  }
  // Lint.
  else if (lintCommands.includes(commandToRun)) {
    await lint(options, config);
  }
  // Auto Analyze.
  else if (autoAnalyzeCommands.includes(commandToRun)) {
    await analyze(options, config);
  }
  // Test.
  else if (testCommands.includes(commandToRun)) {
    await test(options, config);
  }
  // Help.
  else if (helpCommands.includes(commandToRun)) {
    console.log('TODO: show help');
  }
  // Unknown command.
  else {
    console.log(`Unknown command "${commandToRun}". Run "catalyst-elements --help" for a list of commands.`);
    process.exit(1);
  }

  // tslint:enable: one-line
})()
  .catch((error) => {
    // tslint:disable-next-line:no-throw
    throw error;
  });

/**
 * Get the cli options the user specified.
 */
function getOptions(cliArgs: ReadonlyArray<string> = []): Options | ExternalError {
  const configIndex =
    cliArgs.includes('--config')
  ? cliArgs.indexOf('--config')
  : cliArgs.includes('-c')
  ? cliArgs.indexOf('-c')
  : -1;

  const configFileIndex = configIndex + 1;

  if (configIndex >= 0 && (configFileIndex >= cliArgs.length || cliArgs[configFileIndex].startsWith('-'))) {
    return new ExternalError('Config file not specified');
  }

  const userConfigFile =
    configIndex < 0
      ? undefined
      : cliArgs[configFileIndex];

  return loadOptions({
    watch: cliArgs.includes('--watch') || cliArgs.includes('-w'),
    debug: cliArgs.includes('--debug'),
    env: process.env.NODE_ENV as Options['env'],
    configFile: userConfigFile,
    test: {
      compileOnly: cliArgs.includes('--compile-only')
    }
  });
}
