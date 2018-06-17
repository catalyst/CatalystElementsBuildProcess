// Libraries.
import del from 'del';
import { generate as generateJS } from 'escodegen';
import { parseModule, parseScript, Program } from 'esprima';
import {
  ClassDeclaration,
  ExportNamedDeclaration,
  ExportSpecifier,
  FunctionDeclaration,
  ImportDeclaration,
  ModuleDeclaration,
  Statement,
  VariableDeclaration,
  VariableDeclarator
} from 'estree'; // tslint:disable-line:no-implicit-dependencies
import {
  copy,
  ensureDir,
  existsSync,
  readFile,
  symlink,
  writeFile
} from 'fs-extra';
import {
  minify as htmlMinifier,
  Options as HtmlMinifierOptions
} from 'html-minifier';
import sass from 'node-sass';
import {
  basename as getFileBasename,
  dirname as getDirName,
  extname as getFileExtension,
  join as joinPaths,
  relative as getRelativePathBetween
} from 'path';
import postcss from 'postcss';
import { promisify } from 'util';
import webpack from 'webpack';

import { IConfig } from '../config';
import {
  clean,
  getInjectRegExp,
  getWebpackPlugIns,
  glob,
  INodePackage,
  runTask,
  runTasksParallel,
  skipTask,
  UncertainEntryFileError
} from '../util';

// Promisified functions.
const renderSass = promisify<(options: sass.Options) => Promise<sass.Result>>(
  sass.render.bind(sass)
);

const validMarkupFileTypes = ['.html', '.htm'];
const validStyleFileTypes = ['.css', '.sass', '.scss'];

export {
  buildPreChecks as build
};

/**
 * Build the component.
 */
async function buildPreChecks(taskName: string, config: IConfig): Promise<void> {
  return (
    config.component.name === undefined
    ? Promise.reject(new Error('Cannot build: `config.component.name` is not set.'))

    : config.src.entrypoint === undefined
    ? Promise.reject(new Error('Cannot build: `config.src.entrypoint` is not set.'))

    : build(
        config.component.name,
        `./${config.src.path}/${config.src.entrypoint}`,
        config,
        taskName
      )
  );
}

/**
 * Build the component.
 */
async function build(
  componentName: string,
  srcEntrypoint: string,
  config: IConfig,
  taskName: string
): Promise<void> {
  const entrypoint = `entrypoint${getFileExtension(srcEntrypoint)}`;
  const tempPath = `./${config.temp.path}/build`;

  await clean(`./${config.dist.path}`, 'dist', taskName);
  await runTaskCheckSourceFiles(srcEntrypoint, taskName);
  await runTaskPrepareEntrypoint(srcEntrypoint, entrypoint, config.src.path, tempPath, taskName);
  await runTasksParallel([
    runTaskMinifyHTML(config.src.path, tempPath, config.build.tools.htmlMinifier, taskName),
    runTaskCompileCSS(config.src.path, tempPath, config.build.tools.postcss, config.src.template, taskName)
  ]);
  await runTasksParallel([
    runTaskBuildModule(
      config.build.module.create,
      entrypoint,
      componentName,
      config.component.scope,
      tempPath,
      config.build.module.extension,
      taskName
    ),
    buildScript(
      config.build.script.create,
      entrypoint,
      componentName,
      config.component.scope,
      tempPath,
      config.build.script.extension,
      taskName
    ),
  ]);
  await finalize(componentName, taskName);
  await buildSymlinks(componentName, taskName);
}

//#region Task Runners

/**
 * Run the "check source files" task.
 */
async function runTaskCheckSourceFiles(
  srcEntrypoint: string,
  labelPrefix: string
): Promise<void> {
  return runTask(
    'check source files',
    labelPrefix,
    taskCheckSourceFiles,
    [srcEntrypoint]
  );
}

/**
 * Run the "prepare entrypoint" task.
 */
async function runTaskPrepareEntrypoint(
  srcEntrypoint: string,
  entrypoint: string,
  srcPath: string,
  tempPath: string,
  labelPrefix: string
): Promise<void> {
  return runTask(
    'prepare entrypoint',
    labelPrefix,
    taskPrepareEntrypoint,
    [
      srcEntrypoint,
      entrypoint,
      srcPath,
      tempPath
    ]
  );
}

/**
 * Run the "minify HTML" task.
 */
async function runTaskMinifyHTML(
  srcPath: string,
  tempPath: string,
  htmlMinifierOptions: IConfig['build']['tools']['htmlMinifier'],
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'minify HTML';

  const files = await glob(`./${srcPath}/**/*.html`);

  return (
    files.length === 0
    ? skipTask(subTaskLabel, labelPrefix, 'no styles to compile')
    : runTask(
        subTaskLabel,
        labelPrefix,
        taskMinifyHTML,
        [
          files,
          htmlMinifierOptions,
          tempPath
        ]
      )
  );
}

/**
 * Run the "compile CSS" task.
 */
async function runTaskCompileCSS(
  srcPath: string,
  tempPath: string,
  postcssConfig: IConfig['build']['tools']['postcss'],
  template: IConfig['src']['template'],
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'compile CSS';

  return (
    template === undefined ||
    template.style === undefined
      ? skipTask(subTaskLabel, labelPrefix, 'no styles to compile')
      : runTask(
          subTaskLabel,
          labelPrefix,
          taskCompileCSS,
          [
            postcssConfig === undefined
            ? []
            : postcssConfig.plugins === undefined
            ? []
            : postcssConfig.plugins,

            postcssConfig === undefined
            ? undefined
            : postcssConfig.options,

            `${srcPath}/${template.style}`,

            tempPath
          ]
        )
  );
}

/**
 *
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function runTaskBuildModule(
  createModule: boolean,
  entrypoint: string,
  componentName: string,
  nodeScope: string | undefined,
  tempPath: string,
  moduleExtension: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'module';
  return (
    !createModule
    ? skipTask(subTaskLabel, labelPrefix, 'Turned off in config.')
    : runTask(
        subTaskLabel,
        labelPrefix,
        taskBuildModule,
        [
          entrypoint,
          componentName,
          nodeScope,
          tempPath,
          moduleExtension
        ]
      )
  );
}

/**
 * Run the "initialize module file" task.
 */
async function runTaskInitializeModuleFile(
  entrypoint: string,
  componentName: string,
  nodeScope: string | undefined,
  tempPath: string,
  moduleExtension: string,
  labelPrefix: string
): Promise<void> {
  const files = await glob(
    `${tempPath}/**/${entrypoint}`
  );

  return (
    files.length !== 1
    ? Promise.reject(new UncertainEntryFileError())
    : runTask(
        'initialize file',
        labelPrefix,
        taskInitializeModuleFile,
        [
          files[0],
          componentName,
          nodeScope,
          tempPath,
          moduleExtension
        ]
      )
  );
}

//#endregion

//#region Tasks

/**
 * Task: Check the source files are all good.
 */
async function taskCheckSourceFiles(
  _labelPrefix: string,
  srcEntrypoint: string
): Promise<void> {
  const entrypointContent = await readFile(srcEntrypoint, {
    encoding: 'utf8',
    flag: 'r'
  });
  const program = parseModule(entrypointContent);

  const defaultExports = program.body.reduce((reducedCount, node) => {
    return (
      node.type === 'ExportDefaultDeclaration'
      ? reducedCount + 1
      : reducedCount
    );
  }, 0);

  return (
    defaultExports === 0
      ? undefined
      : Promise.reject(Error(`Do not use default exports. ${defaultExports} found.`))
  );
}

/**
 * Task: Prepare the entrypoint file.
 */
async function taskPrepareEntrypoint(
  _labelPrefix: string,
  srcEntrypoint: string,
  entrypoint: string,
  srcPath: string,
  tempPath: string
): Promise<void> {
  const pathChange = getRelativePathBetween(`./${srcPath}`, tempPath);
  const depthChange = pathChange
    .split('/')
    .reduce((reducedChange, segment) => {
      return (
        segment === '' || segment === '.'
        ? reducedChange
        : segment === '..'
        ? reducedChange - 1
        : reducedChange + 1
      );
    }, 0);

  const entrypointContent = await readFile(srcEntrypoint, {
    encoding: 'utf8',
    flag: 'r'
  });

  const updatedEntrypointContent =
    depthChange <= 0
    ? entrypointContent
    : entrypointContent.replace(
        new RegExp(`\\.\\./node_modules/`, 'g'),
        `${'../'.repeat(depthChange + 1)}node_modules/`
      );

  await ensureDir(tempPath);
  await writeFile(`${tempPath}/${entrypoint}`, updatedEntrypointContent);
}

/**
 * Task: Minify HTML.
 */
async function taskMinifyHTML(
  _labelPrefix: string,
  files: Array<string>,
  htmlMinifierOptions: HtmlMinifierOptions | undefined,
  tempPath: string
): Promise<void> {
  files.forEach(async (file) => {
    const fileContent = await readFile(file, {
      encoding: 'utf8',
      flag: 'r'
    });

    const minified = htmlMinifier(fileContent, htmlMinifierOptions)
      .replace(/\n/g, '');

    await ensureDir(tempPath);
    await writeFile(`${tempPath}/${getFileBasename(file)}`, minified);
  });
}

/**
 * Task: CompileCSS.
 */
async function taskCompileCSS(
  _labelPrefix: string,
  postcssPlugins: Array<postcss.AcceptedPlugin>,
  postcssOptions: postcss.ProcessOptions | undefined,
  styleFile: string,
  tempPath: string
): Promise<void> {
  const fileExtension = getFileExtension(styleFile);

  const css =
    fileExtension === '.sass' || fileExtension === '.scss'
    ? (await renderSass({
        file: styleFile,
        outputStyle: 'expanded'
      })).css.toString('utf8')
    : await readFile(styleFile);

  const processedCss =
    await postcss(postcssPlugins)
      .process(css, postcssOptions);

  const finalizedCss = processedCss.css.replace(/\n/g, '');
  const destFilename = `${getFileBasename(styleFile, getFileExtension(styleFile))}.css`;

  await ensureDir(tempPath);
  await writeFile(`${tempPath}/${destFilename}`, finalizedCss);
}

/**
 * Task: Build the es module version of the component.
 */
async function taskBuildModule(
  labelPrefix: string,
  entrypoint: string,
  componentName: string,
  nodeScope: string | undefined,
  tempPath: string,
  moduleExtension: string
): Promise<void> {
  await runTaskInitializeModuleFile(
    entrypoint,
    componentName,
    nodeScope,
    tempPath,
    moduleExtension,
    labelPrefix
  );
  await injectTemplateModule(config, componentName, labelPrefix);
  await finalizeModule(config, componentName, labelPrefix);
}

/**
 * Task: Create the module file.
 */
async function taskInitializeModuleFile(
  _labelPrefix: string,
  file: string,
  componentName: string,
  nodeScope: string | undefined,
  tempPath: string,
  moduleExtension: string
): Promise<void> {
  const fileContent = await readFile(file, {
    encoding: 'utf8',
    flag: 'r'
  });

  const esLintRegExp = /^\s*\/\*+[\s\n\*]*eslint[ -]\S*\s*\*+\/\s*$/gm;
  const tsLintRegExp = /^\s*\/\/\s*tslint:.*$/gm;
  const nodeModulesScopeRegExp = new RegExp(`(../)*node_modules/${nodeScope}/`, 'g'); // FIXME: nodeScope === undefined not handled.
  const nodeModulesRegExp = new RegExp(`(../)*node_modules/`, 'g');
  const updatedFileContent = `${
    fileContent
      // Strip eslint and tslint comments.
      .replace(esLintRegExp, '')
      .replace(tsLintRegExp, '')

      // Correct `node_modules` links.
      .replace(nodeModulesScopeRegExp, '../')
      .replace(nodeModulesRegExp, '../../')

      // Trim extra white space.
      .trim()

    // End with a newline.
  }\n`;

  await ensureDir(tempPath);
  await writeFile(
    `${tempPath}/${componentName}${moduleExtension}`,
    updatedFileContent
  );
}

//#endregion

/**
 * Build the es5 script version of the component.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function buildScript(
  config: IConfig,
  componentName: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'script';


  try {
    if (!config.build.script.create) {
      logTaskInfo(
        `skipping ${subTaskLabel} - turned off in config.`,
        labelPrefix
      );

      return;
    }

    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    await initializeScriptFile(config, componentName, subTaskLabelPrefix);
    await injectTemplateScript(config, componentName, subTaskLabelPrefix);
    await finalizeScript(config, componentName, subTaskLabelPrefix);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Create the element file.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function initializeScriptFile(
  config: IConfig,
  componentName: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'initialize file';


  try {
    logTaskStarting(subTaskLabel, labelPrefix);

    const files = await glob(
      `./${
        config.temp.path
      }/${tempSubpath}/**/${tempEntrypointFileBaseName}${getFileExtension(config
        .src.entrypoint as string)}`
    );

    if (files.length !== 1) {
      throw new UncertainEntryFileError();
    }
    const file = files[0];
    const fileContent = await readFile(file, {
      encoding: 'utf8',
      flag: 'r'
    });

    const program = parseModule(fileContent);
    const { esImports, esExports } = getImportsAndExports(config, program);
    const updatedProgram = processExports(
      processImports(program, esImports),
      esExports
    );
    const updatedSourceCode =
      `window.CatalystElements = window.CatalystElements || {};\n'${generateJS(
        updatedProgram
      )}`;

    const destDir = `./${config.temp.path}/${tempSubpath}`;
    await ensureDir(destDir);
    await writeFile(
      `${destDir}/${componentName}${config.build.script.extension}`,
      updatedSourceCode
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Inject the template markup.
 *
 * @param config - Config settings
 * @param file - The file to inject into
 * @param labelPrefix - A prefix to print before the label
 */
async function injectTemplateMarkup(
  config: IConfig,
  file: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'markup';


  if (
    config.src.template === undefined ||
    config.src.template.markup === undefined
  ) {
    logTaskInfo(`skipping ${subTaskLabel} - no markup to inject.`, labelPrefix);
    return;
  }

  const fileExtension = getFileExtension(config.src.template.markup);
  if (!validMarkupFileTypes.includes(fileExtension)) {
    throw new Error(`Cannot process markup files of type "${fileExtension}"`);
  }

  return injectTemplateHTML(
    config,
    file,
    config.src.template.markup,
    labelPrefix
  );
}

/**
 * Inject the template html.
 *
 * @param config - Config settings
 * @param targetFile - The file to inject into
 * @param labelPrefix - A prefix to print before the label
 */
async function injectTemplateHTML(
  config: IConfig,
  targetFile: string,
  markupFile: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'html';


  logTaskStarting(subTaskLabel, labelPrefix);

  const htmlFile = `./${config.temp.path}/${tempSubpath}/${markupFile}`;

  const [element, html] = await Promise.all(
    [targetFile, htmlFile].map(async (filepath) =>
      readFile(filepath, {
        encoding: 'utf8',
        flag: 'r'
      })
    )
  );

  const injectedElement = element.replace(
    getInjectRegExp('html'),
    html.replace(/`/g, '\\`')
  );

  await ensureDir(getDirName(targetFile));
  await writeFile(targetFile, injectedElement);

  logTaskSuccessful(subTaskLabel, labelPrefix);
}

/**
 * Inject the template style.
 *
 * @param config - Config settings
 * @param file - The file to inject into
 * @param labelPrefix - A prefix to print before the label
 */
async function injectTemplateStyle(
  config: IConfig,
  file: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'style';


  if (
    config.src.template === undefined ||
    config.src.template.style === undefined
  ) {
    logTaskInfo(`skipping ${subTaskLabel} - no styles to inject.`, labelPrefix);
    return;
  }

  const fileExtension = getFileExtension(config.src.template.style);
  if (!validStyleFileTypes.includes(fileExtension)) {
    throw new Error(`Cannot process style files of type "${fileExtension}"`);
  }

  return injectTemplateCSS(
    config,
    file,
    config.src.template.style,
    labelPrefix
  );
}

/**
 * Inject the template css.
 *
 * @param config - Config settings
 * @param targetFile - The file to inject into
 * @param labelPrefix - A prefix to print before the label
 */
async function injectTemplateCSS(
  config: IConfig,
  targetFile: string,
  styleFile: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'css';


  logTaskStarting(subTaskLabel, labelPrefix);

  const styleFileBasename = styleFile.substring(
    0,
    styleFile.length - getFileExtension(styleFile).length
  );
  const cssFile = `./${config.temp.path}/${tempSubpath}/${styleFileBasename}.css`;

  const [element, css] = await Promise.all(
    [targetFile, cssFile].map(async (filepath) =>
      readFile(filepath, {
        encoding: 'utf8',
        flag: 'r'
      })
    )
  );

  const injectedElement = element.replace(
    getInjectRegExp('css'),
    css.replace(/`/g, '\\`')
  );

  await ensureDir(getDirName(targetFile));
  await writeFile(targetFile, injectedElement);
  logTaskSuccessful(subTaskLabel, labelPrefix);
}

/**
 * Inject the template into the element.
 *
 * @param config - Config settings
 * @param file - The element's file
 * @param labelPrefix - A prefix to print before the label
 */
async function injectTemplate(
  config: IConfig,
  file: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'inject template';


  try {
    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    await injectTemplateMarkup(config, file, subTaskLabelPrefix);
    await injectTemplateStyle(config, file, subTaskLabelPrefix);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Inject the template into the module.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function injectTemplateModule(
  config: IConfig,
  componentName: string,
  labelPrefix: string
): Promise<void> {
  await injectTemplate(
    config,
    `./${config.temp.path}/${tempSubpath}/${componentName}${
      config.build.module.extension
    }`,
    labelPrefix
  );
}

/**
 * Inject the template into the script.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function injectTemplateScript(
  config: IConfig,
  componentName: string,
  labelPrefix: string
): Promise<void> {

  await injectTemplate(
    config,
    `./${config.temp.path}/${tempSubpath}/${componentName}${
      config.build.script.extension
    }`,
    labelPrefix
  );
}

/**
 * Finalize the module.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function finalizeModule(
  config: IConfig,
  componentName: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'finalize';


  try {
    logTaskStarting(subTaskLabel, labelPrefix);

    await copy(
      `./${config.temp.path}/${tempSubpath}/${componentName}${
        config.build.module.extension
      }`,
      `./${config.dist.path}/${componentName}${config.build.module.extension}`
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Finalize the script.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function finalizeScript(
  config: IConfig,
  componentName: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'finalize';


  try {
    logTaskStarting(subTaskLabel, labelPrefix);

    const compiler = webpack({
      mode: 'none',
      entry: `./${config.temp.path}/${tempSubpath}/${componentName}${
        config.build.script.extension
      }`,
      output: {
        path: joinPaths(process.cwd(), config.dist.path),
        chunkFilename: `${componentName}.part-[id]${
          config.build.script.extension
        }`,
        filename: `${componentName}${config.build.script.extension}`
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

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Copy over other wanted files into the distribution folder.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function finalizeCopyFiles(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'copy files';


  try {
    logTaskStarting(subTaskLabel, labelPrefix);

    const files = await glob(['./README.md', './LICENSE']);
    await Promise.all(
      files.map(async (file) => copy(file, `./${config.dist.path}/${file}`))
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Create the package.json file for the distribution.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function finalizePackageJson(
  config: IConfig,
  componentName: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'package.json';


  try {
    logTaskStarting(subTaskLabel, labelPrefix);

    const fileContents = await readFile('./package.json', {
      encoding: 'utf8',
      flag: 'r'
    });
    const modifiedContent = {
      ...JSON.parse(fileContents),
      version: undefined,
      main: `${componentName}${config.build.module.extension}`
    };

    const updatedContent = Object.keys(modifiedContent)
      .filter(
        (key) =>
          !['scripts', 'directories', 'devDependencies', 'engines'].includes(
            key
          )
      )
      .reduce<INodePackage>((reducedContent, key) => {
        return {
          ...reducedContent,
          [key]: modifiedContent[key]
        };
      }, {});

    const destDir = `./${config.dist.path}`;
    await ensureDir(destDir);
    await writeFile(
      `${destDir}/package.json`,
      JSON.stringify(updatedContent, undefined, 2)
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Get the build ready for distribution.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function finalize(
  config: IConfig,
  componentName: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'finalize';


  try {
    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    await runTasksParallel([
      finalizeCopyFiles(config, subTaskLabelPrefix),
      finalizePackageJson(config, componentName, subTaskLabelPrefix)
    ]);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Build symlinks at the root of the project to the distribution files.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function buildSymlinks(
  config: IConfig,
  componentName: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'symlinks';


  try {
    logTaskStarting(subTaskLabel, labelPrefix);

    const files = await glob(`./${config.dist.path}/${componentName}**.?(m)js`);

    await Promise.all(
      files.map(async (file) => {
        const outFile = `./${getFileBasename(file)}`;
        if (existsSync(outFile)) {
          await del(outFile);
        }
        await symlink(file, outFile, 'file');
      })
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}


//#region Helper Functions

/**
 * Get the indexes of the imports and exports out of the parse code.
 *
 * Note: Bundled imports will not be returned.
 *
 * @param program - The parsed code.
 */
function getImportsAndExports(
  config: IConfig,
  program: Program
): {
  readonly esImports: ReadonlyArray<number>;
  readonly esExports: ReadonlyArray<number>;
} {

  // Get info about the code.
  const [esImports, esExports] = Array.from(program.body.entries())
    .reduce<ImportsAndExportsWrapper>(
      (reducedDetails, nodeInfo) => {
        const [nodeIndex, node] = nodeInfo;

        switch (node.type) {
          case 'ImportDeclaration':
            // Don't process imports that are to be bundled.
            if (config.build.script.bundleImports) {
              return reducedDetails;
            }

            ensureProcessableImport(node);
            return [[...reducedDetails[0], nodeIndex], reducedDetails[1]];

          case 'ExportNamedDeclaration':
            return [reducedDetails[0], [...reducedDetails[1], nodeIndex]];

          default:
            return reducedDetails;
        }
      },
      [[], []]
    );

  return {
    esImports,
    esExports
  };
}

/**
 * Ensure the given import declaration is processable.
 * If it is not, an error will be thrown.
 */
function ensureProcessableImport(importDeclaration: ImportDeclaration): void {
  importDeclaration.specifiers.forEach(
    (specifier): void => {
      const importedName =
        specifier.type === 'ImportDefaultSpecifier'
          ? specifier.local.name
          : specifier.type === 'ImportSpecifier'
            ? specifier.imported.name
            : undefined;

      if (importedName === undefined) {
        throw new Error(
          `Cannot automatically process import declaration specifier.`
        );
      }
      // tslint:disable-next-line:early-exit
      if (
        !importedName
          .toLowerCase()
          .startsWith('catalyst')
      ) {
        throw new Error(
          `Cannot automatically process import "${importedName}".`
        );
      }
    }
  );
}

/**
 * Replace catalyst element's imports with globally accessible object import.
 *
 * @param program
 *   The parsed code
 * @param esImports
 *   Where the es imports are the parsed code's body.
 */
function processImports(
  program: Program,
  esImports: ReadonlyArray<number>
): Program {
  const updatedBody = esImports.reduce((reducedBody, index) => {
    const declaration = reducedBody[index] as ImportDeclaration;
    return declaration.specifiers.reduce(
      (reducedBodyInfo, specifier) => {
        if (specifier.type === 'ImportDefaultSpecifier') {
          throw new Error(
            `Cannot automatically process default imports - "${
              specifier.local.name
            }."`
          );
        }
        if (specifier.type === 'ImportNamespaceSpecifier') {
          throw new Error(
            `Cannot automatically process namespace imports - "${
              specifier.local.name
            }."`
          );
        }

        const localName = specifier.local.name;
        const importedName = specifier.imported.name;

        if (
          !importedName
            .toLowerCase()
            .startsWith('catalyst')
        ) {
          throw new Error(
            `Cannot automatically process import "${importedName}."`
          );
        }

        const importReplacement = parseScript(
          `const ${localName} = window.CatalystElements.${importedName};`
        ).body;
        const offsetIndex = index + reducedBodyInfo.offset;

        return {
          offset: reducedBodyInfo.offset + importReplacement.length - 1,
          body: [
            ...reducedBodyInfo.body.slice(0, offsetIndex),
            ...importReplacement,
            ...reducedBodyInfo.body.slice(offsetIndex + 1)
          ]
        };
      },
      {
        offset: 0,
        body: reducedBody
      }
    ).body;
  }, program.body);

  return {
    ...program,
    body: updatedBody
  };
}

/**
 * Process an export with specifiers (without a declaration).
 */
function processExportWithSpecifiers(
  specifiers: ReadonlyArray<ExportSpecifier>,
  body: IExportDetails['body'],
  exportNamesProcessed: IExportDetails['exportNamesProcessed'],
  index: number
): IExportDetails {
  return specifiers.reduce(
    (reducedBody, specifier) => {
      const localName = specifier.local.name;
      const exportedName = specifier.exported.name;

      // Already processed? skip.
      if (reducedBody.exportNamesProcessed[exportedName]) {
        return reducedBody;
      }

      // Generate replacement.
      const exportReplacement = parseScript(
        `window.CatalystElements.${exportedName} = ${localName};`
      ).body;
      const offsetIndex = index + reducedBody.offset;

      // Update.
      return {
        exportNamesProcessed: {
          ...reducedBody.exportNamesProcessed,
          [exportedName]: true
        },
        offset: reducedBody.offset + exportReplacement.length - 1,
        body: [
          ...reducedBody.body.slice(0, offsetIndex),
          ...exportReplacement,
          ...reducedBody.body.slice(offsetIndex + 1)
        ]
      };
    },
    {
      exportNamesProcessed,
      offset: 0,
      body
    }
  );
}

/**
 * Process an export with a declaration.
 */
function processExportWithDeclaration(
  declaration: FunctionDeclaration | VariableDeclaration | ClassDeclaration,
  body: IExportDetails['body'],
  exportNamesProcessed: IExportDetails['exportNamesProcessed'],
  insertIndex: number
): IExportDetails {
  const declarations = (declaration.type !== 'VariableDeclaration'
    ? [declaration]
    : [...declaration.declarations]) as ReadonlyArray<
    FunctionDeclaration | ClassDeclaration | VariableDeclarator
  >;

  return declarations.reduce<IExportDetails>(
    (reducedBody, dec) => {
      if (dec.id === null) {
        throw new Error(
          `Cannot automatically process declaration (no id pressent)`
        );
      }
      if (dec.id.type !== 'Identifier') {
        throw new Error(
          `Cannot automatically process declaration of type ${dec.id.type}`
        );
      }

      // Already processed? skip.
      if (reducedBody.exportNamesProcessed[dec.id.name]) {
        return reducedBody;
      }

      // Generate replacement.
      const exportReplacement = parseScript(
        `window.CatalystElements.${dec.id.name} = ${dec.id.name};`
      ).body;
      const offsetIndex = insertIndex + reducedBody.offset;

      // Update.
      return {
        exportNamesProcessed: {
          ...reducedBody.exportNamesProcessed,
          [dec.id.name]: true
        },
        offset: reducedBody.offset + exportReplacement.length - 1,
        body: [
          ...reducedBody.body.slice(0, offsetIndex),
          ...exportReplacement,
          ...reducedBody.body.slice(offsetIndex + 1)
        ]
      };
    },
    {
      exportNamesProcessed,
      offset: 0,
      body
    }
  );
}

/**
 * Insert globally accessible object exports where es exports once were.
 *
 * @param program
 *   The parsed code.
 * @param esExports
 *   Where the es exports are in the parsed code's body.
 */
function processExports(
  program: Program,
  esExports: ReadonlyArray<number>
): Program {
  const updatedBody = esExports.reduce<IExportDetails>(
    (reducedDetails, index) => {
      const exportDef = reducedDetails.body[index] as ExportNamedDeclaration;
      const offsetIndex = index + reducedDetails.offset;

      if (exportDef.declaration == undefined) {
        return processExportWithSpecifiers(
          exportDef.specifiers,
          reducedDetails.body,
          reducedDetails.exportNamesProcessed,
          offsetIndex
        );
      }
      return processExportWithDeclaration(
        exportDef.declaration,
        reducedDetails.body,
        reducedDetails.exportNamesProcessed,
        offsetIndex
      );
    },
    {
      exportNamesProcessed: {},
      offset: 0,
      body: program.body
    }
  ).body;

  return {
    ...program,
    body: updatedBody as Array<Statement | ModuleDeclaration>
  };
}

//#endregion

//#region Types

type ImportsAndExportsWrapper = [Array<number>, Array<number>];

interface IExportDetails {
  readonly exportNamesProcessed: { readonly [key: string]: boolean };
  readonly offset: number;
  readonly body: ReadonlyArray<Statement | ModuleDeclaration>;
}

//#endregion
