import del from 'del';
import { copy } from 'fs-extra';
import { resolve as resolvePath } from 'path';
import { rollup, RollupOptions } from 'rollup';

import rollupBuildConfig from '../rollup.config';

/**
 * Build everything.
 */
export async function build(): Promise<void> {
  await del(['lib', 'bin']);
  await buildRollup(rollupBuildConfig);
  await copyTemplateFiles();
}

/**
 * @param rollupConfig The rollup config file to use.
 * @returns the filenames output.
 */
async function buildRollup(
  rollupConfig: ReadonlyArray<RollupOptions>
): Promise<Array<string>> {
  const rollupBuilds = await Promise.all(rollupConfig.map(rollup));

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
 * Copy over all the template files.
 */
async function copyTemplateFiles(): Promise<void> {
  const files: ReadonlyArray<string> = [
    'lib/templates'
  ];

  await Promise.all(
    files.map(async (file) => copy(resolvePath('src', file), resolvePath(file)))
  );
}
