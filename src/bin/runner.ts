#!/usr/bin/env node

/**
 * The entry point file to run the jobs defined in ../lib/ from the commandline.
 */

import { existsSync, readJSON } from 'fs-extra';

import { getConfig, JOBS } from '../lib';
import { MultiPromiseRejectionError } from '../lib/classes/MultiPromiseRejectionError';
import { IConfig } from '../lib/config';
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

type Job = Exclude<keyof typeof commands, 'help'>;
interface IRunSettings {
  readonly jobName?: Job;
  readonly help: boolean;
  readonly config: string;
}

const flags = {
  '-c': ['<file>', 'Where <file> is the config file to use.'],
  '-h': ['Display help information.']
};

const flagMap: { readonly [key: string]: keyof typeof flags } = {
  '--congif-file': '-c',
  '--help': '-h'
};

/**
 * Run the script.
 */
function run(args: ReadonlyArray<string>): void {
  if (args.length === 0) {
    throw new ExternalError('No job name given. Use --help for more info.');
  }

  const settings = getSettings(args);

  // tslint:disable:no-floating-promises
  if (settings.jobName !== undefined) {
    if (settings.help) {
      showHelp();
    } else {
      runJob(settings.jobName, settings.config);
    }
  } else if (settings.help) {
    showHelp();
  } else {
    throw new ExternalError('Nothing specified.');
  }
  // tslint:enable:no-floating-promises
}

/**
 * Get the settings passed into this script.
 */
function getSettings(args: ReadonlyArray<string>): IRunSettings {
  return args.reduce(
    (reduced: IRunSettings, arg) => {
      switch (getFlag(arg)) {
        case '-c':
          return {
            ...reduced,
            config: '' // FIXME: set value.
          };

        case '-h':
          return {
            ...reduced,
            help: true
          };

        case false:
          if (!Object.prototype.hasOwnProperty.call(commands, arg)) {
            throw new ExternalError(`No job with the name "${arg}" exists.`);
          }
          if (arg === 'help') {
            return {
              ...reduced,
              help: true
            };
          }
          return {
            ...reduced,
            jobName: arg as Job
          };

        default:
          throw new Error('Unhandled flag.');
      }
    },
    {
      jobName: undefined,
      help: false,
      config: './build-config.json'
    }
  );
}

/**
 * Run a job.
 *
 * @param jobName The name of the job to run.
 */
async function runJob(jobName: Job, userConfigFile: string): Promise<void> {
  const job = JOBS.get(jobName);

  if (job === undefined) {
    throw new Error(`No job with the name "${jobName}" exists.`);
  }

  try {
    if (existsSync(userConfigFile)) {
      const userConfig = (await readJSON(userConfigFile)) as Partial<IConfig>;
      await job(jobName, getConfig(userConfig));
    } else {
      await job(jobName);
    }
  } catch (error) {
    console.info('Job Failed.');
    if (error instanceof Error) {
      if (error instanceof MultiPromiseRejectionError) {
        console.info(`  - ${error.errors.join('\n  - ')}`);
      } else {
        console.info(error.message);
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
 * Show help information.
 */
function showHelp(): void {
  const padding = 40;

  const commandOptions = Object.entries(commands)
    .reduce(
      (reduced, [name, desc]) => `${reduced}  ${name.padEnd(padding)}${desc}\n`,
      ''
    );

  const optionsOptions = Object.entries(flags)
    .reduce(
      (reduced, [flag, desc]) => {
        const flagParams = desc
          .slice(0, desc.length - 1)
          .join(', ');

        const flagAliases = Object.entries(flagMap)
          .reduce(
            (reducedFlagMap, [aliasName, mappedFlag]) => {
              if (flag === mappedFlag) {
                const flagAlias =
                  flagParams.length > 0
                    ? `${aliasName} ${flagParams}`
                    : `${aliasName}`;
                return `${reducedFlagMap}, ${flagAlias}`;
              }
              return reducedFlagMap;
            },
            flagParams.length > 0 ? `${flag} ${flagParams}` : `${flag}`
          );
        return `${reduced}  ${flagAliases.padEnd(padding)}${
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

  console.info(helpString);
}

try {
  run(process.argv.slice(2));
} catch (error) {
  if (error instanceof ExternalError) {
    console.info(error.message);
    process.exit(2);
  } else {
    throw error;
  }
}
