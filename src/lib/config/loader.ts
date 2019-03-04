import { all as deepMerge } from 'deepmerge';
import { readFile } from 'fs-extra';
import { PackageJson } from 'package-json'; // tslint:disable-line: no-implicit-dependencies
import { dirname, resolve as resolvePath } from 'path';

import { ConfigError, EnvironmentError } from '../errors';
import { DeepPartial } from '../types/DeepPartial';
import { Options } from '../types/Options';

import { buildCommands, testCommands } from './commands';
import { defaultStaticConfig } from './default';
import { Config } from './interface';

/**
 * Get the config for the build process.
 *
 * @param options - The cli options the user specified.
 * @param userConfig - Any changes to the default config.
 * @param command - The command about to be run.
 * @throws {Error}
 */
export async function load(
  options: Options,
  command?: string
): Promise<Config> {
  // Read and save the package.json file.
  const packageContent = await readFile('./package.json', {encoding: 'utf-8', flag: 'r'});
  const projectPackage = JSON.parse(packageContent) as PackageJson;

  // Make sure that there is a name field.
  if (typeof projectPackage.name !== 'string' || projectPackage.name.length === 0) {
    return Promise.reject(
      new Error('package.json does not contain a valid name property.')
    );
  }

  // Make sure that there is a name field.
  const splitName = projectPackage.name.split('/');

  if (splitName.length > 2) {
    return Promise.reject(
      new Error('Too many slashes (/) found in package.json\'s name property.')
    );
  }

  // Get the package scope of the component.
  const packageScope =
    splitName.length === 1
      ? undefined
      : splitName[0];

  // Get the name of the component.
  const componentName =
    splitName.length === 1
      ? splitName[0]
      : splitName[1];

  const userConfig = await loadUserConfig(options);

  // Update the config.
  const staticConfig = deepMerge<DeepPartial<Config>>([
    defaultStaticConfig,
    userConfig
  ]);

  // All the automatically set options in the config
  const autoLoadedConfig: DeepPartial<Config> = {
    package: projectPackage,
    packageRoot: dirname(require.resolve('@catalyst-elements/dev-utils/package.json', { paths: [process.cwd()] })),
    component: {
      name: componentName,
      scope: packageScope
    },
    build: {
      tools: await loadBuildToolsConfig(options, staticConfig, command)
    }
  };

  // Update the config.
  const config = deepMerge<DeepPartial<Config>>([
    defaultStaticConfig,
    autoLoadedConfig,
    userConfig
  ]);

  const configError = checkConfig(options, config, command);
  if (configError !== undefined) {
    return Promise.reject(configError);
  }

  // Return the config.
  return config as Config;
}

/**
 * Load the build config options.
 */
async function loadBuildToolsConfig(
  options: Options,
  staticConfig?: DeepPartial<Config>,
  command?: string
): Promise<DeepPartial<Config['build']['tools']>> {
  // Don't bother loading the config if it is known that it won't be used.
  if (!(command === undefined || buildCommands.includes(command) || testCommands.includes(command))) {
    return {};
  }

  // User has defined their own rollup config?
  const userRollupConfigExists =
    staticConfig !== undefined &&
    staticConfig.build !== undefined &&
    staticConfig.build.tools !== undefined &&
    staticConfig.build.tools[options.env] !== undefined &&
    staticConfig.build.tools[options.env]!.rollup !== undefined;

  const rollupConfig = await (
      options.env === 'development'
    ? import('./build/rollup.config.dev')
    : options.env === 'production'
    ? import('./build/rollup.config.prod')
    : options.env === 'test'
    ? import('./test/rollup.config')
    : Promise.reject(new EnvironmentError(options.env))
  );

  if (staticConfig === undefined || staticConfig.src === undefined || staticConfig.src.entrypoint === undefined) {
    return Promise.reject(new ConfigError('src entrypoint not set.'));
  }
  if (staticConfig.src.path === undefined) {
    return Promise.reject(new ConfigError('src path not set.'));
  }

  const envConfig = userRollupConfigExists
    ? undefined
    : {
        rollup: await rollupConfig.getAllConfigs(staticConfig)
      };

  return {
    [options.env]: envConfig
  };
}

/**
 * Check the config is all good.
 */
function checkConfig(
  options: Options,
  config: DeepPartial<Config> | undefined,
  command?: string
): Error | undefined {
  if (config === undefined) {
    return new Error('"config" === undefined');
  }

  const buildConfigError = checkBuildConfig(config.build, options, command);
  if (buildConfigError !== undefined) {
    return buildConfigError;
  }

  const testsConfigError = checkTestConfig(config.tests, command);
  if (testsConfigError !== undefined) {
    return testsConfigError;
  }

  return undefined;
}

/**
 * Check the build config is all good.
 */
// tslint:disable-next-line: cognitive-complexity
function checkBuildConfig(
  build: DeepPartial<Config['build']> | undefined,
  options: Options,
  command?: string
): Error | undefined {
  // tslint:disable:curly

  // If the build command is going to be run (or might be run), make sure the build config is all good.
  if (!(command === undefined || buildCommands.includes(command) || testCommands.includes(command))) {
    return undefined;
  }

  if (build === undefined)                            return new Error('"config.build" === undefined');
  if (build.module === undefined)                     return new Error('"config.build.module" === undefined');
  if (build.module.create === undefined)              return new Error('"config.build.module.create" === undefined');
  if (build.module.extension === undefined)           return new Error('"config.build.module.extension" === undefined');
  if (build.script === undefined)                     return new Error('"config.build.script" === undefined');
  if (build.script.create === undefined)              return new Error('"config.build.script.create" === undefined');
  if (build.script.extension === undefined)           return new Error('"config.build.script.extension" === undefined');
  if (build.tools === undefined)                      return new Error('"config.build.tools" === undefined');
  if (build.tools[options.env] === undefined)         return new Error(`"config.build.tools.${options.env}" === undefined`);
  if (build.tools[options.env]!.rollup === undefined)  return new Error(`"config.build.tools.${options.env}.rollup" === undefined`);

  // Check for bad state.
  if (!(build.script.create || build.module.create)) {
    return new ConfigError('Both building of the module and the script cannot be turned off.');
  }
  if (build.script.extension === build.module.extension) {
    return new ConfigError('The module and the script cannot both have the same file extension.');
  }

  return undefined;
  // tslint:enable:curly
}

/**
 * Check the test config is all good.
 */
// tslint:disable-next-line: cognitive-complexity
function checkTestConfig(
  test: DeepPartial<Config['tests']> | undefined,
  command?: string
): Error | ConfigError | undefined {
  // If the build command is going to be run (or might be run), make sure the build config is all good.
  if (!(command === undefined || buildCommands.includes(command) || testCommands.includes(command))) {
    return undefined;
  }

  if (test === undefined) {
    return new Error('"config.test" === undefined');
  }

  return undefined;
}

/**
 * Load the user defined config.
 */
async function loadUserConfig(options: Options): Promise<DeepPartial<Config>> {
  const userConfigFileAbsPath = options.userConfigFile === false
    ? false
    : resolvePath(options.userConfigFile);

  return (
    userConfigFileAbsPath === false
      ? {}
      : (await import(userConfigFileAbsPath)
        .catch(async (error) => {
          return Promise.reject(`Unable to load config "${userConfigFileAbsPath}"\n${error}`);
        }) as {
          // tslint:disable-next-line: completed-docs no-reserved-keywords
          readonly default: DeepPartial<Config>;
        }).default
  );
}
