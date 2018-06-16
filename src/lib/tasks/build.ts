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

  // tslint:disable-next-line:no-implicit-dependencies
} from 'estree';
import {
  copy,
  ensureDir,
  existsSync,
  readFile,
  symlink,
  writeFile
} from 'fs-extra';
import { minify as htmlMinifier } from 'html-minifier';
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
  cleanDist,
  getInjectRegExp,
  getWebpackPlugIns,
  glob,
  INodePackage,
  logTaskFailed,
  logTaskInfo,
  logTaskStarting,
  logTaskSuccessful,
  runAllPromises,
  UncertainEntryFileError
} from '../util';

// The temp path.
const tempSubpath = 'build';
const tempEntrypointFileBaseName = 'entrypoint';

const validMarkupFileTypes: ReadonlyArray<string> = ['.html', '.htm'];
const validStyleFileTypes: ReadonlyArray<string> = ['.css', '.sass', '.scss'];

/**
 * Get the local names of all the static imports in the given a JavaScript.
 *
 * @param javascript - The JavaScript
 */
function getStaticImportLocalNames(javascript: string): Array<string> {
  const program = parseModule(javascript);

  return program.body.reduce<Array<string>>((reducedImports, node) => {
    if (node.type !== 'ImportDeclaration') {
      return reducedImports;
    }
    return [
      ...reducedImports,
      ...node.specifiers.reduce<Array<string>>(
        (reducedSpecifierImports, specifier) => {
          if (
            !(
              specifier.type === 'ImportDefaultSpecifier' ||
              specifier.type === 'ImportSpecifier'
            ) ||
            specifier.local.type !== 'Identifier'
          ) {
            return reducedSpecifierImports;
          }
          return [...reducedSpecifierImports, specifier.local.name];
        },
        []
      )
    ];
  }, []);
}

/**
 * Check the source files are all good.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function checkSourceFiles(
  entrypoint: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'check source files';

  try {
    logTaskStarting(subTaskLabel, labelPrefix);

    const entrypointContent = await readFile(entrypoint, {
      encoding: 'utf8',
      flag: 'r'
    });
    const program = parseModule(entrypointContent);

    const defaultExports = program.body.reduce((reducedCount, node) => {
      if (node.type === 'ExportDefaultDeclaration') {
        return reducedCount + 1;
      }
      return reducedCount;
    }, 0);

    if (defaultExports > 0) {
      throw new Error(`Do not use default exports. ${defaultExports} found.`);
    }

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Prepare the entrypoint file.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function prepareEntrypoint(
  config: IConfig,
  entrypoint: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'prepare entrypoint';

  try {
    logTaskStarting(subTaskLabel, labelPrefix);

    const pathChange = getRelativePathBetween(
      `./${config.src.path}`,
      `./${config.temp.path}/${tempSubpath}`
    );

    const depthChange = pathChange
      .split('/')
      .reduce((reducedChange, segment) => {
        if (segment === '' || segment === '.') {
          return reducedChange;
        }
        return reducedChange + (segment === '..' ? -1 : 1);
      }, 0);

    const entrypointContent = await readFile(entrypoint, {
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

    const destDir = `./${config.temp.path}/${tempSubpath}`;
    await ensureDir(destDir);
    await writeFile(
      `${destDir}/${tempEntrypointFileBaseName}${getFileExtension(config.src
        .entrypoint as string)}`,
      updatedEntrypointContent
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Export the static imports in the entrypoint file.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function exportStaticImports(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'export static imports';

  try {
    if (!config.build.script.exportAllStaticImports) {
      logTaskInfo(
        `skipping ${subTaskLabel} - turned off in config.`,
        labelPrefix
      );

      return;
    }

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

    const staticImports = getStaticImportLocalNames(fileContent);
    const updatedFileContent = `${fileContent.trim()}\n
// Export all the imports.
export {\n  ${staticImports.join(',\n  ')}\n};\n`;

    await ensureDir(getDirName(file));
    await writeFile(file, updatedFileContent);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Process the source files before handling them off to be turned into the module/script.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function preprocessSourceFiles(
  config: IConfig,
  entrypoint: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'preprocess source files';

  try {
    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    await prepareEntrypoint(config, entrypoint, subTaskLabelPrefix);
    await exportStaticImports(config, subTaskLabelPrefix);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Minify HTML.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function minifyHTML(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = 'minify HTML';

  try {
    logTaskStarting(subTaskLabel, labelPrefix);

    const files = await glob(`./${config.src.path}/**/*.html`);
    if (files.length === 0) {
      logTaskInfo(`no html files.`, labelPrefix);
      logTaskSuccessful(subTaskLabel, labelPrefix);
      return;
    }

    files.forEach(async (file) => {
      const fileContent = await readFile(file, {
        encoding: 'utf8',
        flag: 'r'
      });
      const minified = htmlMinifier(
        fileContent,
        config.build.tools.htmlMinifier
      )
        .replace(/\n/g, '');

      const destDir = `./${config.temp.path}/${tempSubpath}`;
      await ensureDir(destDir);
      await writeFile(`${destDir}/${getFileBasename(file)}`, minified);
    });

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Compile CSS.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function compileCSS(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = 'compile CSS';

  try {
    if (
      config.src.template === undefined ||
      config.src.template.style === undefined
    ) {
      logTaskInfo(
        `skipping ${subTaskLabel} - no styles to compile.`,
        labelPrefix
      );
      return;
    }

    logTaskStarting(subTaskLabel, labelPrefix);

    const postcssPlugins =
      config.build.tools.postcss === undefined
        ? []
        : config.build.tools.postcss.plugins === undefined
          ? []
          : config.build.tools.postcss.plugins;
    const postcssOptions =
      config.build.tools.postcss === undefined
        ? undefined
        : config.build.tools.postcss.options;

    const styleFile = `${config.src.path}/${config.src.template.style}`;
    const fileExtension = getFileExtension(styleFile);

    const css =
      fileExtension === '.sass' || fileExtension === '.scss'
        ? await compileSass(styleFile)
        : await readFile(styleFile);

    const processedCss = await postcss(postcssPlugins)
      .process(css, postcssOptions);

    const finalizedCss = processedCss.css.replace(/\n/g, '');

    const destDir = `./${config.temp.path}/${tempSubpath}`;
    const destFilename = `${getFileBasename(
      config.src.template.style,
      getFileExtension(config.src.template.style)
    )}.css`;

    await ensureDir(destDir);
    await writeFile(`${destDir}/${destFilename}`, finalizedCss);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Compile a sass file.
 *
 * @returns The compiled css.
 */
async function compileSass(file: string): Promise<string> {
  const renderSass = promisify<(options: sass.Options) => Promise<sass.Result>>(
    sass.render.bind(sass)
  );
  return (await renderSass({
    file,
    outputStyle: 'expanded'
  })).css.toString('utf8');
}

/**
 * Create the module file.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function initializeModuleFile(
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

    const esLintRegExp = /^\s*\/\*+[\s\n\*]*eslint[ -]\S*\s*\*+\/\s*$/gm;
    const tsLintRegExp = /^\s*\/\/\s*tslint:.*$/gm;
    const nodeModulesScopeRegExp = new RegExp(
      `(../)*node_modules/${config.component.scope}/`,
      'g'
    );
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

    const destDir = `./${config.temp.path}/${tempSubpath}`;
    await ensureDir(destDir);
    await writeFile(
      `${destDir}/${componentName}${config.build.module.extension}`,
      updatedFileContent
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

type ImportsAndExportsWrapper = [Array<number>, Array<number>];

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

interface IExportDetails {
  readonly exportNamesProcessed: { readonly [key: string]: boolean };
  readonly offset: number;
  readonly body: ReadonlyArray<Statement | ModuleDeclaration>;
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
 * Build the es6 module version of the component.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function buildModule(
  config: IConfig,
  componentName: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'module';

  try {
    if (!config.build.module.create) {
      logTaskInfo(
        `skipping ${subTaskLabel} - turned off in config.`,
        labelPrefix
      );

      return;
    }

    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    await initializeModuleFile(config, componentName, subTaskLabelPrefix);
    await injectTemplateModule(config, componentName, subTaskLabelPrefix);
    await finalizeModule(config, componentName, subTaskLabelPrefix);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

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

    await runAllPromises([
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

/**
 * Build the component.
 */
export async function build(taskName: string, config: IConfig): Promise<void> {
  if (config.component.name === undefined) {
    throw new Error('Cannot build: `config.component.name` is not set.');
  }
  if (config.src.entrypoint === undefined) {
    throw new Error('Cannot build: `config.src.entrypoint` is not set.');
  }

  const entrypoint = `./${config.src.path}/${config.src.entrypoint}`;

  await cleanDist(config, taskName);
  await checkSourceFiles(entrypoint, taskName);
  await preprocessSourceFiles(config, config.component.name, taskName);
  await runAllPromises([
    minifyHTML(config, taskName),
    compileCSS(config, taskName)
  ]);
  await runAllPromises([
    buildModule(config, config.component.name, taskName),
    buildScript(config, config.component.name, taskName)
  ]);
  await finalize(config, config.component.name, taskName);
  await buildSymlinks(config, config.component.name, taskName);
}
