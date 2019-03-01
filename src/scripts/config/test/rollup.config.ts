/**
 * Rollup Config.
 */

import { join as joinPaths } from 'path';
import { RollupOptions } from 'rollup';
import rollupPluginBabel from 'rollup-plugin-babel';
import rollupPluginCommonjs from 'rollup-plugin-commonjs';
import rollupPluginMultiEntry from 'rollup-plugin-multi-entry';
import rollupPluginNodeResolve from 'rollup-plugin-node-resolve';
import rollupPluginPrettier from 'rollup-plugin-prettier';
import { terser as rollupPluginTerser } from 'rollup-plugin-terser';
import rollupPluginTypescript from 'rollup-plugin-typescript2';

import { Config } from '..';
import { DeepPartial } from '../../../types';
import babelConfigModule from '../build/babel.config.module.prod';
import {
  prettyModule as terserConfigModule
} from '../build/terser.config.prod';

/**
 * The esm rollup config for production.
 */
// tslint:disable-next-line: readonly-array
export async function getAllConfigs(config: DeepPartial<Config>): Promise<Array<Array<RollupOptions>>> {
  return Promise.all([
    getTestFilesConfigs(config)
  ]);
}

/**
 * The iife rollup config for production.
 */
// tslint:disable-next-line: readonly-array
export async function getTestFilesConfigs(config: DeepPartial<Config>): Promise<Array<RollupOptions>> {
  if (config.tests === undefined || config.tests.path === undefined) {
    return Promise.reject(new Error('Tests path not set.'));
  }
  if (config.src === undefined || config.src.configFiles === undefined || config.src.configFiles.tsconfig === undefined) {
    return Promise.reject(new Error('tsconfig filepath for src files not set.'));
  }

  const commonConfig = getCommonConfig();

  return [{
    ...commonConfig,

    input: `${config.tests.path}/${config.tests.testFiles}`,

    output: {
      dir: config.tests.path,
      entryFileNames: 'index.js',
      chunkFileNames: 'index-[hash].js',
      name: 'moduleExports',
      format: 'iife',
      sourcemap: false
    },

    plugins: [
      rollupPluginMultiEntry(),
      rollupPluginNodeResolve(),
      rollupPluginCommonjs(),
      rollupPluginTypescript({
        tsconfig: joinPaths(config.src!.path!, config.src!.configFiles!.tsconfig!)
      }),
      rollupPluginBabel({
        babelrc: false,
        extensions: ['.js', '.mjs', '.ts'],
        ...babelConfigModule
      }),
      rollupPluginTerser(terserConfigModule),
      rollupPluginPrettier({
        parser: 'babel'
      })
    ]
  }];
}

/**
 * The iife rollup config for production.
 */
// tslint:disable-next-line: typedef
function getCommonConfig() {
  return {
    external: [],

    treeshake: {
      pureExternalModules: true,
      propertyReadSideEffects: false,
      annotations: true
    }
  };
}
