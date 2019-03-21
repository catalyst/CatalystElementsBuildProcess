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
import { InternalError } from '../../errors';
import { DeepPartial } from '../../types';
import { config as rollupPluginCommonjsConfig } from '../rollupPluginCommonjs';

/**
 * The esm rollup config for development.
 */
export async function getAllConfigs(config: DeepPartial<Config>): Promise<Array<RollupOptions>> {
  return Promise.all([
    getEsmConfig(config)
  ]);
}

/**
 * The esm rollup config for development.
 */
export async function getEsmConfig(config: DeepPartial<Config>): Promise<RollupOptions> {
  if (config.packageRoot === undefined) {
    return Promise.reject(new InternalError('Library root not set.'));
  }
  if (config.docs === undefined || config.docs.path === undefined) {
    return Promise.reject(new InternalError('Docs path not set.'));
  }
  if (config.docs.templateFiles  === undefined || config.docs.templateFiles.entrypoint === undefined) {
    return Promise.reject(new InternalError('Docs entrypoint not set.'));
  }
  if (config.docs.templateFiles.tsconfig === undefined) {
    return Promise.reject(new InternalError('Docs tsconfig not set.'));
  }

  return {
    input: joinPaths(config.packageRoot, config.docs.templateFiles.entrypoint),

    output: {
      dir: config.docs.path,
      entryFileNames: '[name].mjs',
      chunkFileNames: 'common/[hash].mjs',
      format: 'esm',
      sourcemap: false
    },

    plugins: [
      rollupPluginNodeResolve(),
      rollupPluginCommonjs(rollupPluginCommonjsConfig),
      rollupPluginTypescript({
        tsconfig: joinPaths(config.packageRoot, config.docs.templateFiles.tsconfig)
      })
    ]
  };
}
