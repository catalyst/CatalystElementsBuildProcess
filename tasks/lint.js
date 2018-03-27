// Libraries.
const colors = require('ansi-colors');
const eslint = require('gulp-eslint');
const htmlExtract = require('gulp-html-extract');
const log = require('fancy-log');
const sassLint = require('gulp-sass-lint');

/**
 * Lint JS.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @returns {Promise}
 */
function lintJS(gulp, config) {
  const subTaskLabel = `'${colors.cyan('lint -> JS files')}'`;

  return new Promise(resolve => {
    log(`Starting ${subTaskLabel}...`);
    gulp
      .src([
        './*.js',
        `./${config.src.path}/**/*.js`,
        `./${config.tests.path}/**/*.js`,
        `./${config.demos.path}/**/*.js`
      ])
      .pipe(eslint())
      .pipe(eslint.format())
      .pipe(eslint.failOnError())
      .on('finish', () => {
        log(`Finished ${subTaskLabel}`);
        resolve();
      });
  });
}

/**
 * Lint JS in HTML.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @returns {Promise}
 */
function lintJSinHTML(gulp, config) {
  const subTaskLabel = `'${colors.cyan('lint -> JS in HTML files')}'`;

  return new Promise(resolve => {
    log(`Starting ${subTaskLabel}...`);
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
        log(`Finished ${subTaskLabel}`);
        resolve();
      });
  });
}

/**
 * Lint SASS.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @returns {Promise}
 */
function lintSASS(gulp, config) {
  const subTaskLabel = `'${colors.cyan('lint -> SASS files')}'`;

  return new Promise(resolve => {
    log(`Starting ${subTaskLabel}...`);
    gulp
      .src(`./${config.src.path}/**/*.scss`)
      .pipe(sassLint())
      .pipe(sassLint.format())
      .pipe(sassLint.failOnError())
      .on('finish', () => {
        log(`Finished ${subTaskLabel}`);
        resolve();
      });
  });
}

// Export the lint function.
module.exports = (gulp, config) => {
  return new Promise(async resolve => {
    await Promise.all([
      lintJS(gulp, config),
      lintJSinHTML(gulp, config),
      lintSASS(gulp, config)
    ]);
    resolve();
  });
};
