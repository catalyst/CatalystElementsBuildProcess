// Libraries.
import { copyFile as _copyFile, writeFile as _writeFile } from 'fs';
import {
  basename as getFileBasename,
  extname as getFileExtension,
  normalize as normalizePath
} from 'path';
import {
  Analyzer,
  FsUrlLoader,
  generateAnalysis as processAnalysis,
  PackageUrlResolver
} from 'polymer-analyzer';
import {
  Analysis as ProcessedAnalysis,
  Class,
  Demo,
  Element,
  ElementMixin,
  Namespace
} from 'polymer-analyzer/lib/analysis-format/analysis-format';
import { promisify } from 'util';

import { IConfig } from '../config';
import { glob, runAllPromises, tasksHelpers } from '../util';

// Promisified functions.
const copyFile = promisify(_copyFile);
const writeFile = promisify(_writeFile);

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
  return {
    ...analysis,
    ...{
      elements: fixAnalysisElements(analysis.elements, config),
      mixins: fixAnalysisElementMixins(analysis.mixins, config),
      namespaces: fixAnalysisNamespaces(analysis.namespaces, config),
      classes: fixAnalysisClasses(analysis.classes, config)
    }
  } as ProcessedAnalysis;
}

/**
 * Fix the elements in the analysis.
 */
function fixAnalysisElements(
  elements: ReadonlyArray<Element> | undefined,
  config: IConfig
  // tslint:disable-next-line:readonly-array
): Element[] | undefined {
  if (elements === undefined) {
    return undefined;
  }

  return elements.map(element => {
    return {
      ...element,
      paths: fixAnalysisComponentPath(element, config),
      demos: fixAnalysisComponentDemos(element)
    };
  });
}

/**
 * Fix the mixins in the analysis.
 */
function fixAnalysisElementMixins(
  elementMixins: ReadonlyArray<ElementMixin> | undefined,
  config: IConfig
  // tslint:disable-next-line:readonly-array
): ElementMixin[] | undefined {
  if (elementMixins === undefined) {
    return undefined;
  }

  return elementMixins.map(mixin => {
    return {
      ...mixin,
      paths: fixAnalysisComponentPath(mixin, config),
      demos: fixAnalysisComponentDemos(mixin)
    };
  });
}

/**
 * Fix the namespaces in the analysis.
 */
function fixAnalysisNamespaces(
  namespaces: ReadonlyArray<Namespace> | undefined,
  config: IConfig
  // tslint:disable-next-line:readonly-array
): Namespace[] | undefined {
  if (namespaces === undefined) {
    return undefined;
  }

  return namespaces.map(namespace => {
    return {
      ...namespace,
      elements: fixAnalysisElements(namespace.elements, config),
      mixins: fixAnalysisElementMixins(namespace.mixins, config),
      classes: fixAnalysisClasses(namespace.classes, config)
    };
  });
}

/**
 * Fix the classes in the analysis.
 */
function fixAnalysisClasses(
  classes: ReadonlyArray<Class> | undefined,
  config: IConfig
  // tslint:disable-next-line:readonly-array
): Class[] | undefined {
  if (classes === undefined) {
    return undefined;
  }

  return classes.map(classComponent => {
    return {
      ...classComponent,
      paths: fixAnalysisComponentPath(classComponent, config),
      demos: fixAnalysisComponentDemos(classComponent)
    };
  });
}

/**
 * Don't refer to the file's temp path, but rather its node path.
 */
function fixAnalysisComponentPath(
  component: Class,
  config: IConfig
): string | undefined {
  if (component.path === undefined) {
    return component.path;
  }

  const pathBase = getFileBasename(
    component.path,
    getFileExtension(component.path)
  );

  return component.path.indexOf(`${config.temp.path}/${tempSubpath}/`) !== 0
    ? component.path
    : `${config.nodeModulesPath}/${
        config.componenet.scope
      }/${pathBase}/${pathBase}${config.build.module.extension}`;
}

/**
 * Prefix the demos' url.
 */
function fixAnalysisComponentDemos(
  component: Class
  // tslint:disable-next-line:readonly-array
): Demo[] {
  // No path? Don't change anything.
  if (component.path === undefined) {
    return component.demos;
  }

  const pathBase = getFileBasename(
    component.path,
    getFileExtension(component.path)
  );

  return component.demos.map(demo => {
    return {
      ...demo,
      url: normalizePath(`../${pathBase}/${demo.url}`)
    };
  });
}

/**
 * Copy all the elements over to the temp folder for analysis.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before
 */
async function copyElementsForAnalysis(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'get files';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const filepaths = await glob([
      `./${config.dist.path}/**/*${config.build.module.extension}`,
      `./${config.componenet.nodeModulesPath}/catalyst-*/**/*${
        config.build.module.extension
      }`
    ]);

    await Promise.all(
      filepaths.map(async filepath => {
        // Polymer analyser currently only support .js files.
        const ext = config.build.module.extension.substring(
          config.build.module.extension.lastIndexOf('.')
        );
        const outpath = `./${config.temp.path}/${tempSubpath}/${getFileBasename(
          filepath,
          ext
        )}.js`;

        await copyFile(filepath, outpath);
      })
    );
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Generate the analysis.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before
 */
async function generateAnalysis(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'generate';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const files = await glob(`./${config.temp.path}/${tempSubpath}/**/*.js`);
    const analyzer = new Analyzer({
      urlLoader: new FsUrlLoader('./'),
      urlResolver: new PackageUrlResolver({
        packageDir: './'
      })
    });
    // tslint:disable-next-line:readonly-array
    const analysis = await analyzer.analyze(files);
    const formattedAnalysis = processAnalysis(analysis, analyzer.urlResolver);
    const formattedfixedAnalysis = fixAnalysis(formattedAnalysis, config);

    const analysisFileContents = JSON.stringify(
      formattedfixedAnalysis,
      null,
      2
    );
    const minifiedAnalysisFileContents = JSON.stringify(formattedfixedAnalysis);

    await runAllPromises([
      writeFile(`./`, analysisFileContents, { encoding: 'utf8' }),
      writeFile(
        `./${config.docs.path}/${config.docs.analysisFilename}`,
        minifiedAnalysisFileContents,
        { encoding: 'utf8' }
      )
    ]);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Analyze the component.
 *
 * @param config - Config settings
 */
export async function analyze(
  taskName: string,
  config: IConfig
): Promise<void> {
  await copyElementsForAnalysis(config, taskName);
  await generateAnalysis(config, taskName);
}
