// Libraries.
import { blue, cyan, green, grey, magenta, red } from 'ansi-colors';
import del from 'del';
import escapeStringRegexp from 'escape-string-regexp';
import exec from 'exec-chainable';
import log from 'fancy-log';
import nodeGlob from 'glob';
import stripColor from 'strip-color';
import { promisify } from 'util';
import { Plugin } from 'webpack';
import WebpackClosureCompilerPlugin from 'webpack-closure-compiler';

import { MultiPromiseRejectionError } from './classes/MultiPromiseRejectionError';
import { PreWebpackClosureCompilerPlugin } from './classes/PreWebpackClosureCompilerPlugin';
import { IConfig } from './config';

// Promisified functions.
const nodeGlobPromise = promisify(nodeGlob);

/**
 * Get the full formatted prefix.
 */
function getFullFormattedPrefix(prefixes: ReadonlyArray<string>): string {
  return prefixes.reduce((previous, current) => {
    if (previous === '') {
      return grey(stripColor(current));
    }
    return `${previous} ${grey(`'→ ${stripColor(current)}`)}`;
  }, '');
}

/**
 * Helper functions for tasks.
 */
export const tasksHelpers = {
  log: {
    // See: https://github.com/jonaskello/tslint-immutable/issues/73
    // tslint:disable-next-line:readonly-array
    failed: (label: string, ...prefixes: string[]) => {
      const fullLabel = `${getFullFormattedPrefix(prefixes)} ${blue(
        '→'
      )} ${cyan(label)}`;
      log(`Failed    ${fullLabel} ${red('✗')}`);

      return fullLabel;
    },

    // See: https://github.com/jonaskello/tslint-immutable/issues/73
    // tslint:disable-next-line:readonly-array
    info: (label: string, ...prefixes: string[]) => {
      const fullLabel = `${getFullFormattedPrefix(prefixes)} ${blue(
        '→'
      )} ${magenta(label)}`;
      log(`Info      ${fullLabel}`);

      return label;
    },

    // See: https://github.com/jonaskello/tslint-immutable/issues/73
    // tslint:disable-next-line:readonly-array
    starting: (label: string, ...prefixes: string[]) => {
      const fullLabel = `${getFullFormattedPrefix(prefixes)} ${blue(
        '→'
      )} ${cyan(label)}`;
      log(`Starting  ${fullLabel}...`);

      return fullLabel;
    },

    // See: https://github.com/jonaskello/tslint-immutable/issues/73
    // tslint:disable-next-line:readonly-array
    successful: (label: string, ...prefixes: string[]) => {
      const fullLabel = `${getFullFormattedPrefix(prefixes)} ${blue(
        '→'
      )} ${cyan(label)}`;
      log(`Finished  ${fullLabel} ${green('✓')}`);

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
export async function clean(
  path: string,
  label: string = path,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = `clean: ${label}`;

  tasksHelpers.log.starting(subTaskLabel, labelPrefix);

  try {
    await del(path);
    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Returns a new promise that will not resolving or rejecting until all the given
 * promises have either resolved or rejected.
 *
 * @param promises - The promises to wait for
 */
export async function runAllPromises<T>(
  promises: ReadonlyArray<Promise<T>>
): Promise<ReadonlyArray<T>> {
  const promiseResults: ReadonlyArray<
    { readonly value: T } | { readonly error: Error }
  > = await Promise.all(
    promises.map(async (promise: Promise<T>) => {
      try {
        const value = await promise;

        return { value };
      } catch (error) {
        return { error };
      }
    })
  );

  return promiseResults.reduce((reducedValues: ReadonlyArray<T>, result) => {
    if ((result as any).error != null) {
      throw new MultiPromiseRejectionError<T>(promiseResults);
    }
    return [...reducedValues, (result as { readonly value: T }).value];
  }, []);
}

/**
 * Get the webpack plugins.
 */
// tslint:disable-next-line:readonly-array
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
 * Clean dist folder.
 */
export async function cleanDist(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  await clean(`./${config.dist.path}`, 'dist', labelPrefix);
}

/**
 * Clean temp folder.
 */
export async function cleanTemp(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  await clean(`./${config.temp.path}`, 'temp', labelPrefix);
}

/**
 * Clean docs folder.
 */
export async function cleanDocs(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  await clean(`./${config.docs.path}`, 'docs', labelPrefix);
}

/**
 * Glob matching with support for multiple patterns.
 */
export async function glob(
  pattern: string | ReadonlyArray<string>,
  options?: nodeGlob.IOptions

  // tslint:disable-next-line:readonly-array
): Promise<string[]> {
  if (Array.isArray(pattern)) {
    if (pattern.length === 0) {
      throw new Error('No glob patterns given.');
    }
    if (pattern.length === 1) {
      return nodeGlobPromise(pattern[0], options);
    }
    return nodeGlobPromise(`{${pattern.join(',')}}`, options);
  }
  return nodeGlobPromise(pattern as string, options);
}

/**
 * Transpose a 2D-array (flip diagonally).
 */
export function transpose<T>(
  array: ReadonlyArray<ReadonlyArray<T>>

  // tslint:disable-next-line:readonly-array
): T[][] {
  if (array.length === 0) {
    return [];
  }
  return array[0].map((_, index) => array.map(row => row[index]));
}

/**
 * Get the regexp to select all the text in an injection placeholder.
 */
export function getInjectRegExp(keyword: string): RegExp {
  return new RegExp(
    `${escapeStringRegexp(`[[inject:${keyword}]]`)}[\s\S]*?${escapeStringRegexp(
      `[[endinject]]`
    )}`,
    'g'
  );
}

/**
 * Run a command on the command line.
 */
export async function runCommand(command: string): Promise<string> {
  return (await exec(command)).replace(/\n$/, '');
}
