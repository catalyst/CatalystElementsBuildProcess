// Libraries.
import deepMerge from 'deepmerge';
import { readFile } from 'fs-extra';

// Config
import { defaultConfig, IConfig } from './config';

// Load the jobs.
import { analyze } from './jobs/analyze';
import { jobBuild } from './jobs/build';
import { buildDocs } from './jobs/buildDocs';
import { fixDependencies } from './jobs/fixDependencies';
import { lint } from './jobs/lint';
import { publish, publishDry } from './jobs/publish';
import { test } from './jobs/test';
import { cleanTemp, ConfigError, INodePackage } from './util';

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
  ) as INodePackage | undefined;

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
    component: {
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

type Job = (
  jobLabel: string,
  config?: Promise<IConfig> | IConfig
) => Promise<void>;

type InternalJob = (
  jobLabel: string,
  config: IConfig
) => Promise<void>;

/**
 * The jobs to be exported mapped by their name.
 */
const jobsByName = {
  analyze,
  build: jobBuild,
  buildDocs,
  clean: async (jobName: string, config: IConfig): Promise<void> =>
    cleanTemp(config, jobName),
  fixDependencies,
  lint,
  publish,
  publishDry,
  test
};

/**
 * The Jobs.
 */
export const JOBS = new Map(
  (Object.entries(jobsByName) as ReadonlyArray<
    [
      keyof typeof jobsByName,
      (jobName: string, config: IConfig) => Promise<void>
    ]
  >).reduce(
    (
      reducedJobs: ReadonlyArray<[keyof typeof jobsByName, Job]>,
      [jobName, jobFunc]: [keyof typeof jobsByName, InternalJob]
    ): ReadonlyArray<[keyof typeof jobsByName, Job]> => [
      ...reducedJobs,
      [
        jobName,
        async (jobLabel = jobName, config) => {
          await jobFunc(
            jobLabel,
            config === undefined
              ? await getConfig()
              : await config
          );
        }
      ]
    ],
    []
  )
);
