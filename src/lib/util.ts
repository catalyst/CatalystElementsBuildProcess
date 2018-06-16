// tslint:disable:max-classes-per-file

// Libraries.
import { blue, cyan, green, grey, magenta, red } from 'ansi-colors';
import del from 'del';
import escapeStringRegexp from 'escape-string-regexp';
import exec from 'exec-chainable';
import log from 'fancy-log';
import { ensureDir, readFile, writeFile } from 'fs-extra';
import nodeGlob from 'glob';
import { dirname as getDirName } from 'path';
import stripColor from 'strip-color';
import { promisify } from 'util';
import { Plugin } from 'webpack';
import WebpackClosureCompilerPlugin from 'webpack-closure-compiler';

import { MultiPromiseRejectionError } from './classes/MultiPromiseRejectionError';
import { PreWebpackClosureCompilerPlugin } from './classes/PreWebpackClosureCompilerPlugin';
import { IConfig } from './config';

// Promisified functions.
const nodeGlobPromise = promisify(nodeGlob);

export type WebpackResult = Array<{
  readonly log: string;
  readonly webpackEmittedFiles: Array<string>;
}>;

export interface INodePackage {
  // tslint:disable-next-line:no-any
  readonly [key: string]: any;
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
 * Process the files webpack output.
 */
export async function webpackPostProcess(
  webpackResults: WebpackResult
): Promise<void> {
  const outFiles = webpackResults.reduce(
    (reducedFiles: ReadonlyArray<string>, result) => {
      console.info(result.log);
      return [...reducedFiles, ...result.webpackEmittedFiles];
    },
    []
  );

  await runAllPromises(
    outFiles.map(async (file) => {
      const fileContent = await readFile(file, {
        encoding: 'utf8',
        flag: 'r'
      });
      const updatedFileContent = fileContent.replace(/\\\\\$/g, '$');
      await ensureDir(getDirName(file));
      await writeFile(file, updatedFileContent);
    })
  );
}

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

  logTaskStarting(subTaskLabel, labelPrefix);

  try {
    await del(path);
    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
): Promise<Array<T>> {
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

  return promiseResults.reduce<Array<T>>((reducedValues, result) => {
    // tslint:disable-next-line:no-any
    if ((result as any).error != undefined) {
      throw new MultiPromiseRejectionError<T>(promiseResults);
    }
    return [...reducedValues, (result as { readonly value: T }).value];
  }, []);
}

/**
 * Log a task failed.
 */
export function logTaskFailed(
  label: string,
  ...prefixes: Array<string>
): string {
  const fullLabel =
    `${getFullFormattedPrefix(prefixes)} ${blue('→')} ${cyan(label)}`;
  log(`Failed    ${fullLabel} ${red('✗')}`);

  return fullLabel;
}

/**
 * Log info from a task message.
 */
export function logTaskInfo(label: string, ...prefixes: Array<string>): string {
  const fullLabel =
    `${getFullFormattedPrefix(prefixes)} ${blue('→')} ${magenta(label)}`;
  log(`Info      ${fullLabel}`);

  return label;
}

/**
 * Log that a task has started.
 */
export function logTaskStarting(
  label: string,
  ...prefixes: Array<string>
): string {
  const fullLabel =
    `${getFullFormattedPrefix(prefixes)} ${blue('→')} ${cyan(label)}`;
  log(`Starting  ${fullLabel}...`);

  return fullLabel;
}

/**
 * Log a that a task finished successfully.
 */
export function logTaskSuccessful(
  label: string,
  ...prefixes: Array<string>
): string {
  const fullLabel =
    `${getFullFormattedPrefix(prefixes)} ${blue('→')} ${cyan(label)}`;
  log(`Finished  ${fullLabel} ${green('✓')}`);

  return fullLabel;
}

/**
 * Get the full formatted prefix.
 */
function getFullFormattedPrefix(prefixes: ReadonlyArray<string>): string {
  return prefixes.reduce((previous, current) => {
    if (previous === '') {
      return grey(stripColor(current));
    }
    const formattedCurrent = grey(`'→ ${stripColor(current)}`);
    return `${previous} ${formattedCurrent}`;
  }, '');
}

/**
 * Get the webpack plugins.
 */
export function getWebpackPlugIns(): Array<Plugin> {
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
 * Glob matching with support for multiple patterns.
 */
export async function glob(
  pattern: string | ReadonlyArray<string>,
  options?: nodeGlob.IOptions
): Promise<Array<string>> {
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
): Array<Array<T>> {
  if (array.length === 0) {
    return [];
  }
  return array[0].map((_, index) => array.map((row) => row[index]));
}

/**
 * Get the regexp to select all the text in an injection placeholder.
 */
export function getInjectRegExp(keyword: string): RegExp {
  const injectStart = escapeStringRegexp(`[[inject:${keyword}]]`);
  const injectEnd = escapeStringRegexp(`[[endinject]]`);

  return new RegExp(`${injectStart}[\s\S]*?${injectEnd}`, 'g');
}

/**
 * Run a command on the command line.
 */
export async function runCommand(command: string): Promise<string> {
  return (await exec(command)).replace(/\n$/, '');
}

/**
 * An error caused by something external.
 */
export class ExternalError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

/**
 * An error caused by an invalid config.
 */
export class ConfigError extends ExternalError {
  public constructor(message: string) {
    super(message);
  }
}

/**
 * An error caused by something external.
 */
export class UncertainEntryFileError extends Error {
  public constructor() {
    super('Cannot determin entry file.');
  }
}
