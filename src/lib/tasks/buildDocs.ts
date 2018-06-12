// Libraries.
import cheerio from 'cheerio';
import escodegen from 'escodegen';
import { parseModule } from 'esprima';
import {
  access,
  constants,
  copy,
  ensureDir,
  existsSync,
  readdir,
  readFile,
  readJson,
  writeFile
} from 'fs-extra';
import rename from 'gulp-rename';
import mergeStream from 'merge-stream';
import {
  basename as getFileBasename,
  dirname as getDirName,
  extname as getFileExtension,
  join as joinPaths,
  normalize as getNormalizedPath,
  relative as getRelativePathBetween
} from 'path';
import {
  Class,
  Demo,
  Element,
  ElementMixin,
  Namespace
} from 'polymer-analyzer/lib/analysis-format/analysis-format';
import { PolymerProject } from 'polymer-build';
import promisePipe from 'promisepipe';
import getGitInstance from 'simple-git';
import { promisify } from 'util';
import { dest } from 'vinyl-fs';
import webpack from 'webpack';

import { IConfig } from '../config';
import {
  cleanDocs,
  getWebpackPlugIns,
  glob,
  runAllPromises,
  tasksHelpers
} from '../util';

/**
 * Get the temp path.
 */
function getTempPath(config: IConfig): string {
  return `${config.temp.path}/docs`;
}

/**
 * Test if a directory is able to be cloned into.
 *
 * @param dirPath - Path of the directory to check
 */
async function directoryCanBeClonedInTo(dirPath: string): Promise<boolean> {
  await ensureDir(dirPath);
  await access(dirPath, constants.R_OK | constants.W_OK);

  const files = await readdir(dirPath);

  if (files.length !== 0) {
    return false;
  }

  return true;
}

/**
 * Clone the given repository; then if a branch is given, check it out.
 *
 * @param repoPath - The path to the repo
 * @param dirPath - The path to clone the repo into
 * @param labelPrefix - A prefix to print before the label
 */
async function cloneRepository(
  repoPath: string,
  dirPath: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = `clone of ${repoPath}`;

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const gitInstance = getGitInstance();
    const clone = promisify(gitInstance.clone.bind(gitInstance));
    await clone(repoPath, dirPath, { '--quiet': null });

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Clone all the repos specified by the given package.json files.
 *
 * @param packageFilePaths
 *   Array of file paths to the package.json files that contrain the infomation
 *   about the repos to clone
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function cloneRepositories(
  packageFilePaths: ReadonlyArray<string>,
  config: IConfig,
  labelPrefix: string

  // tslint:disable-next-line:readonly-array
): Promise<void> {
  await Promise.all(
    packageFilePaths.map(async packageFilePath => {
      const data = await readFile(packageFilePath, {
        encoding: 'utf8',
        flag: 'r'
      });
      const json = JSON.parse(data);

      const name = json.name;
      if (name == null) {
        throw new Error(
          `Name not set in the package.json file "${packageFilePath}".`
        );
      }

      const version = json.version;
      if (version == null) {
        throw new Error(`Version not set in ${name}'s package.json file.`);
      }

      const repository = json.repository;
      if (repository == null) {
        throw new Error(`Repository not set in ${name}'s package.json file.`);
      }

      const repositoryIsObject = typeof repository === 'object';
      if (repositoryIsObject && repository.type !== 'git') {
        throw new Error(`"${repository.url}" is not a git repository.`);
      }
      const repositoryRawPath = repositoryIsObject
        ? repository.url
        : repository;
      const repositoryPath = repositoryRawPath.replace(
        /^git\+https:\/\//,
        'git://'
      );

      const clonePath = `./${getTempPath(config)}/demo-clones/${name}`;

      const skipClone = !(await directoryCanBeClonedInTo(clonePath));

      if (skipClone) {
        tasksHelpers.log.info(
          `skipping clone of "${repositoryPath}" - output dir not empty.`,
          labelPrefix
        );
      } else {
        await cloneRepository(repositoryPath, clonePath, labelPrefix);
      }

      const gitInstance = getGitInstance(clonePath);
      const checkout = promisify(gitInstance.checkout.bind(gitInstance));
      await checkout([`v${version}`, '--quiet']);
    })
  );
}

/**
 * Copy all the node modules.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function copyNodeModules(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'node modules';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    await copy(
      `./node_modules`,
      `./${getTempPath(config)}/${config.docs.nodeModulesPath}`,
      { overwrite: true }
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Copy the docs' index page.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function copyDocsIndex(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'index page';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const inDir = '.';
    const filename = config.docs.indexPage;
    const destDir = `./${getTempPath(config)}`;

    await copy(`${inDir}/${filename}`, `${destDir}/${filename}`, {
      overwrite: true
    });

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Copy the docs' extra dependencies.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function copyExtraDocDependencies(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'extra dependencies';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const inDir = `.`;
    const destDir = `./${getTempPath(config)}`;
    const files = await glob([
      `${inDir}/${config.docs.importsImporterFilename}`,
      `${inDir}/${config.docs.importsFilename}`,
      `${inDir}/${config.docs.analysisFilename}`
    ]);

    await runAllPromises(
      files.map(async srcFilepath => {
        const basepath = getRelativePathBetween(inDir, srcFilepath);
        const destFilepath = joinPaths(destDir, basepath);

        return copy(srcFilepath, destFilepath, {
          overwrite: true
        });
      })
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Copy over all the distribution files.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function copyDistributionFiles(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'distribution files';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const inDir = `./${config.dist.path}`;
    const destDir = `./${getTempPath(config)}/${config.docs.nodeModulesPath}/${
      (config.package as any).name
    }`;

    await runAllPromises(
      (await readdir(inDir)).map(async filename =>
        copy(`${inDir}/${filename}`, `${destDir}/${filename}`, {
          overwrite: true
        })
      )
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Copy over the demos in the demos folder.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function copyLocalDemos(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'local demos';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const srcDir = `./${config.demos.path}`;
    const destDir = `./${getTempPath(config)}/${config.docs.nodeModulesPath}/${
      (config.package as any).name
    }/${config.demos.path}`;

    if (existsSync(srcDir)) {
      await runAllPromises(
        (await readdir(srcDir)).map(async filename =>
          copy(`${srcDir}/${filename}`, `${destDir}/${filename}`, {
            overwrite: true
          })
        )
      );
    }

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Copy all the files needed.
 *
 * These file can then be modified without issue.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function copyFiles(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = 'copy files';

  try {
    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await runAllPromises([
      copyNodeModules(config, subTaskLabelPrefix),
      copyDocsIndex(config, subTaskLabelPrefix),
      copyExtraDocDependencies(config, subTaskLabelPrefix)
    ]);

    await copyDistributionFiles(config, subTaskLabelPrefix);
    await copyLocalDemos(config, subTaskLabelPrefix);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Fix the elements in the analysis.
 */
function updateAnalysisElements(
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
      demos: updateAnalysisComponentDemos(element, config)
    };
  });
}

/**
 * Fix the mixins in the analysis.
 */
function updateAnalysisElementMixins(
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
      demos: updateAnalysisComponentDemos(mixin, config)
    };
  });
}

/**
 * Fix the namespaces in the analysis.
 */
function updateAnalysisNamespaces(
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
      elements: updateAnalysisElements(namespace.elements, config),
      mixins: updateAnalysisElementMixins(namespace.mixins, config),
      classes: updateAnalysisClasses(namespace.classes, config)
    };
  });
}

/**
 * Fix the classes in the analysis.
 */
function updateAnalysisClasses(
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
      demos: updateAnalysisComponentDemos(classComponent, config)
    };
  });
}

/**
 * Prefix the demos' url.
 */
function updateAnalysisComponentDemos(
  component: Class,
  config: IConfig

  // tslint:disable-next-line:readonly-array
): Demo[] {
  return component.demos.map(demo => {
    return {
      ...demo,
      url: `${config.docs.nodeModulesPath}/${(config.package as any).name}/${
        demo.url
      }`
    };
  });
}

/**
 * Update the analysis.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function updateAnalysis(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'update analysis';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const file = `./${getTempPath(config)}/${config.docs.analysisFilename}`;
    const fileContent = await readFile(file, { encoding: 'utf8', flag: 'r' });
    const analysis = JSON.parse(fileContent);
    const updatedAnalysis = {
      ...analysis,
      ...{
        elements: updateAnalysisElements(analysis.elements, config),
        mixins: updateAnalysisElementMixins(analysis.mixins, config),
        namespaces: updateAnalysisNamespaces(analysis.namespaces, config),
        classes: updateAnalysisClasses(analysis.classes, config)
      }
    };

    const updatedFileContent = JSON.stringify(updatedAnalysis);

    await ensureDir(getDirName(file));
    await writeFile(file, updatedFileContent);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Get the demos.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function getDemos(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = 'get demos';

  try {
    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    const packageFiles = await glob(
      `./node_modules${
        config.componenet.scope == null ? '' : `/${config.componenet.scope}`
      }/catalyst-*/package.json`
    );

    if (packageFiles.length > 0) {
      await cloneRepositories(packageFiles, config, subTaskLabelPrefix);

      await runAllPromises(
        packageFiles.map(async packageFilepath => {
          const name = (await readJson(packageFilepath)).name;
          const srcDir = `./${getTempPath(config)}/demo-clones/${name}/${
            config.demos.path
          }`;
          const destDir = `./${getTempPath(config)}/${
            config.docs.nodeModulesPath
          }/${name}/${config.demos.path}`;

          if (existsSync(srcDir)) {
            await runAllPromises(
              (await readdir(srcDir)).map(async filename =>
                copy(`${srcDir}/${filename}`, `${destDir}/${filename}`, {
                  overwrite: true
                })
              )
            );
          }
        })
      );
    }

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Update the references in the index file.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function indexPageUpdateReferences(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'index';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const file = `./${getTempPath(config)}/index.html`;
    const fileContent = await readFile(file, { encoding: 'utf8', flag: 'r' });
    const $ = cheerio.load(fileContent);

    // tslint:disable:no-delete no-object-mutation
    $('script').each((_index: number, element: CheerioElement) => {
      if (element.attribs.type === 'module') {
        delete element.attribs.type;
      }
      element.attribs.src = element.attribs.src
        .replace(/^\.\.\/\.\.\//, `${config.docs.nodeModulesPath}/`)
        .replace(/.mjs$/, '.js');
    });

    // tslint:enable:no-delete no-object-mutation

    const updatedFileContent = $.html();

    await ensureDir(getDirName(file));
    await writeFile(file, updatedFileContent);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Update the references in each of the demos' pages.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function demosPagesUpdateReferences(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'demo files';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const files = await glob(
      `./${getTempPath(config)}/${config.docs.nodeModulesPath}${
        config.componenet.scope == null ? '' : `/${config.componenet.scope}`
      }/*/${config.demos.path}/*.html`
    );

    await runAllPromises(
      files.map(async file => {
        const fileContent = await readFile(file, {
          encoding: 'utf8',
          flag: 'r'
        });
        const $ = cheerio.load(fileContent);

        // tslint:disable:no-delete no-object-mutation
        $('script[type="module"]').each(
          (_index: number, element: CheerioElement) => {
            delete element.attribs.type;
            element.attribs.src = element.attribs.src.replace(/.mjs$/, '.js');
          }
        );

        // tslint:enable:no-delete no-object-mutation

        const updatedFileContent = $.html();

        await ensureDir(getDirName(file));
        await writeFile(file, updatedFileContent);
      })
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Update the references in the imported files.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function indexImportsUpdateReferences(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'imports';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const file = `./${getTempPath(config)}/${config.docs.importsFilename}`;
    const fileContent = await readFile(file, { encoding: 'utf8', flag: 'r' });
    const program = parseModule(fileContent);
    const updatedBody = program.body.map(node => {
      if (node.type === 'ImportDeclaration') {
        if (typeof node.source.value === 'string') {
          return {
            ...node,
            source: {
              ...node.source,
              value: node.source.value.replace(
                /\.\.\/\.\.\//g,
                `./${config.docs.nodeModulesPath}/`
              ),
              raw: `'${node.source.value}'`
            }
          };
        }
      }
      return node;
    });
    const updatedProgram = {
      ...program,
      body: updatedBody
    };
    const updatedFileContent = escodegen.generate(updatedProgram);

    await ensureDir(getDirName(file));
    await writeFile(file, updatedFileContent);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Update the references in the index file.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function indexUpdateReferences(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'update references';

  try {
    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await runAllPromises([
      indexPageUpdateReferences(config, subTaskLabelPrefix),
      indexImportsUpdateReferences(config, subTaskLabelPrefix)
    ]);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Update the references in each of the demo files.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function demosUpdateReferences(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'update references';

  try {
    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await runAllPromises([
      demosPagesUpdateReferences(config, subTaskLabelPrefix)
    ]);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Finalize the index page.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function finalizeIndexPage(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'finalize';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const docsImportsBaseName = getFileBasename(
      config.docs.importsFilename,
      getFileExtension(config.docs.importsFilename)
    );

    const docsImportsImporterBaseName = getFileBasename(
      config.docs.importsImporterFilename,
      getFileExtension(config.docs.importsImporterFilename)
    );

    const filepath = `./${getTempPath(config)}/${
      config.docs.importsImporterFilename
    }`;

    const compiler: webpack.Compiler = webpack({
      mode: 'none',
      entry: filepath,
      output: {
        path: joinPaths(process.cwd(), `${getTempPath(config)}`),
        chunkFilename: `${docsImportsBaseName}.[id].js`,
        filename: `${docsImportsImporterBaseName}.js`
      },
      resolve: {
        extensions: ['.js', '.mjs']
      },
      plugins: getWebpackPlugIns(),
      target: 'web'
    } as any);

    const runCompiler = promisify(compiler.run.bind(
      compiler
    ) as typeof compiler.run);
    const stats = await runCompiler();

    // tslint:disable-next-line:no-console
    console.log(
      stats.toString({
        chunks: false,
        colors: true
      })
    );

    const statsDetails = stats.toJson({
      assets: true
    }) as WebpackStats;
    const webpackEmittedFiles = statsDetails.assets.reduce(
      (reducedFiles: ReadonlyArray<string>, asset) => {
        if (asset.emitted) {
          return [
            ...reducedFiles,
            joinPaths(statsDetails.outputPath, asset.name)
          ];
        }
        return reducedFiles;
      },
      []
    );

    webpackEmittedFiles.map(async file => {
      const fileContent = await readFile(file, { encoding: 'utf8', flag: 'r' });
      const updatedFileContent = fileContent.replace(/\\\\\$/g, '$');

      await ensureDir(getDirName(file));
      await writeFile(file, updatedFileContent);
    });

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Finalize the demos.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function finalizeDemos(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'finalize';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const demoImportsBaseName = getFileBasename(
      config.demos.importsFilename,
      getFileExtension(config.demos.importsFilename)
    );

    const docsImportsImporterBaseName = getFileBasename(
      config.demos.importsImporterFilename,
      getFileExtension(config.demos.importsImporterFilename)
    );

    const sourceFiles = await glob(
      `${getTempPath(config)}/${config.docs.nodeModulesPath}${
        config.componenet.scope == null ? '' : `/${config.componenet.scope}`
      }/*/${config.demos.path}/${config.demos.importsImporterFilename}`
    );

    const webpackResults = await runAllPromises(
      sourceFiles.map(async file => {
        const destDir = getDirName(file);
        const compiler: webpack.Compiler = webpack({
          mode: 'none',
          entry: file,
          output: {
            path: joinPaths(process.cwd(), destDir),
            chunkFilename: `${demoImportsBaseName}.[id].js`,
            filename: `${docsImportsImporterBaseName}.js`
          },
          resolve: {
            extensions: ['.js', '.mjs']
          },
          plugins: getWebpackPlugIns(),
          target: 'web'
        });

        const runCompiler: () => Promise<webpack.Stats> = promisify(
          compiler.run.bind(compiler)
        );
        const stats = await runCompiler();

        const statsDetails = stats.toJson({
          assets: true
        }) as WebpackStats;

        const webpackEmittedFiles = statsDetails.assets.reduce(
          (reducedFiles: ReadonlyArray<string>, asset) => {
            if (asset.emitted) {
              return [
                ...reducedFiles,
                joinPaths(statsDetails.outputPath, asset.name)
              ];
            }
            return reducedFiles;
          },
          []
        );

        return {
          log: stats.toString({
            chunks: false,
            colors: true
          }),
          webpackEmittedFiles
        };
      })
    );

    const outFiles = webpackResults.reduce(
      (reducedFiles: ReadonlyArray<string>, result) => {
        // tslint:disable-next-line:no-console
        console.log(result.log);

        return [...reducedFiles, ...result.webpackEmittedFiles];
      },
      []
    );

    await runAllPromises(
      outFiles.map(async file => {
        const fileContent = await readFile(file, {
          encoding: 'utf8',
          flag: 'r'
        });
        const updatedFileContent = fileContent.replace(/\\\\\$/g, '$');

        await ensureDir(getDirName(file));
        await writeFile(file, updatedFileContent);
      })
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Build the index page.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function buildIndexPage(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'index page';

  try {
    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await indexUpdateReferences(config, subTaskLabelPrefix);
    await finalizeIndexPage(config, subTaskLabelPrefix);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Build the index page.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function buildDemos(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = 'demos';

  try {
    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await demosUpdateReferences(config, subTaskLabelPrefix);
    await finalizeDemos(config, subTaskLabelPrefix);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Build the index page.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function build(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = 'build';

  try {
    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await buildIndexPage(config, subTaskLabelPrefix);
    await buildDemos(config, subTaskLabelPrefix);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Generate the docs.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function generate(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = 'generate';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const docsImportsBaseName = getFileBasename(
      config.docs.importsFilename,
      getFileExtension(config.docs.importsFilename)
    );

    const docsImportsImporterBaseName = getFileBasename(
      config.docs.importsImporterFilename,
      getFileExtension(config.docs.importsImporterFilename)
    );

    const buildConfig = {
      root: `${getTempPath(config)}/`,
      entrypoint: `index${getFileExtension(config.docs.indexPage)}`,
      fragments: [],
      sources: [
        `${config.docs.nodeModulesPath}${
          config.componenet.scope == null ? '' : `/${config.componenet.scope}`
        }/catalyst-*/**/*`
      ],
      extraDependencies: [
        `${
          config.docs.nodeModulesPath
        }/@webcomponents/webcomponentsjs/[!gulpfile]*.js`,
        `${
          config.docs.nodeModulesPath
        }/@webcomponents/shadycss/[!gulpfile]*.js`,
        `${docsImportsImporterBaseName}.js`,
        `${docsImportsBaseName}.*.js`,
        `${config.docs.analysisFilename}`
      ],
      builds: [
        {
          name: 'docs',

          // Disable these settings as they are either not wanted or handled elsewhere.
          bundle: false,
          js: { compile: false, minify: false },
          css: { minify: false },
          html: { minify: false },
          addServiceWorker: false,
          addPushManifest: false,
          insertPrefetchLinks: false
        }
      ]
    };

    const docBuilder = new PolymerProject(buildConfig);

    await promisePipe(
      mergeStream(docBuilder.sources(), docBuilder.dependencies()),
      docBuilder.addCustomElementsEs5Adapter(),
      rename(path => {
        const prefix = getNormalizedPath(`${getTempPath(config)}`);
        if (path.dirname !== undefined && path.dirname.indexOf(prefix) === 0) {
          // tslint:disable-next-line:no-object-mutation
          path.dirname = getNormalizedPath(
            path.dirname.substring(prefix.length)
          );
        }
      }),
      dest(`./${config.docs.path}`)
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Build the docs for the component.
 */
export async function buildDocs(
  taskName: string,
  config: IConfig
): Promise<void> {
  await copyFiles(config, taskName);
  await updateAnalysis(config, taskName);
  await getDemos(config, taskName);
  await build(config, taskName);
  await cleanDocs(config, taskName);
  await generate(config, taskName);
}
