// Libraries.
import { writeFile } from 'fs';
import glob from 'glob';
import GulpClient from 'gulp';
import rename from 'gulp-rename';
import { basename, extname, normalize } from 'path';
import {
  Analyzer,
  FsUrlLoader,
  generateAnalysis as processAnalysis,
  PackageUrlResolver
} from 'polymer-analyzer';
import { Analysis as ProcessedAnalysis } from 'polymer-analyzer/lib/analysis-format/analysis-format';
import { promisify } from 'util';
import { IConfig } from '../default-config';

// Load util.
import { tasks, waitForAllPromises } from './util';

// Promisified functions.
const globPromise = promisify(glob);
const writeFilePromise = promisify(writeFile);

// The temp path.
const tempSubpath = 'analyze';

/**
 * Fix issues with the automatically generated analysis.
 *
 * @param {ProcessedAnalysis} analysis - The generated analysis.
 * @param {IConfig} config - Config settings
 * @returns {Object}
 */
function fixAnalysis(analysis: ProcessedAnalysis, config: IConfig): any {
  const typesToFix = ['elements', 'mixins'];

  for (const type of typesToFix) {
    const typeData = (analysis as any)[type];

    // If the type is defined.
    if (typeData != null) {
      // For each component.
      for (const component of typeData) {
        const base = basename(component.path, extname(component.path));

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
          }/${base}/${base}${config.build.module.extension}`;
        }

        // If `demos` is defined.
        if (component.demos != null) {
          // For each demo.
          for (const demo of component.demos) {
            // Prefix its url.
            demo.url = normalize(`../${base}/${demo.url}`);
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
 * @param {IConfig} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise<void>}
 */
function getElementsForAnalysis(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'get files';

  return new Promise((resolve, reject) => {
    try {
      tasks.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src([
          `./${config.dist.path}/**/*${config.build.module.extension}`,
          `./${config.componenet.nodeModulesPath}/catalyst-*/**/*${
            config.build.module.extension
          }`
        ])
        .pipe(
          rename({
            dirname: '/',
            extname: '.js' // Polymer analyser does not yet support .mjs files so rename to .js
          })
        )
        .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
        .on('finish', () => {
          resolve();
          tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', (error: Error) => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Generate the analysis.
 *
 * @param {IConfig} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise<void>}
 */
function generateAnalysis(
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'generate';

  return new Promise(async (resolve, reject) => {
    try {
      tasks.log.starting(subTaskLabel, labelPrefix);

      const files = await globPromise(
        `./${config.temp.path}/${tempSubpath}/**/*.js`
      );
      const analyzer = new Analyzer({
        urlLoader: new FsUrlLoader('./'),
        urlResolver: new PackageUrlResolver({
          packageDir: './'
        })
      });
      const analysis = await analyzer.analyze(files);
      const formattedAnalysis = processAnalysis(
        analysis,
        analyzer.urlResolver
      );
      const formattedfixedAnalysis = fixAnalysis(formattedAnalysis, config);

      const analysisFileContents = JSON.stringify(
        formattedfixedAnalysis,
        null,
        2
      );
      const minifiedAnalysisFileContents = JSON.stringify(
        formattedfixedAnalysis
      );

      await waitForAllPromises([
        writeFilePromise(`./`, analysisFileContents, { encoding: 'utf8' }),
        writeFilePromise(
          `./${config.docs.path}/${config.docs.analysisFilename}`,
          minifiedAnalysisFileContents,
          { encoding: 'utf8' }
        )
      ]);

      resolve();
      tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Analyze the component.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {IConfig} config - Config settings
 * @returns {Promise<void>}
 */
export function analyze(gulp: GulpClient.Gulp, config: IConfig): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      await getElementsForAnalysis(gulp, config);
      await generateAnalysis(config);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}
