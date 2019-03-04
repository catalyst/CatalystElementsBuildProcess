import { join as joinPaths, resolve as resolvePath } from 'path';
import { Configuration } from 'webpack';

import { Config } from '..';
import { InternalError } from '../../errors';
import { DeepPartial } from '../../types';

/**
 * The webpack config for development.
 */
// tslint:disable-next-line: readonly-array
export async function getConfig(config: DeepPartial<Config>): Promise<Configuration> {
  if (config.packageRoot === undefined) {
    return Promise.reject(new InternalError('Library root not set.'));
  }
  if (config.docs === undefined || config.docs.path === undefined) {
    return Promise.reject(new InternalError('Docs path not set.'));
  }
  if (config.docs.templateFiles === undefined || config.docs.templateFiles.entrypoint === undefined) {
    return Promise.reject(new InternalError('Docs entrypoint not set.'));
  }

  return {
    mode: 'development',
    entry: joinPaths(config.packageRoot, config.docs.templateFiles.entrypoint),
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: [
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
      filename: 'main.js',
      chunkFilename: `common/[hash:8].js`
    },
    resolve: {
      extensions: ['.js', '.ts']
    },
    target: 'web',
    performance: {
      hints: false
    }
  };
}
