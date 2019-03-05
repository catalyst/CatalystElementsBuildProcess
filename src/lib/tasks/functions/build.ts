import * as assert from 'assert';
import { rollup, RollupOptions, RollupWatchOptions, watch as rollupWatch } from 'rollup';

import { Config } from '../../config';
import { Options } from '../../types/Options';

/**
 * Build for the development environment.
 */
export async function buildDevelopment(options: Options, config: Config): Promise<void> {
  if (options.watch) {
    const watchResult = watchComponent(config.build.tools.development.rollup);
    if (watchResult instanceof Error) {
      return Promise.reject(watchResult);
    }
  } else {
    await buildComponent(config.build.tools.development);
  }
}

/**
 * Build for the production environment.
 */
export async function buildProduction(options: Options, config: Config): Promise<void> {
  if (options.watch) {
    const watchResult = watchComponent(config.build.tools.production.rollup);
    if (watchResult instanceof Error) {
      return Promise.reject(watchResult);
    }
  } else {
    const outputFiles = await buildComponent(config.build.tools.production);
    assert.strictEqual(outputFiles.length, 2, 'There should be two output files.');
  }
}

/**
 * Build the component for use.
 *
 * @param config The rollup config file to use.
 * @returns the filenames output.
 */
export async function buildComponent(
  config: Config['build']['tools']['production'] | Config['build']['tools']['development']
// tslint:disable-next-line: readonly-array
): Promise<Array<string>> {
  const outputFiles = await Promise.all(
    config.rollup.map(async (buildConfig) => {
      const rollupConfigArray: ReadonlyArray<RollupOptions> = Array.isArray(buildConfig)
        ? buildConfig
        : [buildConfig];

      const rollupBuilds = await Promise.all(
        rollupConfigArray.map(async (rollupConfig) => {
          return rollup(rollupConfig);
        })
      );

      console.log(`Building "${rollupConfigArray[0].input}"`);

      const buildOutputs = await Promise.all(
        rollupBuilds.map(async (rollupBuild, index) => {
          const rollupConfig = rollupConfigArray[index];
          if (rollupConfig.output === undefined) {
            return Promise.reject(new Error('output not defined'));
          }
          return rollupBuild.write(rollupConfig.output);
        })
      );

      // Return an array of the filenames output.
      return buildOutputs.reduce((r0, build) => [...r0, ...build.output.reduce((r1, output) => [...r1, output.fileName], [])], []);
    })
  );

  return outputFiles.reduce((r, files) => [...r, ...files], []);
}

/**
 * Build the component and watch for changes. Auto rebuilt when a change is detected.
 *
 * @param rollupConfig The rollup config to use
 */
export function watchComponent(rollupConfig: ReadonlyArray<ReadonlyArray<RollupWatchOptions>>): void | Error {
  if (rollupConfig.length === 0) {
    return Error('Cannot watch component; no build configs.');
  }
  if (rollupConfig.length > 1) {
    return Error('Cannot watch component; too many build configs.');
  }

  // tslint:disable-next-line: readonly-array
  rollupWatch(rollupConfig[0] as Array<RollupWatchOptions>);
}
