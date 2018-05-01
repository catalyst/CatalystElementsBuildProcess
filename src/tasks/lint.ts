// Libraries.
import GulpClient from 'gulp';
import eslint from 'gulp-eslint';
import htmlExtract from 'gulp-html-extract';
import sassLint from 'gulp-sass-lint';
import tslint from 'gulp-tslint';
import { Linter } from 'tslint';

import { IConfig } from '../config';
import { tasksHelpers, waitForAllPromises } from '../util';

/**
 * Lint TS.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function lintTS(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'TS files';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);
      const tsLintProgram = Linter.createProgram('./tsconfig.json');

      gulp
        .src([
          './*.ts',
          `./${config.src.path}/**/*.ts`,
          `./${config.tests.path}/**/*.ts`,
          `./${config.demos.path}/**/*.ts`
        ])
        .pipe(
          tslint({
            program: tsLintProgram
          })
        )
        .pipe(
          tslint.report({
            allowWarnings: true
          })
        )
        .on('finish', () => {
          resolve();
          tasksHelpers.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', (error: Error) => {
          if (error.message.startsWith('Failed to lint:')) {
            error.message = 'TS lint failed.';
          }
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Lint JS.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function lintJS(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel: string = 'JS files';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src([
          './*.?(m)js',
          `./${config.src.path}/**/*.?(m)js`,
          `./${config.tests.path}/**/*.?(m)js`,
          `./${config.demos.path}/**/*.?(m)js`,
          '!*.min.*'
        ])
        .pipe(eslint())
        .pipe(eslint.format())
        .pipe(eslint.failOnError())
        .on('finish', () => {
          resolve();
          tasksHelpers.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', (error: Error) => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Lint JS in HTML.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function lintJSinHTML(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'JS in HTML files';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src([
          './*.html',
          `./${config.src.path}/**/*.html`,
          `./${config.tests.path}/**/*.html`,
          `./${config.demos.path}/**/*.html`
        ])
        .pipe(
          htmlExtract({
            sel: 'script',
            strip: true
          })
        )
        .pipe(eslint())
        .pipe(eslint.format())
        .pipe(eslint.failOnError())
        .on('finish', () => {
          resolve();
          tasksHelpers.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', (error: Error) => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Lint SASS.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function lintSASS(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'SASS files';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(`./${config.src.path}/**/*.scss`)
        .pipe(sassLint())
        .pipe(sassLint.format())
        .pipe(sassLint.failOnError())
        .on('finish', () => {
          resolve();
          tasksHelpers.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', (error: Error) => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Lint the code.
 *
 * @param ulp - Gulp library
 * @param config - Config settings
 */
export function lint(gulp: GulpClient.Gulp, config: IConfig): Promise<void> {
  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        await waitForAllPromises([
          lintTS(gulp, config),
          lintJS(gulp, config),
          lintJSinHTML(gulp, config),
          lintSASS(gulp, config)
        ]);
        resolve();
      } catch (error) {
        reject(error);
      }
    }
  );
}
