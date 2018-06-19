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
  ImportSpecifier,
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
  ExternalError,
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

/**
 * Build the component.
 */
export async function jobBuild(
  jobName: string,
  config: IConfig
): Promise<void> {
  return (
    config.component.name === undefined
    ? Promise.reject(new Error('Cannot build: `config.component.name` is not set.'))

    : config.src.entrypoint === undefined
    ? Promise.reject(new Error('Cannot build: `config.src.entrypoint` is not set.'))

    : build(
        jobName,
        config.component.name,
        `./${config.src.path}/${config.src.entrypoint}`,
        config
      )
  );
}

/**
 * Build the component.
 */
async function build(
  labelPrefix: string,
  componentName: string,
  srcEntrypoint: string,
  config: IConfig
): Promise<void> {
  const entrypoint = `entrypoint${getFileExtension(srcEntrypoint)}`;
  const srcPath = `./${config.src.path}`;
  const tempPath = `./${config.temp.path}/build`;
  const distPath = `./${config.dist.path}`;

  await clean(distPath, 'dist', labelPrefix);
  await runTaskCheckSourceFiles(labelPrefix, srcEntrypoint);
  await runTaskPrepareEntrypoint(labelPrefix, srcEntrypoint, entrypoint, srcPath, tempPath);
  await runTasksParallel([
    runTaskMinifyHTML(labelPrefix, srcPath, tempPath, config.build.tools.htmlMinifier),
    runTaskCompileCSS(labelPrefix, srcPath, tempPath, config.build.tools.postcss, config.src.template)
  ]);
  await runTaskBuildVersions(
    labelPrefix,
    config.build,
    entrypoint,
    componentName,
    config.src.template,
    config.component.scope,
    tempPath,
    distPath
  );
  await runTaskPostBuild(labelPrefix, componentName, config.build.module.extension, distPath);
}

//#region Task Runners

/**
 * Run the "check source files" task.
 */
async function runTaskCheckSourceFiles(
  labelPrefix: string,
  srcEntrypoint: string
): Promise<void> {
  const taskLabel = 'check source files';

  return runTask(
    taskCheckSourceFiles,
    [
      srcEntrypoint
    ],
    taskLabel,
    labelPrefix
  );
}

/**
 * Run the "prepare entrypoint" task.
 */
async function runTaskPrepareEntrypoint(
  labelPrefix: string,
  srcEntrypoint: string,
  entrypoint: string,
  srcPath: string,
  tempPath: string
): Promise<void> {
  const taskLabel = 'prepare entrypoint';

  return runTask(
    taskPrepareEntrypoint,
    [
      srcEntrypoint,
      entrypoint,
      srcPath,
      tempPath
    ],
    taskLabel,
    labelPrefix
  );
}

/**
 * Run the "minify HTML" task.
 */
async function runTaskMinifyHTML(
  labelPrefix: string,
  srcPath: string,
  tempPath: string,
  htmlMinifierOptions: IConfig['build']['tools']['htmlMinifier']
): Promise<void> {
  const taskLabel = 'minify HTML';

  const files = await glob(`${srcPath}/**/*.html`);

  return (
    files.length === 0
    ? skipTask(taskLabel, labelPrefix, 'no html files to minify')
    : runTask(
        taskMinifyHTML,
        [
          files,
          htmlMinifierOptions,
          tempPath
        ],
        taskLabel,
        labelPrefix
      )
  );
}

/**
 * Run the "compile CSS" task.
 */
async function runTaskCompileCSS(
  labelPrefix: string,
  srcPath: string,
  tempPath: string,
  postcssConfig: IConfig['build']['tools']['postcss'],
  template: IConfig['src']['template']
): Promise<void> {
  const taskLabel = 'compile CSS';

  return (
    template === undefined || template.style === undefined
    ? skipTask(taskLabel, labelPrefix, 'no styles to compile')
    : runTask(
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
        ],
        taskLabel,
        labelPrefix
      )
  );
}

/**
 * Run the "build" task.
 */
async function runTaskBuildVersions(
  labelPrefix: string,
  buildConfig: IConfig['build'],
  entrypoint: string,
  componentName: string,
  template: IConfig['src']['template'],
  nodeScope: string | undefined,
  tempPath: string,
  distPath: string
): Promise<void> {
  const taskLabel = 'type';

  return runTask(
    taskBuildVersions,
    [
      buildConfig,
      entrypoint,
      componentName,
      template,
      nodeScope,
      tempPath,
      distPath
    ],
    taskLabel,
    labelPrefix
  );
}

/**
 * Run the "post build" task.
 */
async function runTaskPostBuild(
  labelPrefix: string,
  componentName: string,
  moduleExtension: string,
  distPath: string
): Promise<void> {
  const taskLabel = 'post build';

  return runTask(
    taskPostBuild,
    [
      componentName,
      moduleExtension,
      distPath
    ],
    taskLabel,
    labelPrefix
  );
}

/**
 * Run the "build module" task.
 */
async function runTaskBuildModule(
  labelPrefix: string,
  createModule: boolean,
  entrypoint: string,
  componentName: string,
  moduleExtension: string,
  template: IConfig['src']['template'],
  nodeScope: string | undefined,
  tempPath: string,
  distPath: string
): Promise<void> {
  const taskLabel = 'module';
  return (
    !createModule
    ? skipTask(taskLabel, labelPrefix, 'Turned off in config.')
    : runTask(
        taskBuildModule,
        [
          entrypoint,
          componentName,
          moduleExtension,
          template,
          nodeScope,
          tempPath,
          distPath
        ],
        taskLabel,
        labelPrefix
      )
  );
}

/**
 * Run the "build script" task.
 */
async function runTaskBuildScript(
  labelPrefix: string,
  createScript: boolean,
  entrypoint: string,
  componentName: string,
  scriptExtension: string,
  template: IConfig['src']['template'],
  bundleImports: boolean,
  tempPath: string,
  distPath: string
): Promise<void> {
  const taskLabel = 'script';
  return (
    !createScript
    ? skipTask(taskLabel, labelPrefix, 'Turned off in config.')
    : runTask(
        taskBuildScript,
        [
          entrypoint,
          componentName,
          scriptExtension,
          template,
          bundleImports,
          tempPath,
          distPath
        ],
        taskLabel,
        labelPrefix
      )
  );
}

/**
 * Run the "initialize module file" task.
 */
async function runTaskInitializeModuleFile(
  labelPrefix: string,
  entrypoint: string,
  componentName: string,
  nodeScope: string | undefined,
  tempPath: string,
  moduleExtension: string
): Promise<void> {
  const taskLabel = 'initialize file';

  const files = await glob(
    `${tempPath}/${entrypoint}`
  );

  return (
    files.length !== 1
    ? Promise.reject(new UncertainEntryFileError())
    : runTask(
        taskInitializeModuleFile,
        [
          files[0],
          componentName,
          nodeScope,
          tempPath,
          moduleExtension
        ],
        taskLabel,
        labelPrefix
      )
  );
}

/**
 * Run the "initialize script file" task.
 */
async function runTaskInitializeScriptFile(
  labelPrefix: string,
  entrypoint: string,
  componentName: string,
  tempPath: string,
  scriptExtension: string,
  bundleImports: boolean
): Promise<void> {
  const taskLabel = 'initialize file';

  const files = await glob(
    `${tempPath}/${entrypoint}`
  );

  return (
    files.length !== 1
    ? Promise.reject(new UncertainEntryFileError())
    : runTask(
        taskInitializeScriptFile,
        [
          files[0],
          componentName,
          tempPath,
          scriptExtension,
          bundleImports
        ],
        taskLabel,
        labelPrefix
      )
  );
}

/**
 * Run the "inject template" task.
 */
async function runTaskInjectTemplate(
  labelPrefix: string,
  tempPath: string,
  targetFile: string,
  template: IConfig['src']['template']
): Promise<void> {
  const taskLabel = 'inject template';

  return (
    template === undefined
    ? skipTask(taskLabel, labelPrefix, 'No template files to inject.')
    : runTask(
        taskInjectTemplate,
        [
          tempPath,
          targetFile,
          template
        ],
        taskLabel,
        labelPrefix
      )
  );
}

/**
 * Run the "finalize module" task.
 */
async function runTaskFinalizeModule(
  labelPrefix: string,
  componentName: string,
  moduleExtension: string,
  tempPath: string,
  distPath: string
): Promise<void> {
  const taskLabel = 'finalize';

  return runTask(
    taskFinalizeModule,
    [
      componentName,
      moduleExtension,
      tempPath,
      distPath
    ],
    taskLabel,
    labelPrefix
  );
}

/**
 * Run the "finalize script" task.
 */
async function runTaskFinalizeScript(
  labelPrefix: string,
  componentName: string,
  scriptExtension: string,
  tempPath: string,
  distPath: string
): Promise<void> {
  const taskLabel = 'finalize';

  return runTask(
    taskFinalizeScript,
    [
      componentName,
      scriptExtension,
      tempPath,
      distPath
    ],
    taskLabel,
    labelPrefix
  );
}

/**
 * Run the "inject markup" task.
 */
async function runTaskInjectTemplateMarkup(
  labelPrefix: string,
  tempPath: string,
  markupFile: string | undefined,
  targetFile: string
): Promise<void> {
  const taskLabel = 'markup';

  return (
    markupFile === undefined
    ? skipTask(taskLabel, labelPrefix, 'no markup to inject.')
    : runTask(
        taskInjectTemplateMarkup,
        [
          tempPath,
          markupFile,
          targetFile
        ],
        taskLabel,
        labelPrefix
      )
  );
}

/**
 * Run the "inject style" task.
 */
async function runTaskInjectTemplateStyle(
  labelPrefix: string,
  tempPath: string,
  styleFile: string | undefined,
  targetFile: string
): Promise<void> {
  const taskLabel = 'style';

  return (
    styleFile === undefined
    ? skipTask(taskLabel, labelPrefix, 'no markup to inject.')
    : runTask(
        taskInjectTemplateStyle,
        [
          tempPath,
          styleFile,
          targetFile
        ],
        taskLabel,
        labelPrefix
      )
  );
}

/**
 * Run the "inject html" task.
 */
async function runTaskInjectTemplateHTML(
  labelPrefix: string,
  tempPath: string,
  targetFile: string,
  markupFile: string
): Promise<void> {
  const taskLabel = 'html';

  return runTask(
    taskInjectTemplateHTML,
    [
      tempPath,
      markupFile,
      targetFile
    ],
    taskLabel,
    labelPrefix
  );
}

/**
 * Run the "inject css" task.
 */
async function runTaskInjectTemplateCSS(
  labelPrefix: string,
  tempPath: string,
  targetFile: string,
  styleFile: string
): Promise<void> {
  const taskLabel = 'css';

  return runTask(
    taskInjectTemplateCSS,
    [
      tempPath,
      targetFile,
      styleFile
    ],
    taskLabel,
    labelPrefix
  );
}

/**
 * Run the "copy extra dist files" task.
 */
async function runTaskDistributionCopyFiles(
  labelPrefix: string,
  distPath: string
): Promise<void> {
  const taskLabel = 'copy files';

  return runTask(
    taskDistributionCopyFiles,
    [
      distPath
    ],
    taskLabel,
    labelPrefix
  );
}

/**
 * Run the "dist package.json" task.
 */
async function runTaskDistributionPackageJson(
  labelPrefix: string,
  componentName: string,
  moduleExtension: string,
  distPath: string
): Promise<void> {
  const taskLabel = 'package.json';

  return runTask(
    taskDistributionPackageJson,
    [
      componentName,
      moduleExtension,
      distPath
    ],
    taskLabel,
    labelPrefix
  );
}

/**
 * Run the "build symlinks" task.
 */
async function runTaskBuildSymlinks(
  labelPrefix: string,
  componentName: string,
  distPath: string
): Promise<void> {
  const taskLabel = 'symlinks';

  return runTask(
    taskBuildSymlinks,
    [
      componentName,
      distPath
    ],
    taskLabel,
    labelPrefix
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

  const defaultExports = program.body.reduce(
    (reducedCount, node) =>
      node.type === 'ExportDefaultDeclaration'
      ? reducedCount + 1
      : reducedCount,
    0
  );

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
  const pathChange = getRelativePathBetween(`${srcPath}`, tempPath);
  const depthChange = pathChange
    .split('/')
    .reduce(
      (reducedChange, segment) =>
        segment === '' || segment === '.'
        ? reducedChange
        : segment === '..'
        ? reducedChange - 1
        : reducedChange + 1,
      0
    );

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
 * Task: Build all the versions of the component.
 */
async function taskBuildVersions(
  labelPrefix: string,
  buildConfig: IConfig['build'],
  entrypoint: string,
  componentName: string,
  template: IConfig['src']['template'],
  nodeScope: string | undefined,
  tempPath: string,
  distPath: string
): Promise<void> {
  await runTasksParallel([
    runTaskBuildModule(
      labelPrefix,
      buildConfig.module.create,
      entrypoint,
      componentName,
      buildConfig.module.extension,
      template,
      nodeScope,
      tempPath,
      distPath
    ),
    runTaskBuildScript(
      labelPrefix,
      buildConfig.script.create,
      entrypoint,
      componentName,
      buildConfig.script.extension,
      template,
      buildConfig.script.bundleImports,
      tempPath,
      distPath
    )
  ]);
}

/**
 * Task: Post build tasks.
 */
async function taskPostBuild(
  labelPrefix: string,
  componentName: string,
  moduleExtension: string,
  distPath: string
): Promise<void> {
  // Get the build ready for distribution.
  await runTasksParallel([
    runTaskDistributionCopyFiles(labelPrefix, distPath),
    runTaskDistributionPackageJson(labelPrefix, componentName, moduleExtension, distPath)
  ]);

  await runTaskBuildSymlinks(labelPrefix, componentName, distPath);
}

/**
 * Task: Build the es module version of the component.
 */
async function taskBuildModule(
  labelPrefix: string,
  entrypoint: string,
  componentName: string,
  moduleExtension: string,
  template: IConfig['src']['template'],
  nodeScope: string | undefined,
  tempPath: string,
  distPath: string
): Promise<void> {
  await runTaskInitializeModuleFile(
    labelPrefix,
    entrypoint,
    componentName,
    nodeScope,
    tempPath,
    moduleExtension
  );
  await runTaskInjectTemplate(
    labelPrefix,
    tempPath,
    `${tempPath}/${componentName}${moduleExtension}`,
    template
  );
  await runTaskFinalizeModule(
    labelPrefix,
    componentName,
    moduleExtension,
    tempPath,
    distPath
  );
}

/**
 * Task: Build the es5 script version of the component.
 */
async function taskBuildScript(
  labelPrefix: string,
  entrypoint: string,
  componentName: string,
  scriptExtension: string,
  template: IConfig['src']['template'],
  bundleImports: boolean,
  tempPath: string,
  distPath: string
): Promise<void> {
  await runTaskInitializeScriptFile(
    labelPrefix,
    entrypoint,
    componentName,
    tempPath,
    scriptExtension,
    bundleImports
  );
  await runTaskInjectTemplate(
    labelPrefix,
    tempPath,
    `${tempPath}/${componentName}${scriptExtension}`,
    template
  );
  await runTaskFinalizeScript(
    labelPrefix,
    componentName,
    scriptExtension,
    tempPath,
    distPath
  );
}

/**
 * Task: Create the file for the es module version of the component.
 */
async function taskInitializeModuleFile(
  _labelPrefix: string,
  srcEntrypoint: string,
  componentName: string,
  nodeScope: string | undefined,
  tempPath: string,
  moduleExtension: string
): Promise<void> {
  const fileContent = await readFile(srcEntrypoint, {
    encoding: 'utf8',
    flag: 'r'
  });

  const esLintRegExp = /^\s*\/\*+[\s\n\*]*eslint[ -]\S*\s*\*+\/\s*$/gm;
  const tsLintRegExp = /^\s*\/\/\s*tslint:.*$/gm;
  const nodeModulesScopeRegExp =
    nodeScope === undefined
    ? undefined
    : new RegExp(`(../)*node_modules/${nodeScope}/`, 'g');
  const nodeModulesRegExp = new RegExp(`(../)*node_modules/`, 'g');

  const updatedFileContent =
    nodeModulesScopeRegExp === undefined
    ? `${fileContent
          // Strip eslint and tslint comments.
          .replace(esLintRegExp, '')
          .replace(tsLintRegExp, '')

          // Correct `node_modules` links.
          .replace(nodeModulesRegExp, '../../')

          // Trim extra white space.
          .trim()

        // End with a newline.
      }\n`
    : `${fileContent
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

/**
 * Task: Create the file for the es5 script version of the component.
 */
async function taskInitializeScriptFile(
  _labelPrefix: string,
  srcEntrypoint: string,
  componentName: string,
  tempPath: string,
  scriptExtension: string,
  bundleImports: boolean
): Promise<void> {
  const fileContent = await readFile(srcEntrypoint, {
    encoding: 'utf8',
    flag: 'r'
  });

  const program = parseModule(fileContent);
  const importsAndExports = getImportsAndExports(program, bundleImports);

  return (
    importsAndExports instanceof Error
    ? Promise.reject(importsAndExports)
    : taskInitializeScriptFilePart2(
        program,
        importsAndExports.esImports,
        importsAndExports.esExports,
        componentName,
        tempPath,
        scriptExtension
      )
  );
}

/**
 * Continuation of `taskInitializeScriptFile`.
 */
async function taskInitializeScriptFilePart2(
  program: Program,
  esImports: ImportsAndExports['0'],
  esExports: ImportsAndExports['1'],
  componentName: string,
  tempPath: string,
  scriptExtension: string
): Promise<void> {
  const updatedProgram = processImports(program, esImports);
  return (
    updatedProgram instanceof Error
    ? Promise.reject(updatedProgram)
    : taskInitializeScriptFilePart3(
        updatedProgram,
        esExports,
        componentName,
        tempPath,
        scriptExtension
      )
  );
}

/**
 * Continuation of `taskInitializeScriptFile`.
 */
async function taskInitializeScriptFilePart3(
  program: Program,
  esExports: ImportsAndExports['1'],
  componentName: string,
  tempPath: string,
  scriptExtension: string
): Promise<void> {
  const updatedProgram = processExports(program, esExports);
  return (
    updatedProgram instanceof Error
    ? Promise.reject(updatedProgram)
    : taskInitializeScriptFilePart4(
        updatedProgram,
        componentName,
        tempPath,
        scriptExtension
      )
  );
}

/**
 * Continuation of `taskInitializeScriptFile`.
 */
async function taskInitializeScriptFilePart4(
  program: Program,
  componentName: string,
  tempPath: string,
  scriptExtension: string
): Promise<void> {
  const updatedSourceCode =
    `window.CatalystElements = window.CatalystElements || {};\n'${generateJS(
      program
    )}`;

  await ensureDir(tempPath);
  await writeFile(
    `${tempPath}/${componentName}${scriptExtension}`,
    updatedSourceCode
  );
}

/**
 * Task: Inject the template into the element.
 */
async function taskInjectTemplate(
  labelPrefix: string,
  tempPath: string,
  targetFile: string,
  template: Exclude<IConfig['src']['template'], undefined>
): Promise<void> {
  await runTaskInjectTemplateMarkup(labelPrefix, tempPath, template.markup, targetFile);
  await runTaskInjectTemplateStyle(labelPrefix, tempPath, template.style, targetFile);
}

/**
 * Task: Finalize the module.
 */
async function taskFinalizeModule(
  componentName: string,
  moduleExtension: string,
  tempPath: string,
  distPath: string
): Promise<void> {
  await copy(
    `${tempPath}/${componentName}${moduleExtension}`,
    `${distPath}/${componentName}${moduleExtension}`
  );
}

/**
 * Task: Finalize the script.
 */
async function taskFinalizeScript(
  componentName: string,
  scriptExtension: string,
  tempPath: string,
  distPath: string
): Promise<void> {
  const compiler = webpack({
    mode: 'none',
    entry: `${tempPath}/${componentName}${scriptExtension}`,
    output: {
      path: joinPaths(process.cwd(), distPath),
      chunkFilename: `${componentName}.part-[id]${scriptExtension}`,
      filename: `${componentName}${scriptExtension}`
    },
    resolve: {
      extensions: ['.js', '.mjs']
    },
    plugins: getWebpackPlugIns(),
    target: 'web'
  });

  const runCompiler = promisify(compiler.run.bind(compiler) as typeof compiler.run);
  const stats = await runCompiler();

  console.info(
    stats.toString({
      chunks: false,
      colors: true
    })
  );
}

/**
 * Task: Inject the template markup.
 */
async function taskInjectTemplateMarkup(
  labelPrefix: string,
  tempPath: string,
  markupFile: string,
  targetFile: string
): Promise<void> {
  const fileExtension = getFileExtension(markupFile);

  return (
    !validMarkupFileTypes.includes(fileExtension)
    ? Promise.reject(new Error(`Cannot process markup files of type "${fileExtension}"`))
    : runTaskInjectTemplateHTML(
        labelPrefix,
        tempPath,
        targetFile,
        markupFile
      )
  );
}

/**
 * Task: Inject the template style.
 */
async function taskInjectTemplateStyle(
  labelPrefix: string,
  tempPath: string,
  markupFile: string,
  targetFile: string
): Promise<void> {
  const fileExtension = getFileExtension(markupFile);

  return (
    !validStyleFileTypes.includes(fileExtension)
    ? Promise.reject(new Error(`Cannot process style files of type "${fileExtension}"`))
    : runTaskInjectTemplateCSS(
        labelPrefix,
        tempPath,
        targetFile,
        markupFile
      )
  );
}

/**
 * Task: Inject the template html.
 */
async function taskInjectTemplateHTML(
  _labelPrefix: string,
  tempPath: string,
  markupFile: string,
  targetFile: string
): Promise<void> {
  const htmlFile = `${tempPath}/${markupFile}`;

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
}

/**
 * Task: Inject the template css.
 */
async function taskInjectTemplateCSS(
  _labelPrefix: string,
  tempPath: string,
  targetFile: string,
  styleFile: string
): Promise<void> {
  const styleFileBasename = getFileBasename(styleFile);
  const cssFile = `${tempPath}/${styleFileBasename}.css`;

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
}

/**
 * Task: Copy over other wanted files into the distribution folder.
 */
async function taskDistributionCopyFiles(
  _labelPrefix: string,
  distPath: string
): Promise<void> {
  // TODO: extrat out to config.
  const filesToCopy = [
    './README.md',
    './LICENSE'
  ];
  const files = await glob(filesToCopy);

  await Promise.all(
    files.map(async (file) => copy(file, `${distPath}/${file}`))
  );
}

/**
 * Task: Create the package.json file for the distribution.
 */
async function taskDistributionPackageJson(
  _labelPrefix: string,
  componentName: string,
  moduleExtension: string,
  distPath: string
): Promise<void> {
  const fileContents = await readFile('./package.json', {
    encoding: 'utf8',
    flag: 'r'
  });

  const modifiedContent = {
    ...JSON.parse(fileContents),
    version: undefined,
    main: `${componentName}${moduleExtension}`
  };

  const updatedContent = Object.keys(modifiedContent)
    .filter(
      (key) =>
        !['scripts', 'directories', 'devDependencies', 'engines'].includes(
          key
        )
    )
    .reduce<INodePackage>((reducedContent, key) => ({
      ...reducedContent,
      [key]: modifiedContent[key]
    }), {});

  await ensureDir(distPath);
  await writeFile(
    `${distPath}/package.json`,
    JSON.stringify(updatedContent, undefined, 2)
  );
}

/**
 * Task: Build symlinks at the root of the project to the distribution files.
 */
async function taskBuildSymlinks(
  _labelPrefix: string,
  componentName: string,
  distPath: string
): Promise<void> {
  const files = await glob(`${distPath}/${componentName}**.?(m)js`);

  await Promise.all(
    files.map(async (file) => {
      const outFile = `./${getFileBasename(file)}`;
      await del(outFile)
        .finally(async () => {
          await symlink(file, outFile, 'file');
        });
    })
  );
}

//#endregion

//#region Helper Functions

/**
 * Get the indexes of the imports and exports out of the parse code.
 *
 * Note: Imports will be empty if they are to be bundled.
 */
function getImportsAndExports(
  program: Program,
  bundleImports: boolean
): {
  readonly esImports: Array<number>;
  readonly esExports: Array<number>;
} {
  const [esImports, esExports] = Array.from(program.body.entries())
    .reduce<ImportsAndExports>(
      (reduced, nodeInfo) => {
        const [nodeIndex, node] = nodeInfo;

        return processNodeForImportsAndExports(
          reduced,
          node,
          nodeIndex,
          bundleImports
        );
      },
      [[], []]
    );

  return {
    esImports,
    esExports
  };
}

/**
 * Check if a node is and import or export.
 * If it is, return an updated version of `importsAndExports`.
 */
function processNodeForImportsAndExports(
  importsAndExports: ImportsAndExports,
  node: Program['body'][0],
  index: number,
  bundleImports: boolean
): ImportsAndExports {
  switch (node.type) {
    case 'ImportDeclaration':
      return (
        // Don't process imports if they are to be bundled.
        bundleImports
        ? importsAndExports
        // Mark this index as an import.
        : [[...importsAndExports[0], index], importsAndExports[1]]
      );

    case 'ExportNamedDeclaration':
      return [importsAndExports[0], [...importsAndExports[1], index]];

    default:
      return importsAndExports;
  }
}

/**
 * Check if the given import declaration is processable by this job.
 */
function isProcessableImport(
  importDeclaration: ImportDeclaration
): undefined | Error {
  return importDeclaration.specifiers.reduce<undefined | Error>(
    (reduced, specifier) =>
      reduced instanceof Error
      ? reduced
      : specifier.type === 'ImportNamespaceSpecifier'
      ? new ExternalError(`Cannot automatically process import declaration namespace specifiers.`)
      : specifier.type === 'ImportDefaultSpecifier'
      ? new ExternalError(`Do not use default imports. "${specifier.local.name}".`)
      : (
          specifier.type === 'ImportSpecifier' &&
          !specifier.imported.name
            .toLowerCase()
            .startsWith('catalyst')
        )
      ? new ExternalError(`Cannot automatically process import "${specifier.imported.name}".`)
      : undefined,
    undefined
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
): Program | Error {
  const updatedBody =
    esImports.reduce<Program['body'] | Error>(
      (reduced, index) =>
        reduced instanceof Error
        ? reduced
        : reduced[index].type !== 'ImportDeclaration'
        ? new Error('Non-ImportDeclaration node given as ImportDeclaration node.')
        : processImportsPart2(reduced, reduced[index] as ImportDeclaration, index),
      program.body
    );

  return (
    updatedBody instanceof Error
    ? updatedBody
    : {
        ...program,
        body: updatedBody
      }
  );
}

/**
 * Continuation of processImports.
 * Separate the updated body from the meta data with it.
 */
function processImportsPart2(
  body: Program['body'],
  importDeclaration: ImportDeclaration,
  index: number
): Program['body'] | Error {
  const updatedBody = importDeclaration.specifiers.reduce<IImportDetails | Error>(
    (reduced, specifier) =>
      reduced instanceof Error
      ? reduced
      : processImportsPart3(importDeclaration, specifier, index, reduced.offset, reduced.body),
    {
      offset: 0,
      body
    }
  );

  return (
    updatedBody instanceof Error
    ? updatedBody
    : updatedBody.body
  );
}

/**
 * Continuation of processImports.
 * Process the import.
 */
function processImportsPart3(
  importDeclaration: ImportDeclaration,
  specifier: ImportDeclaration['specifiers'][0],
  index: number,
  offset: number,
  body: Program['body']
): IImportDetails | Error {
  const processableError = isProcessableImport(importDeclaration);

  return (
    processableError !== undefined
    ? processableError
    : processImportsPart4(
        (specifier as ImportSpecifier).local.name,
        (specifier as ImportSpecifier).imported.name,
        index,
        offset,
        body
      )
  );
}

/**
 * Continuation of processImports.
 * Get the updated body.
 */
function processImportsPart4(
  localImportName: string,
  originalImportName: string,
  index: number,
  offset: number,
  body: Program['body']
): IImportDetails {
  const importReplacement = parseScript(
    `const ${localImportName} = window.CatalystElements.${originalImportName};`
  ).body;

  return {
    offset: offset + importReplacement.length - 1,
    body: [
      ...body.slice(0, index + offset),
      ...importReplacement,
      ...body.slice(index + offset + 1)
    ]
  };
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
): Program | Error {
  const updatedBody = esExports.reduce<IExportDetails | Error>(
    (reduced, index) =>
      reduced instanceof Error
      ? reduced
      : processExportsPart2(
          reduced.body[index] as ExportNamedDeclaration,
          index,
          reduced.exportNamesProcessed,
          reduced.body,
          reduced.offset
        ),
    {
      exportNamesProcessed: {},
      offset: 0,
      body: program.body
    }
  );

  return (
    updatedBody instanceof Error
    ? updatedBody
    : {
        ...program,
        body: updatedBody.body
      }
  );
}

function processExportsPart2(
  exportDef: ExportNamedDeclaration,
  index: number,
  exportNamesProcessed: IExportDetails['exportNamesProcessed'],
  body: IExportDetails['body'],
  offset: number
): IExportDetails | Error {
  return (
    exportDef.declaration == undefined
    ? processExportWithSpecifiers(
        exportDef.specifiers,
        body,
        exportNamesProcessed,
        index + offset
      )
    : processExportWithDeclaration(
        exportDef.declaration,
        body,
        exportNamesProcessed,
        index + offset
      )
  );
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
    (reduced, specifier) =>
      reduced.exportNamesProcessed[specifier.exported.name]
      ? reduced
      : processExportWithSpecifiersPart2(
          specifier.local.name,
          specifier.exported.name,
          index,
          reduced.exportNamesProcessed,
          reduced.offset,
          reduced.body
        ),
    {
      exportNamesProcessed,
      offset: 0,
      body
    }
  );
}

/**
 * Continuation of `processExportWithSpecifiers`.
 */
function processExportWithSpecifiersPart2(
  localName: string,
  exportedName: string,
  index: number,
  exportNamesProcessed: IExportDetails['exportNamesProcessed'],
  offset: number,
  body: Program['body']
): IExportDetails {
  // Generate replacement.
  const exportReplacement = parseScript(
    `window.CatalystElements.${exportedName} = ${localName};`
  ).body;

  // Update.
  return {
    exportNamesProcessed: {
      ...exportNamesProcessed,
      [exportedName]: true
    },
    offset: offset + exportReplacement.length - 1,
    body: [
      ...body.slice(0, index + offset),
      ...exportReplacement,
      ...body.slice(index + offset + 1)
    ]
  };
}

/**
 * Process an export with a declaration.
 */
function processExportWithDeclaration(
  declaration: FunctionDeclaration | VariableDeclaration | ClassDeclaration,
  body: IExportDetails['body'],
  exportNamesProcessed: IExportDetails['exportNamesProcessed'],
  insertIndex: number
): IExportDetails | Error {
  const declarations: Array<FunctionDeclaration | ClassDeclaration | VariableDeclarator> = (
    declaration.type !== 'VariableDeclaration'
    ? [declaration]
    : [...declaration.declarations]
  );

  return declarations.reduce<IExportDetails | Error>(
    (reduced, dec) =>
      reduced instanceof Error
      ? reduced
      : dec.id === null
      ? new Error(`Cannot automatically process declaration (no id pressent)`)
      : dec.id.type !== 'Identifier'
      ? new Error(`Cannot automatically process declaration of type ${dec.id.type}`)
      : reduced.exportNamesProcessed[dec.id.name]
      ? reduced
      : processExportWithDeclarationPart2(
          dec.id.name,
          insertIndex,
          reduced.exportNamesProcessed,
          reduced.offset,
          reduced.body
        ),
    {
      exportNamesProcessed,
      offset: 0,
      body
    }
  );
}

/**
 * Continuation of `processExportWithDeclaration`
 */
function processExportWithDeclarationPart2(
  declarationName: string,
  insertIndex: number,
  exportNamesProcessed: IExportDetails['exportNamesProcessed'],
  offset: number,
  body: IExportDetails['body']
): IExportDetails | Error {
  // Generate replacement.
  const exportReplacement = parseScript(
    `window.CatalystElements.${declarationName} = ${declarationName};`
  ).body;

  // Update.
  return {
    exportNamesProcessed: {
      ...exportNamesProcessed,
      [declarationName]: true
    },
    offset: offset + exportReplacement.length - 1,
    body: [
      ...body.slice(0, insertIndex + offset),
      ...exportReplacement,
      ...body.slice(insertIndex + offset + 1)
    ]
  };
}

//#endregion

//#region Types

type ImportsAndExports = [Array<number>, Array<number>];

interface IImportDetails {
  readonly offset: number;
  readonly body: Program['body'];
}

interface IExportDetails {
  readonly exportNamesProcessed: { readonly [key: string]: boolean };
  readonly offset: number;
  readonly body: Array<Statement | ModuleDeclaration>;
}

//#endregion
