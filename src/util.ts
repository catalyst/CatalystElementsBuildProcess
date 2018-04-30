// Libraries.
import { blue, cyan, green, grey, red, white } from 'ansi-colors';
import del from 'del';
import log from 'fancy-log';
import stripColor from 'strip-color';
import VinylFile from 'vinyl';
import { Plugin } from 'webpack';
import WebpackClosureCompilerPlugin from 'webpack-closure-compiler';

import MultiPromiseRejectionError from './classes/MultiPromiseRejectionError';
import PreWebpackClosureCompilerPlugin from './classes/PreWebpackClosureCompilerPlugin';
import { IConfig } from './config';

// Helper functions for tasks.
export const tasksHelpers = {
  log: {
    failed: (label: string, prefix: string = '') => {
      const fullLabel = `${grey(stripColor(prefix))} ${blue('→')} ${cyan(
        label
      )}`;

      log(`Failed     ${fullLabel} ${red('✗')}`);
      return fullLabel;
    },
    info: (label: string, prefix: string = '') => {
      const fullLabel = `${grey(stripColor(prefix))} ${blue('→')} ${white(
        label
      )}`;

      log(`Info       ${fullLabel}`);
      return label;
    },
    starting: (label: string, prefix: string = '') => {
      const fullLabel = `${grey(stripColor(prefix))} ${blue('→')} ${cyan(
        label
      )}`;

      log(`Starting   ${fullLabel}...`);
      return fullLabel;
    },
    successful: (label: string, prefix: string = '') => {
      const fullLabel = `${grey(stripColor(prefix))} ${blue('→')} ${cyan(
        label
      )}`;

      log(`Finished   ${fullLabel} ${green('✓')}`);
      return fullLabel;
    }
  }
};

/**
 * Clean the given path.
 *
 * @param path - The path to clean.
 * @param label - The label to show on the console after `clean: `
 * @param labelPrefix - A prefix to print before the label
 */
export function clean(
  path: string,
  label?: string,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = `clean: ${label == null ? path : label}`;

  return new Promise(async (resolve, reject) => {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    try {
      await del(path);
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Returns a new promise that will not resolving or rejecting until all the given
 * promises to finish either resolved or rejected.
 *
 * @param promises - The promises to wait for
 */
export function waitForAllPromises(
  promises: Array<Promise<any>>
): Promise<any[]> {
  return new Promise(async (resolve, reject) => {
    const results = await Promise.all(
      promises.map(async promise => {
        try {
          const value = await promise;
          return { value, status: 0 };
        } catch (error) {
          return { error, status: 1 };
        }
      })
    );

    if (results.filter(result => result.status === 1).length === 0) {
      resolve(results);
    } else {
      reject(new MultiPromiseRejectionError(results));
    }
  });
}

/**
 * Get a new WebpackClosureCompilerPlugin that has been configured.
 *
 */
export function getWebpackPlugIns(): Plugin[] {
  return [
    new PreWebpackClosureCompilerPlugin(),
    new WebpackClosureCompilerPlugin({
      compiler: {
        assume_function_wrapper: true,
        compilation_level: 'SIMPLE',
        language_in: 'ECMASCRIPT_NEXT',
        language_out: 'ECMASCRIPT5',
        output_wrapper: '(function(){%output%}).call(this)'
      }
    })
  ];
}

/**
 * Transform function that returns the contents of the given file.
 *
 * @param filePath - The file path
 * @param file - The file
 */
export function transformGetFileContents(
  filepath: string,
  file?: VinylFile
): string {
  if (file && file.isBuffer()) {
    return file.contents.toString('utf8');
  }
  throw new Error();
}

/**
 * Clean dist folder.
 *
 * @param config
 * @param labelPrefix
 */
export function cleanDist(config: IConfig, labelPrefix?: string) {
  return clean(`./${config.dist.path}`, 'dist', labelPrefix);
}

/**
 * Clean temp folder.
 *
 * @param config
 * @param labelPrefix
 */
export function cleanTemp(config: IConfig, labelPrefix?: string) {
  return clean(`./${config.temp.path}`, 'temp', labelPrefix);
}

/**
 * Clean docs folder.
 *
 * @param config
 * @param labelPrefix
 */
export function cleanDocs(config: IConfig, labelPrefix?: string) {
  return clean(`./${config.docs.path}`, 'docs', labelPrefix);
}

/**
 * A unrecoverable error.
 */
export class UnrecoverableError extends Error {}
