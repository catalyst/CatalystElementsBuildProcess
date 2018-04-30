// Libraries.
import GulpClient from 'gulp';
import eslint from 'gulp-eslint';
import htmlExtract from 'gulp-html-extract';
import sassLint from 'gulp-sass-lint';

import { IConfig } from '../config';
import { tasksHelpers, waitForAllPromises } from '../util';

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
): Promise<any> {
  const subTaskLabel = 'JS files';

  return new Promise((resolve, reject) => {
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
): Promise<any> {
  const subTaskLabel = 'JS in HTML files';

  return new Promise((resolve, reject) => {
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
): Promise<any> {
  const subTaskLabel = 'SASS files';

  return new Promise((resolve, reject) => {
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
  return new Promise(async (resolve, reject) => {
    try {
      await waitForAllPromises([
        lintJS(gulp, config),
        lintJSinHTML(gulp, config),
        lintSASS(gulp, config)
      ]);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}
