// Libraries.
const colors = require('ansi-colors');
const file = require('gulp-file');
const glob = require('glob');
const log = require('fancy-log');
const nodeUtil = require('util');
const path = require('path');
const polymerAnalyzer = require('polymer-analyzer');
const rename = require('gulp-rename');

// Promisify functions.
const globPromise = nodeUtil.promisify(glob);

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
    if (analysis[type]) {
      // For each component.
      for (const component of analysis[type]) {
        // Don't refer to the component's temp path, but rather its node path.
        if (
          component.path &&
          component.path.indexOf(`${config.temp.path}/analyze/`) === 0
        ) {
          // Remove temp dir prefix.
          component.path = component.path.substring(
            `${config.temp.path}/analyze/`.length
          );

          // Not for this component? Change the dir.
          const basename = path.basename(component.path, '.js');
          component.path = `node_modules/${
            config.componenet.scope
          }/${basename}/${component.path}`;
        }

        // If `demos` is defined.
        if (component.demos) {
          // For each demo.
          for (const demo of component.demos) {
            // Prefix its url.
            demo.url = `../${component.tagname}/${demo.url}`;
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
 * @returns {Promise}
 */
function getElementsForAnalysis(gulp, config) {
  const subTaskLabel = `'${colors.cyan('analyze -> get files ready')}'`;

  return new Promise(resolve => {
    log(`Starting ${subTaskLabel}...`);

    gulp
      .src([
        `./${config.dist.path}/**/*.js`,
        `./${config.componenet.nodeModulesPath}/catalyst-*/**/*.js`,
        '!**/*.min*'
      ])
      .pipe(
        rename({
          dirname: '/'
        })
      )
      .pipe(gulp.dest(`./${config.temp.path}/analyze`))
      .on('finish', () => {
        log(`Finished ${subTaskLabel}`);
        resolve();
      });
  });
}

/**
 * Generate the analysis.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @returns {Promise}
 */
function generateAnalysis(gulp, config) {
  const subTaskLabel = `'${colors.cyan('analyze -> generate')}'`;

  return new Promise(async resolve => {
    log(`Starting ${subTaskLabel}...`);

    const files = await globPromise(`./${config.temp.path}/analyze/**/*.js`);
    const analyzer = polymerAnalyzer.Analyzer.createForDirectory('./');
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
        log(`Finished ${subTaskLabel}`);
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
