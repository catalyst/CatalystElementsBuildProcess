/**
 * Rollup Config.
 */

// tslint:disable: no-unsafe-any

import { join as joinPaths } from 'path';
import { RollupOptions } from 'rollup';
import rollupPluginBabel from 'rollup-plugin-babel';
import rollupPluginCommonjs from 'rollup-plugin-commonjs';
import rollupPluginNodeResolve from 'rollup-plugin-node-resolve';
import { terser as rollupPluginTerser } from 'rollup-plugin-terser';
import rollupPluginTypescript from 'rollup-plugin-typescript2';

import { Config } from '..';
import { InternalError } from '../../errors';
import { DeepPartial } from '../../types';
import { config as rollupPluginCommonjsConfig } from '../rollupPluginCommonjs';

import { getConfig as getBabelConfigModule } from './babel.config.module.prod';
import { getConfig as getBabelConfigScript } from './babel.config.script.prod';
import {
  minModule,
  minScript as terserConfigMin
} from './terser.config.prod';

/**
 * The esm rollup config for production.
 */
export async function getAllConfigs(config: DeepPartial<Config>): Promise<Array<RollupOptions>> {
  return Promise.all([
    getEsmConfig(config),
    getEs5AdapterLoaderConfig(config)
  ]);
}

/**
 * The esm rollup config for production.
 */
export async function getEsmConfig(config: DeepPartial<Config>): Promise<RollupOptions> {
  if (config.packageRoot === undefined) {
    return Promise.reject(new InternalError('Library root not set.'));
  }
  if (config.docs === undefined || config.docs.templateFiles  === undefined || config.docs.templateFiles.entrypoint === undefined) {
    return Promise.reject(new InternalError('Docs entrypoint not set.'));
  }
  if (config.docs.templateFiles.tsconfig === undefined) {
    return Promise.reject(new InternalError('Docs tsconfig not set.'));
  }
  if (config.docs.path === undefined) {
    return Promise.reject(new InternalError('Docs dist path not set.'));
  }
  if (config.temp === undefined || config.temp.path === undefined) {
    return Promise.reject(new InternalError('Temp path not set.'));
  }

  return {
    input: joinPaths(config.packageRoot, config.docs.templateFiles.entrypoint),

    output: {
      dir: config.docs.path,
      entryFileNames: '[name].min.mjs',
      chunkFileNames: 'common/[hash].min.mjs',
      format: 'esm',
      sourcemap: false
    },

    treeshake: {
      pureExternalModules: true,
      propertyReadSideEffects: false,
      annotations: true
    },

    plugins: [
      rollupPluginNodeResolve(),
      rollupPluginCommonjs(rollupPluginCommonjsConfig),
      rollupPluginTypescript({
        tsconfig: joinPaths(config.packageRoot, config.docs.templateFiles.tsconfig)
      }),
      rollupPluginBabel({
        babelrc: false,
        extensions: ['.js', '.mjs', '.ts'],
        ...getBabelConfigModule()
      }),
      rollupPluginTerser(minModule)
    ]
  };
}

/**
 * The rollup config for the es5 adapter loader.
 */
export async function getEs5AdapterLoaderConfig(config: DeepPartial<Config>): Promise<RollupOptions> {
  if (config.packageRoot === undefined) {
    return Promise.reject(new InternalError('Library root not set.'));
  }
  if (config.docs === undefined || config.docs.path === undefined) {
    return Promise.reject(new InternalError('Docs path not set.'));
  }
  if (config.temp === undefined || config.temp.path === undefined) {
    return Promise.reject(new InternalError('Temp path not set.'));
  }

  return {
    input: joinPaths(config.temp.path, config.docs.path, 'es5-adapter-loader.js'),

    output: {
      dir: joinPaths(config.temp.path, config.docs.path),
      entryFileNames: '[name].min.js',
      format: 'iife',
      sourcemap: false
    },

    plugins: [
      rollupPluginNodeResolve(),
      rollupPluginCommonjs(rollupPluginCommonjsConfig),
      rollupPluginBabel({
        babelrc: false,
        extensions: ['.js', '.mjs', '.ts'],
        ...getBabelConfigScript()
      }),
      rollupPluginTerser(terserConfigMin)
    ]
  };
}
