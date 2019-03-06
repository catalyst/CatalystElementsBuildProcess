/**
 * Rollup Config.
 */

// tslint:disable: no-unsafe-any

import { join as joinPaths } from 'path';
import { RollupOptions } from 'rollup';
import rollupPluginCommonjs from 'rollup-plugin-commonjs';
import rollupPluginNodeResolve from 'rollup-plugin-node-resolve';
import rollupPluginTypescript from 'rollup-plugin-typescript2';

import { Config } from '..';
import { DeepPartial } from '../../types';
import { glob } from '../../utils';

/**
 * The rollup configs for development.
 */
export async function getAllConfigs(config: DeepPartial<Config>): Promise<Array<Array<RollupOptions>>> {
  return Promise.all([
    getEsmConfigs(config)
  ]);
}

/**
 * The esm rollup configs for development.
 */
export async function getEsmConfigs(config: DeepPartial<Config>): Promise<Array<RollupOptions>> {
  if (config.src === undefined || config.src.path === undefined) {
    return Promise.reject(new Error('Src path not set.'));
  }
  if (config.src.entrypoint === undefined) {
    return Promise.reject(new Error('Src entrypoint not set.'));
  }
  if (config.dist === undefined || config.dist.path === undefined) {
    return Promise.reject(new Error('Dist path not set.'));
  }
  if (config.src.configFiles === undefined || config.src.configFiles.tsconfig === undefined) {
    return Promise.reject(new Error('tsconfig filepath for src files not set.'));
  }

  const inputFiles = await glob(joinPaths(config.src.path, config.src.entrypoint));

  return inputFiles.map<RollupOptions>((inputFile) => ({
    input: inputFile,

    output: {
      dir: config.dist!.path!,
      entryFileNames: '[name].mjs',
      chunkFileNames: 'common/[hash].mjs',
      format: 'esm',
      sourcemap: false
    },

    external: [],

    treeshake: false,

    plugins: [
      rollupPluginNodeResolve(),
      rollupPluginCommonjs(),
      rollupPluginTypescript({
        tsconfig: joinPaths(config.src!.path!, config.src!.configFiles!.tsconfig!)
      })
    ]
  }));
}
