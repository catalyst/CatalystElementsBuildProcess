#!/usr/bin/env node
// tslint:disable:no-console

import { existsSync, readJSON } from 'fs-extra';

import { getConfig, tasks } from '../lib';
import { MultiPromiseRejectionError } from '../lib/classes/MultiPromiseRejectionError';
import { ExternalError } from '../lib/util';

const commands = {
  analyze: 'Run an analysis of the component.',
  build: 'Build the component.',
  buildDocs: 'Build the docs for the component.',
  clean: 'Clean out any temporary files.',
  help: 'Display this help screen.',
  lint: 'Run the linter(s).',
  test: 'Test the component.',
  publish: 'Publish the component.',
  publishDry: 'Perform a dry run of publishing the component.',
  fixDependencies: 'Fix known issues with some dependencies.'
};

type Task = Exclude<keyof typeof commands, 'help'>;
type RunSettings = {
  readonly taskName?: Task;
  readonly help: boolean;
  readonly config: string;
};

const flags = {
  '-c': ['<file>', 'Where <file> is the config file to use.'],
  '-h': ['Display help information.']
};

const flagMap: { readonly [key: string]: keyof typeof flags } = {
  '--congif-file': '-c',
  '--help': '-h'
};

/**
 * Run a task.
 *
 * @param taskName The name of the task to run.
 */
async function runTask(taskName: Task, userConfigFile: string): Promise<void> {
  const task = tasks.get(taskName);

  if (task === undefined) {
    throw new Error(`No task with the name "${taskName}" exists.`);
  }

  try {
    if (existsSync(userConfigFile)) {
      const userConfig = await readJSON(userConfigFile);
      await task(taskName, getConfig(userConfig));
    } else {
      await task(taskName);
    }
  } catch (error) {
    console.log('Task Failed.');
    if (error instanceof Error) {
      if (error instanceof MultiPromiseRejectionError) {
        console.log(`  - ${error.errors.join('\n  - ')}`);
      } else {
        console.log(error.message);
      }
    }
    process.exit(1);
  }
}

/**
 * Get the flag the given string represents.
 *
 * If the string is not supposed to be flag, false is returned.
 * If the string represents a flag, that flag is returned.
 * If the string represents an invalid flag, an error is thrown.
 *
 * @param value The value to get the flag for.
 */
function getFlag(value: string): keyof typeof flags | false {
  if (!value.startsWith('-')) {
    return false;
  }
  if (flags.hasOwnProperty(value)) {
    return value as keyof typeof flags;
  }
  throw new ExternalError(`Unknown flag "${value}".`);
}

/**
 * Run the script.
 */
function run(args: ReadonlyArray<string>): void {
  if (args.length === 0) {
    throw new ExternalError('No task name given. Use --help for more info.');
  }

  const settings = args.reduce(
    (reduced: RunSettings, arg) => {
      switch (getFlag(arg)) {
        case '-c':
          return {
            ...reduced,
            config: ''  // FIXME: set value.
          };

        case '-h':
          return {
            ...reduced,
            help: true
          };

        case false:
          if (!Object.prototype.hasOwnProperty.call(commands, arg)) {
            throw new ExternalError(`No task with the name "${arg}" exists.`);
          }

          if (arg === 'help') {
            return {
              ...reduced,
              help: true
            };
          }

          return {
            ...reduced,
            taskName: arg as Task
          };

        default:
          throw new Error('Unhandled flag.');
      }
    },
    {
      taskName: undefined,
      help: false,
      config: './build-config.json'
    }
  );

  // tslint:disable:no-floating-promises
  if (settings.taskName !== undefined) {
    if (settings.help) {
      showHelp();
    } else {
      runTask(settings.taskName, settings.config);
    }
  } else if (settings.help) {
    showHelp();
  } else {
    throw new ExternalError('Nothing specified.');
  }
  // tslint:enable:no-floating-promises
}

/**
 * Show help information.
 */
function showHelp(): void {
  const padding = 40;

  const commandOptions = Object.entries(commands).reduce(
    (reduced, [name, desc]) => `${reduced}  ${name.padEnd(padding)}${desc}\n`,
    ''
  );

  const optionsOptions = Object.entries(flags).reduce(
    (reduced, [flag, desc]) => {
      const flagParams = desc.slice(0, desc.length - 1).join(', ');
      const flagAlias = Object.entries(flagMap).reduce(
        (r, [aliasName, mappedFlag]) => {
          if (flag === mappedFlag) {
            return `${r}, ${
              flagParams.length > 0
                ? `${aliasName} ${flagParams}`
                : `${aliasName}`
            }`;
          }
          return r;
        },
        flagParams.length > 0 ? `${flag} ${flagParams}` : `${flag}`
      );
      return `${reduced}  ${flagAlias.padEnd(padding)}${
        desc[desc.length - 1]
      }\n`;
    },
    ''
  );

  const helpString = `\
Usage: catalyst-elements <command> [options]

where <command> is one of:
${commandOptions}
[options]
${optionsOptions}`;

  console.log(helpString);
}

try {
  run(process.argv.slice(2));
} catch (error) {
  if (error instanceof ExternalError) {
    console.log(error.message);
    process.exit(2);
  } else {
    throw error;
  }
}
