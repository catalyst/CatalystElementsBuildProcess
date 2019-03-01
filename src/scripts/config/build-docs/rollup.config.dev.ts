/**
 * Rollup Config.
 */

import { join as joinPaths } from 'path';
import { RollupOptions } from 'rollup';
import rollupPluginCommonjs from 'rollup-plugin-commonjs';
import rollupPluginNodeResolve from 'rollup-plugin-node-resolve';
import rollupPluginTypescript from 'rollup-plugin-typescript2';

import { Config } from '..';
import { InternalError } from '../../../errors';
import { DeepPartial } from '../../../types';

/**
 * The esm rollup config for development.
 */
// tslint:disable-next-line: readonly-array
export async function getAllConfigs(config: DeepPartial<Config>): Promise<Array<RollupOptions>> {
  return Promise.all([
    getEsmConfig(config)
  ]);
}

/**
 * The esm rollup config for development.
 */
// tslint:disable-next-line: readonly-array
export async function getEsmConfig(config: DeepPartial<Config>): Promise<RollupOptions> {
  if (config.libraryRoot === undefined) {
    return Promise.reject(new InternalError('Library root not set.'));
  }
  if (config.docs === undefined || config.docs.path === undefined) {
    return Promise.reject(new InternalError('Docs path not set.'));
  }
  if (config.docs.templateFiles  === undefined || config.docs.templateFiles.entrypoint === undefined) {
    return Promise.reject(new InternalError('Docs entrypoint not set.'));
  }

  return {
    input: joinPaths(config.libraryRoot, config.docs.templateFiles.entrypoint),

    output: {
      dir: config.docs.path,
      entryFileNames: '[name].mjs',
      chunkFileNames: 'common/[hash].mjs',
      format: 'esm',
      sourcemap: false
    },

    plugins: [
      rollupPluginNodeResolve(),
      rollupPluginCommonjs(),
      rollupPluginTypescript({
        tsconfig: joinPaths(config.libraryRoot, config.docs.templateFiles.tsconfig)
      })
    ]
  };
}
