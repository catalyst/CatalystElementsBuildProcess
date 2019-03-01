import { copy, outputFile } from 'fs-extra';
import { resolve as resolvePath } from 'path';
import { rollup, RollupOptions } from 'rollup';
import sortPackage from 'sort-package-json';

import rollupBuildConfig from '../rollup.config';

/**
 * Build everything.
 */
export async function build(): Promise<void> {
  await buildRollup(rollupBuildConfig);
  await Promise.all([
    createPackageJson(),
    copyDistFiles()
  ]);
}

/**
 * @param rollupConfig The rollup config file to use.
 * @returns the filenames output.
 */
export async function buildRollup(
  rollupConfig: ReadonlyArray<RollupOptions>
// tslint:disable-next-line: readonly-array
): Promise<Array<string>> {
  const rollupBuilds = await Promise.all(
    rollupConfig.map(async (config) => {
      return rollup(config);
    })
  );

  const buildOutputs = await Promise.all(
    rollupBuilds.map(async (rollupBuild, index) => {
      const config = rollupConfig[index];
      if (config.output === undefined) {
        return Promise.reject(new Error('output not defined'));
      }
      return rollupBuild.write(config.output);
    })
  );

  // Return an array of the filenames output.
  return buildOutputs.reduce((r0, b) => [...r0, ...b.output.reduce((r1, output) => [...r1, output.fileName], [])], []);
}

/**
 * Create the package.json file for release.
 */
async function createPackageJson(): Promise<void> {
  const pkg = (await import('../../package.json')).default;

  // tslint:disable: no-object-mutation no-any
  const distPkg = {
    ...pkg
  };
  delete (distPkg as any).scripts;
  delete (distPkg as any).devDependencies;
  // tslint:enable: no-object-mutation no-any

  await outputFile(resolvePath('dist/package.json'), JSON.stringify(sortPackage(distPkg), undefined, 2));
}

/**
 * Copy any other files to be released to the dist folder.
 */
async function copyDistFiles(): Promise<void> {
  const files: ReadonlyArray<string> = [
    'LICENSE',
    'README.md'
  ];

  await Promise.all(
    files.map(
      async (file) => copy(resolvePath(file), resolvePath('dist', file))
    )
  );
}
