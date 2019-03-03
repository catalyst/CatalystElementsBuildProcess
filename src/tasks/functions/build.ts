import * as assert from 'assert';
import { copy, outputFile } from 'fs-extra';
import { PackageJson } from 'package-json'; // tslint:disable-line: no-implicit-dependencies
import { resolve as resolvePath } from 'path';
import { rollup, RollupOptions, RollupWatchOptions, watch as rollupWatch } from 'rollup';
import sortPackage from 'sort-package-json';

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

    const [moduleFile, scriptFile] = outputFiles;

    await Promise.all([
      createPackageJson(config, config.package, scriptFile, moduleFile),
      copyDistFiles(config)
    ]);
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
  if (rollupConfig.length !== 1) {
    return Error('Cannot watch component; too many build configs.');
  }

  // tslint:disable-next-line: readonly-array
  rollupWatch(rollupConfig[0] as Array<RollupWatchOptions>);
}

/**
 * Create the package.json file for release.
 */
async function createPackageJson(config: Config, pkg: PackageJson, mainFile: string, moduleFile: string): Promise<void> {
  // tslint:disable: no-object-mutation no-any
  const distPkg = {
    ...pkg,
    main: mainFile,
    module: moduleFile
  };
  delete (distPkg).scripts;
  delete (distPkg).devDependencies;
  // tslint:enable: no-object-mutation no-any

  await outputFile(resolvePath(config.dist.path, 'package.json'), JSON.stringify(sortPackage(distPkg), undefined, 2));
}

/**
 * Copy any other files to be released to the dist folder.
 */
async function copyDistFiles(config: Config): Promise<void> {
  const files: ReadonlyArray<string> = [
    'LICENSE',
    'README.md'
  ];

  await Promise.all(
    files.map(
      async (file) => copy(resolvePath(file), resolvePath(config.dist.path, file))
    )
  );
}
