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
  INodePackage,
  logTaskFailed,
  logTaskInfo,
  logTaskStarting,
  logTaskSuccessful,
  runAllPromises,
  webpackPostProcess
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

  // tslint:disable-next-line:no-bitwise
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
    logTaskStarting(subTaskLabel, labelPrefix);

    const gitInstance = getGitInstance();
    const clone = promisify(gitInstance.clone.bind(gitInstance));
    await clone(repoPath, dirPath, { '--quiet': undefined });

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
): Promise<void> {
  await Promise.all(
    packageFilePaths.map(async (packageFilePath) => {
      const data = await readFile(packageFilePath, {
        encoding: 'utf8',
        flag: 'r'
      });
      const json = JSON.parse(data);

      const name = json.name;
      if (name == undefined) {
        throw new Error(
          `Name not set in the package.json file "${packageFilePath}".`
        );
      }

      const version = json.version;
      if (version == undefined) {
        throw new Error(`Version not set in ${name}'s package.json file.`);
      }

      const repository = json.repository;
      if (repository == undefined) {
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
        logTaskInfo(
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
    logTaskStarting(subTaskLabel, labelPrefix);

    await copy(
      `./node_modules`,
      `./${getTempPath(config)}/${config.docs.nodeModulesPath}`,
      { overwrite: true }
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    logTaskStarting(subTaskLabel, labelPrefix);

    const inDir = '.';
    const filename = config.docs.indexPage;
    const destDir = `./${getTempPath(config)}`;

    await copy(`${inDir}/${filename}`, `${destDir}/${filename}`, {
      overwrite: true
    });

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    logTaskStarting(subTaskLabel, labelPrefix);

    const inDir = `.`;
    const destDir = `./${getTempPath(config)}`;
    const files = await glob([
      `${inDir}/${config.docs.importsImporterFilename}`,
      `${inDir}/${config.docs.importsFilename}`,
      `${inDir}/${config.docs.analysisFilename}`
    ]);

    await runAllPromises(
      files.map(async (srcFilepath) => {
        const basepath = getRelativePathBetween(inDir, srcFilepath);
        const destFilepath = joinPaths(destDir, basepath);

        return copy(srcFilepath, destFilepath, {
          overwrite: true
        });
      })
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
  nodePackage: INodePackage,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'distribution files';

  try {
    logTaskStarting(subTaskLabel, labelPrefix);

    const inDir = `./${config.dist.path}`;
    const destDir = `./${getTempPath(config)}/${config.docs.nodeModulesPath}/${
      nodePackage.name
    }`;

    await runAllPromises(
      (await readdir(inDir)).map(async (filename) =>
        copy(`${inDir}/${filename}`, `${destDir}/${filename}`, {
          overwrite: true
        })
      )
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
  nodePackage: INodePackage,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'local demos';

  try {
    logTaskStarting(subTaskLabel, labelPrefix);

    const srcDir = `./${config.demos.path}`;
    const destDir = `./${getTempPath(config)}/${config.docs.nodeModulesPath}/${
      nodePackage.name}/${config.demos.path}`;

    if (existsSync(srcDir)) {
      await runAllPromises(
        (await readdir(srcDir)).map(async (filename) =>
          copy(`${srcDir}/${filename}`, `${destDir}/${filename}`, {
            overwrite: true
          })
        )
      );
    }

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
async function copyFiles(
  config: IConfig,
  nodePackage: INodePackage,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'copy files';

  try {
    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    await runAllPromises([
      copyNodeModules(config, subTaskLabelPrefix),
      copyDocsIndex(config, subTaskLabelPrefix),
      copyExtraDocDependencies(config, subTaskLabelPrefix)
    ]);

    await copyDistributionFiles(config, nodePackage, subTaskLabelPrefix);
    await copyLocalDemos(config, nodePackage, subTaskLabelPrefix);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Fix the elements in the analysis.
 */
function updateAnalysisElements(
  elements: ReadonlyArray<Element> | undefined,
  config: IConfig,
  nodePackage: INodePackage
): Array<Element> | undefined {
  if (elements === undefined) {
    return undefined;
  }

  return elements.map((element) => {
    return {
      ...element,
      demos: updateAnalysisComponentDemos(element, config, nodePackage)
    };
  });
}

/**
 * Fix the mixins in the analysis.
 */
function updateAnalysisElementMixins(
  elementMixins: ReadonlyArray<ElementMixin> | undefined,
  config: IConfig,
  nodePackage: INodePackage
): Array<ElementMixin> | undefined {
  if (elementMixins === undefined) {
    return undefined;
  }

  return elementMixins.map((mixin) => {
    return {
      ...mixin,
      demos: updateAnalysisComponentDemos(mixin, config, nodePackage)
    };
  });
}

/**
 * Fix the namespaces in the analysis.
 */
function updateAnalysisNamespaces(
  namespaces: ReadonlyArray<Namespace> | undefined,
  config: IConfig,
  nodePackage: INodePackage
): Array<Namespace> | undefined {
  if (namespaces === undefined) {
    return undefined;
  }

  return namespaces.map((namespace) => {
    return {
      ...namespace,
      elements: updateAnalysisElements(namespace.elements, config, nodePackage),
      mixins: updateAnalysisElementMixins(namespace.mixins, config, nodePackage),
      classes: updateAnalysisClasses(namespace.classes, config, nodePackage)
    };
  });
}

/**
 * Fix the classes in the analysis.
 */
function updateAnalysisClasses(
  classes: ReadonlyArray<Class> | undefined,
  config: IConfig,
  nodePackage: INodePackage
): Array<Class> | undefined {
  if (classes === undefined) {
    return undefined;
  }

  return classes.map((classComponent) => {
    return {
      ...classComponent,
      demos: updateAnalysisComponentDemos(classComponent, config, nodePackage)
    };
  });
}

/**
 * Prefix the demos' url.
 */
function updateAnalysisComponentDemos(
  component: Class,
  config: IConfig,
  nodePackage: INodePackage
): Array<Demo> {
  return component.demos.map((demo) => {
    return {
      ...demo,
      url: `${config.docs.nodeModulesPath}/${nodePackage.name}/${demo.url}`
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
  nodePackage: INodePackage,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'update analysis';

  try {
    logTaskStarting(subTaskLabel, labelPrefix);

    const file = `./${getTempPath(config)}/${config.docs.analysisFilename}`;
    const fileContent = await readFile(file, { encoding: 'utf8', flag: 'r' });
    const analysis = JSON.parse(fileContent);
    const updatedAnalysis = {
      ...analysis,
      ...{
        elements: updateAnalysisElements(
          analysis.elements,
          config,
          nodePackage
        ),
        mixins: updateAnalysisElementMixins(
          analysis.mixins,
          config,
          nodePackage
        ),
        namespaces: updateAnalysisNamespaces(
          analysis.namespaces,
          config,
          nodePackage
        ),
        classes: updateAnalysisClasses(
          analysis.classes,
          config,
          nodePackage
        )
      }
    };

    const updatedFileContent = JSON.stringify(updatedAnalysis);

    await ensureDir(getDirName(file));
    await writeFile(file, updatedFileContent);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    const nodeScope =
      config.component.scope === undefined
        ? ''
        : `/${config.component.scope}`;

    const packageFiles = await glob(
      `./node_modules${nodeScope}/catalyst-*/package.json`
    );

    if (packageFiles.length > 0) {
      await cloneRepositories(packageFiles, config, subTaskLabelPrefix);

      await runAllPromises(
        packageFiles.map(async (packageFilepath) => {
          const name = (await readJson(packageFilepath)).name;
          const srcDir = `./${getTempPath(config)}/demo-clones/${name}/${
            config.demos.path
          }`;
          const destDir = `./${getTempPath(config)}/${
            config.docs.nodeModulesPath
          }/${name}/${config.demos.path}`;

          if (!existsSync(srcDir)) {
            return;
          }

          await runAllPromises(
            (await readdir(srcDir)).map(async (filename) =>
              copy(`${srcDir}/${filename}`, `${destDir}/${filename}`, {
                overwrite: true
              })
            )
          );
        })
      );
    }

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    logTaskStarting(subTaskLabel, labelPrefix);

    const file = `./${getTempPath(config)}/index.html`;
    const fileContent = await readFile(file, { encoding: 'utf8', flag: 'r' });
    const $ = cheerio.load(fileContent);

    $('script')
      .each((_index, mutableElement) => {
        if (mutableElement.attribs.type === 'module') {
          delete mutableElement.attribs.type;
        }
        mutableElement.attribs.src = mutableElement.attribs.src
          .replace(/^\.\.\/\.\.\//, `${config.docs.nodeModulesPath}/`)
          .replace(/.mjs$/, '.js');
      });

    const updatedFileContent = $.html();

    await ensureDir(getDirName(file));
    await writeFile(file, updatedFileContent);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    logTaskStarting(subTaskLabel, labelPrefix);

    const nodeScope =
      config.component.scope === undefined
        ? ''
        : `/${config.component.scope}`;

    const files = await glob(
      `./${getTempPath(config)}/${config.docs.nodeModulesPath}${nodeScope}/*/${
        config.demos.path
      }/*.html`
    );

    await runAllPromises(
      files.map(async (file) => {
        const fileContent = await readFile(file, {
          encoding: 'utf8',
          flag: 'r'
        });
        const $ = cheerio.load(fileContent);

        $('script[type="module"]')
          .each((_index, mutableElement) => {
            delete mutableElement.attribs.type;
            mutableElement.attribs.src =
              mutableElement.attribs.src.replace(/.mjs$/, '.js');
          });

        const updatedFileContent = $.html();

        await ensureDir(getDirName(file));
        await writeFile(file, updatedFileContent);
      })
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    logTaskStarting(subTaskLabel, labelPrefix);

    const file = `./${getTempPath(config)}/${config.docs.importsFilename}`;
    const fileContent = await readFile(file, { encoding: 'utf8', flag: 'r' });
    const program = parseModule(fileContent);
    const updatedBody = program.body.map((node) => {
      if (
        node.type === 'ImportDeclaration' &&
        typeof node.source.value === 'string'
      ) {
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
      return node;
    });
    const updatedProgram = {
      ...program,
      body: updatedBody
    };
    const updatedFileContent = escodegen.generate(updatedProgram);

    await ensureDir(getDirName(file));
    await writeFile(file, updatedFileContent);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    await runAllPromises([
      indexPageUpdateReferences(config, subTaskLabelPrefix),
      indexImportsUpdateReferences(config, subTaskLabelPrefix)
    ]);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    await runAllPromises([
      demosPagesUpdateReferences(config, subTaskLabelPrefix)
    ]);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    logTaskStarting(subTaskLabel, labelPrefix);

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

    const compiler = webpack({
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
    });

    const runCompiler = promisify(compiler.run.bind(
      compiler
    ) as typeof compiler.run);
    const stats = await runCompiler();

    console.info(
      stats.toString({
        chunks: false,
        colors: true
      })
    );

    const statsDetails = stats.toJson({
      assets: true
    }) as WebpackStats;
    const webpackEmittedFiles = getWebpackEmittedFiles(statsDetails);

    webpackEmittedFiles.forEach(async (file) => {
      const fileContent = await readFile(file, { encoding: 'utf8', flag: 'r' });
      const updatedFileContent = fileContent.replace(/\\\\\$/g, '$');

      await ensureDir(getDirName(file));
      await writeFile(file, updatedFileContent);
    });

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    logTaskStarting(subTaskLabel, labelPrefix);

    const demoImportsBaseName = getFileBasename(
      config.demos.importsFilename,
      getFileExtension(config.demos.importsFilename)
    );

    const docsImportsImporterBaseName = getFileBasename(
      config.demos.importsImporterFilename,
      getFileExtension(config.demos.importsImporterFilename)
    );

    const nodeScope =
      config.component.scope === undefined
        ? ''
        : `/${config.component.scope}`;

    const sourceFiles = await glob(
      `${getTempPath(config)}/${config.docs.nodeModulesPath}${nodeScope}/*/${
        config.demos.path
      }/${config.demos.importsImporterFilename}`
    );

    const webpackResults = await runAllPromises(
      sourceFiles.map(async (file) => {
        const destDir = getDirName(file);
        const compiler = webpack({
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

        const runCompiler = promisify<() => Promise<webpack.Stats>>(
          compiler.run.bind(compiler)
        );
        const stats = await runCompiler();

        const statsDetails = stats.toJson({
          assets: true
        }) as WebpackStats;

        const webpackEmittedFiles = getWebpackEmittedFiles(statsDetails);

        return {
          log: stats.toString({
            chunks: false,
            colors: true
          }),
          webpackEmittedFiles
        };
      })
    );

    await webpackPostProcess(webpackResults);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Get the emitted files of a webpack build.
 */
function getWebpackEmittedFiles(statsDetails: WebpackStats): Array<string> {
  return statsDetails.assets.reduce<Array<string>>((reducedFiles, asset) => {
    if (asset.emitted) {
      return [...reducedFiles, joinPaths(statsDetails.outputPath, asset.name)];
    }
    return reducedFiles;
  }, []);
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
    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    await indexUpdateReferences(config, subTaskLabelPrefix);
    await finalizeIndexPage(config, subTaskLabelPrefix);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    await demosUpdateReferences(config, subTaskLabelPrefix);
    await finalizeDemos(config, subTaskLabelPrefix);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    await buildIndexPage(config, subTaskLabelPrefix);
    await buildDemos(config, subTaskLabelPrefix);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
    logTaskStarting(subTaskLabel, labelPrefix);

    const docsImportsBaseName = getFileBasename(
      config.docs.importsFilename,
      getFileExtension(config.docs.importsFilename)
    );

    const docsImportsImporterBaseName = getFileBasename(
      config.docs.importsImporterFilename,
      getFileExtension(config.docs.importsImporterFilename)
    );

    const nodeScope =
      config.component.scope === undefined
        ? ''
        : `/${config.component.scope}`;

    const buildConfig = {
      root: `${getTempPath(config)}/`,
      entrypoint: `index${getFileExtension(config.docs.indexPage)}`,
      fragments: [],
      sources: [`${config.docs.nodeModulesPath}${nodeScope}/catalyst-*/**/*`],
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
      rename((mutablePath) => {
        const prefix = getNormalizedPath(`${getTempPath(config)}`);
        if (
          mutablePath.dirname === undefined ||
          mutablePath.dirname.indexOf(prefix) !== 0
        ) {
          return;
        }
        mutablePath.dirname = getNormalizedPath(
          mutablePath.dirname.substring(prefix.length)
        );
      }),
      dest(`./${config.docs.path}`)
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
  if (config.package === undefined) {
    throw new Error('Cannot build docs: Cannot get node package info.');
  }

  await copyFiles(config, config.package, taskName);
  await updateAnalysis(config, config.package, taskName);
  await getDemos(config, taskName);
  await build(config, taskName);
  await cleanDocs(config, taskName);
  await generate(config, taskName);
}
