// Load util.
const tasksUtil = require('./util');

// Libraries.
const file = require('gulp-file');
const glob = require('glob');
const path = require('path');
const polymerAnalyzer = require('polymer-analyzer');
const rename = require('gulp-rename');
const util = require('util');

// Promisified functions.
const globPromise = util.promisify(glob);

// The temp path.
const tempSubpath = 'analyze';

/**
 * Fix issues with the automatically generated analysis.
 *
 * @param {Object} analysis - The automatically generated analysis.
 * @param {Object} config - Config settings
 * @returns {Object}
 */
function fixAnalysis(analysis, config) {
  const typesToFix = ['elements', 'mixins'];

  for (const type of typesToFix) {
    // If the type is defined.
    if (analysis[type] != null) {
      // For each component.
      for (const component of analysis[type]) {
        const basename = path.basename(
          component.path,
          path.extname(component.path)
        );

        // Don't refer to the component's temp path, but rather its node path.
        if (
          component.path != null &&
          component.path.indexOf(`${config.temp.path}/${tempSubpath}/`) === 0
        ) {
          // Remove temp dir prefix.
          component.path = component.path.substring(
            `${config.temp.path}/${tempSubpath}/`.length
          );

          component.path = `${config.nodeModulesPath}/${
            config.componenet.scope
          }/${basename}/${basename}.mjs`;
        }

        // If `demos` is defined.
        if (component.demos != null) {
          // For each demo.
          for (const demo of component.demos) {
            // Prefix its url.
            demo.url = path.normalize(`../${basename}/${demo.url}`);
          }
        }
      }
    }
  }

  return analysis;
}

/**
 * Copy all the elements over to the temp folder for analysis.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function getElementsForAnalysis(gulp, config, labelPrefix) {
  const subTaskLabel = 'get files ready';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    gulp
      .src([
        `./${config.dist.path}/**/*.mjs`,
        `./${config.componenet.nodeModulesPath}/catalyst-*/**/*.mjs`
      ])
      .pipe(
        rename({
          dirname: '/',
          extname: '.js' // Polymer analyser does not yet support .mjs files so rename to .js
        })
      )
      .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Generate the analysis.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function generateAnalysis(gulp, config, labelPrefix) {
  const subTaskLabel = 'generate';

  return new Promise(async resolve => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    const files = await globPromise(
      `./${config.temp.path}/${tempSubpath}/**/*.js`
    );
    const analyzer = new polymerAnalyzer.Analyzer({
      urlLoader: new polymerAnalyzer.FsUrlLoader('./'),
      urlResolver: new polymerAnalyzer.PackageUrlResolver({ packageDir: './' })
    });
    const analysis = await analyzer.analyze(files);

    const analysisFileContents = JSON.stringify(
      fixAnalysis(
        polymerAnalyzer.generateAnalysis(analysis, analyzer.urlResolver),
        config
      )
    );

    file(config.docs.analysisFilename, analysisFileContents, {
      src: true
    })
      .pipe(gulp.dest('./'))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

// Export the analyze function.
module.exports = (gulp, config) => {
  return new Promise(async resolve => {
    await getElementsForAnalysis(gulp, config);
    await generateAnalysis(gulp, config);
    resolve();
  });
};
