/**
 * Rollup Config.
 */

import { join as joinPaths } from 'path';
import { RollupOptions } from 'rollup';
import rollupPluginBabel from 'rollup-plugin-babel';
import rollupPluginCommonjs from 'rollup-plugin-commonjs';
import rollupPluginNodeResolve from 'rollup-plugin-node-resolve';
import rollupPluginPrettier from 'rollup-plugin-prettier';
import { terser as rollupPluginTerser } from 'rollup-plugin-terser';
import rollupPluginTypescript from 'rollup-plugin-typescript2';

import { Config } from '..';
import { DeepPartial } from '../../types';
import { glob } from '../../utils';

import babelConfigModule from './babel.config.module.prod';
import babelConfigScript from './babel.config.script.prod';
import {
  minScript as terserConfigScript,
  prettyModule as terserConfigModule
} from './terser.config.prod';

/**
 * The rollup configs for production.
 */
// tslint:disable-next-line: readonly-array
export async function getAllConfigs(config: DeepPartial<Config>): Promise<Array<Array<RollupOptions>>> {
  return Promise.all([
    getEsmConfigs(config),
    getIifeConfigs(config)
  ]);
}

/**
 * The esm rollup configs for production.
 */
// tslint:disable-next-line: readonly-array
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
  const commonConfig = getCommonConfig();

  return inputFiles.map<RollupOptions>((inputFile) => ({
    ...commonConfig,

    input: inputFile,

    output: {
      dir: config.dist!.path!,
      entryFileNames: '[name].mjs',
      chunkFileNames: 'common/[hash].mjs',
      format: 'esm',
      sourcemap: false
    },

    plugins: [
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
  }));
}

/**
 * The iife rollup configs for production.
 */
// tslint:disable-next-line: readonly-array
export async function getIifeConfigs(config: DeepPartial<Config>): Promise<Array<RollupOptions>> {
  if (config.src === undefined || config.src.path === undefined) {
    return Promise.reject(new Error('Src path not set.'));
  }
  if (config.src.entrypoint === undefined) {
    return Promise.reject(new Error('Entrypoint not set.'));
  }
  if (config.dist === undefined || config.dist.path === undefined) {
    return Promise.reject(new Error('Dist path not set.'));
  }
  if (config.src.configFiles === undefined || config.src.configFiles.tsconfig === undefined) {
    return Promise.reject(new Error('tsconfig filepath for src files not set.'));
  }

  const inputFiles = await glob(joinPaths(config.src.path, config.src.entrypoint));
  const commonConfig = getCommonConfig();

  return inputFiles.map<RollupOptions>((inputFile) => ({
    ...commonConfig,

    input: inputFile,

    output: {
      dir: config.dist!.path!,
      entryFileNames: '[name].min.js',
      chunkFileNames: 'common/[hash].min.js',
      name: 'moduleExports',
      format: 'iife',
      sourcemap: false,
      banner: 'window.CatalystElements = window.CatalystElements || {};',
      footer: 'window.CatalystElements = Object.assign(window.CatalystElements, moduleExports);'
    },

    plugins: [
      rollupPluginNodeResolve(),
      rollupPluginCommonjs(),
      rollupPluginTypescript({
        tsconfig: joinPaths(config.src!.path!, config.src!.configFiles!.tsconfig!)
      }),
      rollupPluginBabel({
        babelrc: false,
        extensions: ['.js', '.mjs', '.ts'],
        ...babelConfigScript
      }),
      rollupPluginTerser(terserConfigScript)
    ]
  }));
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
