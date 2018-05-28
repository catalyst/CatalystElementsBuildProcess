// Libraries.
import { blue, cyan, green, grey, magenta, red } from 'ansi-colors';
import del from 'del';
import escapeStringRegexp from 'escape-string-regexp';
import exec from 'exec-chainable';
import log from 'fancy-log';
import {
  access as _access,
  createReadStream,
  createWriteStream,
  existsSync,
  lstat as _lstat,
  mkdir as _mkdir,
  writeFile as _nodeWriteFile
} from 'fs';
import nodeGlob from 'glob';
import { dirname, join as joinPath, sep as pathSeperator } from 'path';
import promisePipe from 'promisepipe';
import stripColor from 'strip-color';
import { promisify } from 'util';
import { Plugin } from 'webpack';
import WebpackClosureCompilerPlugin from 'webpack-closure-compiler';

import { MultiPromiseRejectionError } from './classes/MultiPromiseRejectionError';
import { PreWebpackClosureCompilerPlugin } from './classes/PreWebpackClosureCompilerPlugin';
import { IConfig } from './config';

// Promisified functions.
const access = promisify(_access);
const lstat = promisify(_lstat);
const mkdir = promisify(_mkdir);
const nodeWriteFile = promisify(_nodeWriteFile);
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

  return promiseResults.reduce(
    (previous, current) => {
      if ((current as any).error != null) {
        throw new MultiPromiseRejectionError<T>(promiseResults);
      }
      return [...previous, (current as { readonly value: T }).value];
    },
    [] as ReadonlyArray<T>
  );
}

/**
 * Get a new WebpackClosureCompilerPlugin that has been configured.
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

/**
 * Create the given directory (and parent directories if needed).
 */
export async function mkdirp(dirPath: string): Promise<void> {
  const parts = dirPath.split(pathSeperator);
  await Promise.all(
    parts.map(async (_, i) => {
      const subPath = joinPath(...parts.slice(0, i + 1));

      if (!existsSync(subPath)) {
        // tslint:disable-next-line:no-magic-numbers
        mkdir(subPath, 0o777);
      }
    })
  );
}

/**
 * Write a file to disk. If the directory doesn't exist, create it first.
 */
export async function writeFile(
  path: string,
  data: any,
  options?:
    | string
    | {
        readonly encoding?: string | null | undefined;
        readonly mode?: string | number | undefined;
        readonly flag?: string | undefined;
      }
    | null
    | undefined
): Promise<void> {
  const dir = dirname(path);
  if (!(dir === '.' || dir.search(/^\.\.\/.*/) === 0)) {
    await mkdirp(dir);
  }
  return nodeWriteFile(path, data, options);
}

/**
 * Copy a file on disk. If the directory doesn't exist, create it first.
 */
export async function copyFile(src: string, dest: string): Promise<void> {
  const dir = dirname(dest);

  if (!(await lstat(src)).isFile()) {
    throw new InvalidFilePathError();
  }
  await access(src);

  if (!(dir === '.' || dir.search(/^\.\.\/.*/) === 0)) {
    await mkdirp(dir);
  }

  return promisePipe(createReadStream(src), createWriteStream(dest));
}

export class InvalidFilePathError extends Error {
  public constructor() {
    super('Invalid file given.');
  }
}
