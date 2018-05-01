// Libraries.
import { writeFile } from 'fs/promises';
import _glob from 'glob';
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

import { IConfig } from '../config';
import { tasksHelpers, waitForAllPromises } from '../util';

// Promisified functions.
const glob = promisify(_glob);

// The temp path.
const tempSubpath = 'analyze';

/**
 * Fix issues with the automatically generated analysis.
 *
 * @param analysis - The generated analysis.
 * @param config - Config settings
 */
function fixAnalysis(
  analysis: ProcessedAnalysis,
  config: IConfig
): ProcessedAnalysis {
  const typesToFix = ['elements', 'mixins'];

  for (const typeToFix of typesToFix) {
    const typeData = (analysis as any)[typeToFix];

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
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before
 */
function getElementsForAnalysis(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'get files';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src([
          `./${config.dist.path}/**/*${config.build.module.extension}`,
          `./${config.componenet.nodeModulesPath}/catalyst-*/**/*${
            config.build.module.extension
          }`
        ])
        .pipe(
          // FIXME: Polymer analyser does not yet support .mjs files so rename to .js
          rename({
            dirname: '/',
            extname: '.js'
          })
        )
        .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
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
 * Generate the analysis.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before
 */
function generateAnalysis(
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'generate';

  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        tasksHelpers.log.starting(subTaskLabel, labelPrefix);

        const files = await glob(
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
          writeFile(`./`, analysisFileContents, { encoding: 'utf8' }),
          writeFile(
            `./${config.docs.path}/${config.docs.analysisFilename}`,
            minifiedAnalysisFileContents,
            { encoding: 'utf8' }
          )
        ]);

        resolve();
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

/**
 * Analyze the component.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 */
export function analyze(gulp: GulpClient.Gulp, config: IConfig): Promise<void> {
  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        await getElementsForAnalysis(gulp, config);
        await generateAnalysis(config);
        resolve();
      } catch (error) {
        reject(error);
      }
    }
  );
}
