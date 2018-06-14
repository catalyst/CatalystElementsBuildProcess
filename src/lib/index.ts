// Libraries.
import deepMerge from 'deepmerge';
import { readFile } from 'fs-extra';

// Config
import { defaultConfig, IConfig } from './config';

// Load the tasks.
import { analyze } from './tasks/analyze';
import { build } from './tasks/build';
import { buildDocs } from './tasks/buildDocs';
import { fixDependencies } from './tasks/fixDependencies';
import { lint } from './tasks/lint';
import { publish, publishDry } from './tasks/publish';
import { test } from './tasks/test';
import { cleanTemp, ConfigError } from './util';

/**
 * Get the config for the build process.
 *
 * @param options - Any changes to the default config.
 * @throws {Error}
 */
export async function getConfig(options?: Partial<IConfig>): Promise<IConfig> {
  // Read and save the package.json file.
  const projectPackage = JSON.parse(
    await readFile('./package.json', { encoding: 'utf8', flag: 'r' })
  // tslint:disable-next-line:no-any
  ) as { readonly [key: string]: any } | undefined;

  // Make sure the file was successfully loaded.
  if (projectPackage === undefined) {
    throw new Error('Failed to load package.json');
  }

  // Make sure the there is a name field.
  if (typeof projectPackage.name !== 'string') {
    throw new Error(
      'package.json does not contain a name property as a string'
    );
  }

  // Get the package scope of the component
  const packageScope = projectPackage.name.substring(
    0,
    projectPackage.name.lastIndexOf('/')
  );

  // All the automatically set options in the config (can be overridden with `options`)
  const autoLoadedConfig: Partial<IConfig> = {
    package: projectPackage,
    componenet: {
      scope: packageScope === '' ? undefined : packageScope
    }
  };

  // Update the config.
  const config =
    options !== undefined
      ? deepMerge.all<IConfig>([defaultConfig, autoLoadedConfig, options])
      : deepMerge.all<IConfig>([defaultConfig, autoLoadedConfig]);

  // Check the new config is all good.
  if (!(config.build.script.create || config.build.module.create)) {
    throw new ConfigError(
      'Both building of the module and the script cannot be turned off.'
    );
  }

  if (config.build.script.extension === config.build.module.extension) {
    throw new ConfigError(
      'The module and the script cannot both have the same file extension.'
    );
  }

  // Return the config.
  return config;
}

type Task = (
  taskLabel: string,
  config?: Promise<IConfig> | IConfig
) => Promise<void>;
type InternalTask = (taskLabel: string, config: IConfig) => Promise<void>;

/**
 * The tasks to be exported mapped by their name.
 */
const tasksByName = {
  analyze,
  build,
  buildDocs,
  clean: async (taskName: string, config: IConfig): Promise<void> =>
    cleanTemp(config, taskName),
  fixDependencies,
  lint,
  publish,
  publishDry,
  test
};

/**
 * The tasks.
 */
export const TASKS = new Map(
  (Object.entries(tasksByName) as ReadonlyArray<
    [
      keyof typeof tasksByName,
      (taskName: string, config: IConfig) => Promise<void>
    ]
  >).reduce(
    (
      reducedTasks: ReadonlyArray<[keyof typeof tasksByName, Task]>,
      [taskName, taskFunc]: [keyof typeof tasksByName, InternalTask]
    ): ReadonlyArray<[keyof typeof tasksByName, Task]> => [
      ...reducedTasks,
      [
        taskName,
        async (taskLabel = taskName, config) => {
          if (config === undefined) {
            await taskFunc(taskLabel, await getConfig());
          } else {
            await taskFunc(taskLabel, await config);
          }
        }
      ]
    ],
    []
  )
);
