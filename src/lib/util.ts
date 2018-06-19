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

// tslint:disable:max-line-length
export async function runTask(taskFunction: (lp: string) => Promise<void>, taskParameters: Array<never>, taskLabel: string, taskLabelPrefix: string): Promise<void>;
export async function runTask<T1>(taskFunction: (lp: string, p1: T1) => Promise<void>, taskParameters: [T1], taskLabel: string, taskLabelPrefix: string): Promise<void>;
export async function runTask<T1, T2>(taskFunction: (lp: string, p1: T1, p2: T2) => Promise<void>, taskParameters: [T1, T2], taskLabel: string, taskLabelPrefix: string): Promise<void>;
export async function runTask<T1, T2, T3>(taskFunction: (lp: string, p1: T1, p2: T2, p3: T3) => Promise<void>, taskParameters: [T1, T2, T3], taskLabel: string, taskLabelPrefix: string): Promise<void>;
export async function runTask<T1, T2, T3, T4>(taskFunction: (lp: string, p1: T1, p2: T2, p3: T3, p4: T4) => Promise<void>, taskParameters: [T1, T2, T3, T4], taskLabel: string, taskLabelPrefix: string): Promise<void>;
export async function runTask<T1, T2, T3, T4, T5>(taskFunction: (lp: string, p1: T1, p2: T2, p3: T3, p4: T4, p5: T5) => Promise<void>, taskParameters: [T1, T2, T3, T4, T5], taskLabel: string, taskLabelPrefix: string): Promise<void>;
export async function runTask<T1, T2, T3, T4, T5, T6>(taskFunction: (lp: string, p1: T1, p2: T2, p3: T3, p4: T4, p5: T5, p6: T6) => Promise<void>, taskParameters: [T1, T2, T3, T4, T5, T6], taskLabel: string, taskLabelPrefix: string): Promise<void>;
export async function runTask<T1, T2, T3, T4, T5, T6, T7>(taskFunction: (lp: string, p1: T1, p2: T2, p3: T3, p4: T4, p5: T5, p6: T6, p7: T7) => Promise<void>, taskParameters: [T1, T2, T3, T4, T5, T6, T7], taskLabel: string, taskLabelPrefix: string): Promise<void>;
export async function runTask<T1, T2, T3, T4, T5, T6, T7, T8>(taskFunction: (lp: string, p1: T1, p2: T2, p3: T3, p4: T4, p5: T5, p6: T6, p7: T7, p8: T8) => Promise<void>, taskParameters: [T1, T2, T3, T4, T5, T6, T7, T8], taskLabel: string, taskLabelPrefix: string): Promise<void>;
export async function runTask<T1, T2, T3, T4, T5, T6, T7, T8, T9>(taskFunction: (lp: string, p1: T1, p2: T2, p3: T3, p4: T4, p5: T5, p6: T6, p7: T7, p8: T8, p9: T9) => Promise<void>, taskParameters: [T1, T2, T3, T4, T5, T6, T7, T8, T9], taskLabel: string, taskLabelPrefix: string): Promise<void>;
export async function runTask<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10>(taskFunction: (lp: string, p1: T1, p2: T2, p3: T3, p4: T4, p5: T5, p6: T6, p7: T7, p8: T8, p9: T9, p10: T10) => Promise<void>, taskParameters: [T1, T2, T3, T4, T5, T6, T7, T8, T9, T10], taskLabel: string, taskLabelPrefix: string): Promise<void>;
// tslint:enable:max-line-length

/**
 * Run a given function as a task.
 */
export async function runTask<T>(
  task: (labelPrefix: string, ...params: Array<T>) => Promise<void>,
  taskParameters: Array<T>,
  taskLabel: string,
  taskLabelPrefix: string
): Promise<void> {
  const subTaskLabelPrefix = logTaskStarting(taskLabel, taskLabelPrefix);

  return task(subTaskLabelPrefix, ...taskParameters)
    .then(() => {
      logTaskSuccessful(taskLabel, taskLabelPrefix);
    })
    .catch((error) => {
      logTaskFailed(taskLabel, taskLabelPrefix);
      return Promise.reject(error);
    });
}

/**
 * Returns a new promise that will not resolving or rejecting until all the given
 * promises have either resolved or rejected.
 *
 * @param promises - The promises to wait for
 */
export async function runTasksParallel<T>(
  promises: ReadonlyArray<Promise<T>>
): Promise<Array<T>> {
  interface ISuccessResult<U> {
    readonly value: U;
  }

  interface IErrorResult {
    readonly error: Error;
  }

  const promiseResults: ReadonlyArray<ISuccessResult<T> | IErrorResult> =
    await Promise.all(
      promises.map(async (promise: Promise<T>) => {
        try {
          const value = await promise;

          return { value };
        } catch (error) {
          return { error };
        }
      })
    );

  const reducedResults = promiseResults.reduce<Array<T> | MultiPromiseRejectionError<T>>(
    (reducedValues, result) => {
      return (
        reducedValues instanceof Error
        ? reducedValues
        : (result as ISuccessResult<T> & IErrorResult).error != undefined
        ? new MultiPromiseRejectionError<T>(promiseResults)
        : [...reducedValues, (result as ISuccessResult<T>).value]
      );
    },
    []
  );

  return (
    reducedResults instanceof Error
      ? Promise.reject(reducedResults)
      : reducedResults
  );
}

export function skipTask(
  subTaskLabel: string,
  labelPrefix: string,
  message?: string
): void {
  logTaskSkipped(message, subTaskLabel, labelPrefix);
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

  await Promise.all(
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
 * Log info from a task message.
 */
function logTaskInfo(message: string, ...prefixes: Array<string>): string {
  const fullLabel =
    `${getFullFormattedPrefix(prefixes)} ${blue('→')} ${magenta(message)}`;
  log(`Info      ${fullLabel}`);

  return message;
}

/**
 * Log that a task has started.
 */
function logTaskStarting(
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
function logTaskSuccessful(
  label: string,
  ...prefixes: Array<string>
): string {
  const fullLabel =
    `${getFullFormattedPrefix(prefixes)} ${blue('→')} ${cyan(label)}`;
  log(`Finished  ${fullLabel} ${green('✓')}`);

  return fullLabel;
}

/**
 * Log a task failed.
 */
function logTaskFailed(
  label: string,
  ...prefixes: Array<string>
): string {
  const fullLabel =
    `${getFullFormattedPrefix(prefixes)} ${blue('→')} ${cyan(label)}`;
  log(`Failed    ${fullLabel} ${red('✗')}`);

  return fullLabel;
}

/**
 * Log that a task was skipped.
 */
function logTaskSkipped(
  message: string | undefined,
  label: string,
  ...prefixes: Array<string>
): string {
  const fullLabel =
    `${getFullFormattedPrefix(prefixes)} ${blue('→')} ${cyan(label)}`;

  const formattedMessage =
    message === undefined
      ? ''
      : ` - ${magenta(message)}`;

  log(`Skipping  ${fullLabel}${formattedMessage}`);

  return fullLabel;
}

/**
 * Get the full formatted prefix.
 */
function getFullFormattedPrefix(prefixes: ReadonlyArray<string>): string {
  return prefixes.reduce((previous, current) => {
    return (
      previous === ''
        ? grey(stripColor(current))
        : `${previous} ${grey('→ ' + stripColor(current))}`
    );
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
  return (
    Array.isArray(pattern)
      ? globArray(pattern)
      : globString(pattern as string)
  );
}

async function globString(
  pattern: string,
  options?: nodeGlob.IOptions
): Promise<Array<string>> {
  return nodeGlobPromise(pattern, options);
}

async function globArray(
  pattern: ReadonlyArray<string>,
  options?: nodeGlob.IOptions
): Promise<Array<string>> {
  return (
    pattern.length === 0
      ? Promise.reject(new Error('No glob patterns given.'))
      : pattern.length === 1
        ? nodeGlobPromise(pattern[0], options)
        : nodeGlobPromise(`{${pattern.join(',')}}`, options)
  );
}

/**
 * Transpose a 2D-array (flip diagonally).
 */
export function transpose<T>(
  array: ReadonlyArray<ReadonlyArray<T>>
): Array<Array<T>> {
  return (
    array.length === 0
      ? []
      : array[0].map((_, index) => array.map((row) => row[index]))
  );
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
