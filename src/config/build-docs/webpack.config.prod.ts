import { join as joinPaths, resolve as resolvePath } from 'path';
import WebpackPluginTerser from 'terser-webpack-plugin';
import { Configuration } from 'webpack';

import { Config } from '..';
import { InternalError } from '../../errors';
import { DeepPartial } from '../../types';

import babelOptions from './babel.config.script.prod';
import { minScript as terserConfig } from './terser.config.prod';

/**
 * The webpack config for development.
 */
// tslint:disable-next-line: readonly-array
export async function getConfig(config: DeepPartial<Config>): Promise<Configuration> {
  if (config.libraryRoot === undefined) {
    return Promise.reject(new InternalError('Library root not set.'));
  }
  if (config.docs === undefined || config.docs.path === undefined) {
    return Promise.reject(new InternalError('Docs path not set.'));
  }
  if (config.docs.templateFiles === undefined || config.docs.templateFiles.entrypoint === undefined) {
    return Promise.reject(new InternalError('Docs entrypoint not set.'));
  }

  return {
    mode: 'production',
    entry: joinPaths(config.libraryRoot, config.docs.templateFiles.entrypoint),
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: [
            {
              loader: require.resolve('babel-loader'),
              options: babelOptions
            },
            {
              loader: require.resolve('ts-loader')
            }
          ],
          exclude: /node_modules/
        }
      ]
    },
    output: {
      path: resolvePath(config.docs.path),
      filename: 'main.min.js',
      chunkFilename: `common/[hash:8].min.js`
    },
    resolve: {
      extensions: ['.js', '.ts']
    },
    target: 'web',
    optimization: {
      minimizer: [
        new WebpackPluginTerser({
          terserOptions: terserConfig
        })
      ]
    },
    performance: {
      hints: 'warning',
      maxEntrypointSize: 524288, // 0.5 MB
      maxAssetSize: 524288 // 0.5 MB
    }
  };
}
