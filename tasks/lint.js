// Load util.
const tasksUtil = require('./util');

// Libraries.
const eslint = require('gulp-eslint');
const htmlExtract = require('gulp-html-extract');
const sassLint = require('gulp-sass-lint');

/**
 * Lint JS.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function lintJS(gulp, config, labelPrefix) {
  const subTaskLabel = 'JS files';

  return new Promise((resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

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
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      })
      .on('error', error => {
        tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
        reject(error);
      });
  });
}

/**
 * Lint JS in HTML.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function lintJSinHTML(gulp, config, labelPrefix) {
  const subTaskLabel = 'JS in HTML files';

  return new Promise((resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
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
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
          resolve();
        })
        .on('error', error => {
          tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
          reject(error);
        });
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Lint SASS.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function lintSASS(gulp, config, labelPrefix) {
  const subTaskLabel = 'SASS files';

  return new Promise((resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      gulp
        .src(`./${config.src.path}/**/*.scss`)
        .pipe(sassLint())
        .pipe(sassLint.format())
        .pipe(sassLint.failOnError())
        .on('finish', () => {
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
          resolve();
        })
        .on('error', error => {
          tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
          reject(error);
        });
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

// Export the lint function.
module.exports = (gulp, config) => {
  return new Promise(async (resolve, reject) => {
    try {
      await Promise.all([
        lintJS(gulp, config),
        lintJSinHTML(gulp, config),
        lintSASS(gulp, config)
      ]);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
};
