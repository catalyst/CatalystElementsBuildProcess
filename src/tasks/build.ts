// Libraries.
import escodegen from 'escodegen';
import esprima, { Program } from 'esprima';
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
import { copyFile, readFile, symlink, writeFile } from 'fs/promises';
import { minify as htmlMinifier } from 'html-minifier';
import sass from 'node-sass';
import {
  basename as getFileBasename,
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
  runAllPromises,
  tasksHelpers
} from '../util';

// The temp path.
const tempSubpath = 'build';
const tempEntrypointFileBaseName = 'entrypoint';

/**
 * Get the local names of all the static imports in the given a JavaScript.
 *
 * @param javascript - The JavaScript
 */
function getStaticImportLocalNames(javascript: string): ReadonlyArray<string> {
  const program = esprima.parseModule(javascript);

  return program.body.reduce(
    (imports, node) => {
      if (node.type !== 'ImportDeclaration') {
        return imports;
      }
      return [
        ...imports,
        ...node.specifiers.reduce(
          (specifierImports, specifier) => {
            if (
              !(
                specifier.type === 'ImportDefaultSpecifier' ||
                specifier.type === 'ImportSpecifier'
              ) ||
              specifier.local.type !== 'Identifier'
            ) {
              return specifierImports;
            }
            return [...specifierImports, specifier.local.name];
          },
          [] as ReadonlyArray<string>
        )
      ];
    },
    [] as ReadonlyArray<string>
  );
}

/**
 * Check the source files are all good.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function checkSourceFiles(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'check source files';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const entrypoint = await readFile(
      `./${config.src.path}/${config.src.entrypoint}`,
      {
        encoding: 'utf8',
        flag: 'r'
      }
    );
    const program = esprima.parseModule(entrypoint);

    for (const node of program.body) {
      if (node.type === 'ExportDefaultDeclaration') {
        throw new Error('Do not use default exports.');
      }
    }

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
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
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'prepare entrypoint';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const pathChange = getRelativePathBetween(
      `./${config.src.path}`,
      `./${config.temp.path}/${tempSubpath}`
    );

    const depthChange = pathChange.split('/').reduce((change, segment) => {
      if (segment === '' || segment === '.') {
        return change;
      }
      return change + (segment === '..' ? -1 : 1);
    }, 0);

    const fileContent = await readFile(
      `./${config.src.path}/${config.src.entrypoint}`,
      {
        encoding: 'utf8',
        flag: 'r'
      }
    );

    const updatedFileContent =
      depthChange <= 0
        ? fileContent
        : fileContent.replace(
            new RegExp(`\\.\\./${config.nodeModulesPath}/`, 'g'),
            `${'../'.repeat(depthChange + 1)}${config.nodeModulesPath}/`
          );

    await writeFile(
      `./${
        config.temp.path
      }/${tempSubpath}/${tempEntrypointFileBaseName}${getFileExtension(config
        .src.entrypoint as string)}`,
      updatedFileContent
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
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
      tasksHelpers.log.info(
        `skipping ${subTaskLabel} - turned off in config.`,
        labelPrefix
      );

      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const files = await glob(
      `./${
        config.temp.path
      }/${tempSubpath}/**/${tempEntrypointFileBaseName}${getFileExtension(config
        .src.entrypoint as string)}`
    );

    if (files.length !== 1) {
      throw new Error('Internal error: Cannot determin entryfile.');
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

    await writeFile(file, updatedFileContent);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
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
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'preprocess source files';

  try {
    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await prepareEntrypoint(config, subTaskLabelPrefix);
    await exportStaticImports(config, subTaskLabelPrefix);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
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
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const files = await glob(`./${config.src.path}/**/*.html`);
    if (files.length === 0) {
      tasksHelpers.log.info(`no html files.`, labelPrefix);
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      return;
    }

    files.map(async file => {
      const fileContent = await readFile(file, {
        encoding: 'utf8',
        flag: 'r'
      });
      const minified = htmlMinifier(
        fileContent,
        config.build.tools.htmlMinifier
      ).replace(/\n/g, '');

      await writeFile(
        `./${config.temp.path}/${tempSubpath}/${getFileBasename(file)}`,
        minified
      );
    });

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Compile Sass.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function compileSASS(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'compile SASS';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

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

    const files = await glob(`./${config.src.path}/**/*.scss`);
    if (files.length === 0) {
      tasksHelpers.log.info(`no sass files.`, labelPrefix);
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      return;
    }

    files.map(async file => {
      const renderSass: (
        options: sass.Options
      ) => Promise<sass.Result> = promisify(sass.render.bind(sass));
      const css = (await renderSass({
        file,
        outputStyle: 'expanded'
      })).css.toString('utf8');
      const processedCss = await postcss(...postcssPlugins).process(
        css,
        postcssOptions
      );
      const finalizedCss = processedCss.css.replace(/\n/g, '');

      await writeFile(
        `./${config.temp.path}/${tempSubpath}/${getFileBasename(file)}`,
        finalizedCss
      );
    });

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Create the module file.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function initializeModuleFile(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'initialize file';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const files = await glob(
      `./${
        config.temp.path
      }/${tempSubpath}/**/${tempEntrypointFileBaseName}${getFileExtension(config
        .src.entrypoint as string)}`
    );

    if (files.length !== 1) {
      throw new Error('Internal error: Cannot determin entryfile.');
    }
    const file = files[0];
    const fileContent = await readFile(file, {
      encoding: 'utf8',
      flag: 'r'
    });

    const updatedFileContent =
      fileContent
        // Strip eslint and tslint comments.
        .replace(/^\s*\/\*+[\s\n\*]*eslint[ -]\S*\s*\*+\/\s*$/gm, '') // eslint multiline.
        .replace(/^\s*\/\/\s*tslint:.*$/gm, '') // tslint inline.

        // Correct `node_modules` links.
        .replace(
          new RegExp(
            `(../)*${config.nodeModulesPath}/${config.componenet.scope}/`,
            'g'
          ),
          '../'
        )
        .replace(new RegExp(`(../)*${config.nodeModulesPath}/`, 'g'), '../../')

        // Trim extra white space but end with a newline.
        .trim() + '\n';

    await writeFile(
      `./${config.temp.path}/${tempSubpath}/${config.componenet.name}${
        config.build.module.extension
      }`,
      updatedFileContent
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Strip the imports and exports out of the parse code and return them.
 *
 * @param program - The parsed code.
 */
function stripImportsAndExports(
  config: IConfig,
  program: Program
): {
  readonly strippedCode: Program;
  readonly esImports: Map<number, ImportDeclaration>;
  readonly esExports: Map<number, ExportNamedDeclaration>;
} {
  type Wrapper = [
    ReadonlyArray<number>,
    ReadonlyArray<[number, ImportDeclaration]>,
    ReadonlyArray<[number, ExportNamedDeclaration]>
  ];

  // Get info about the code.
  const [codeIndexesToRemove, esImports, esExports]: Wrapper = Array.from(
    program.body.entries()
  ).reduce(
    (reduced, nodeInfo) => {
      const [nodeIndex, node] = nodeInfo;

      if (node.type === 'ImportDeclaration') {
        // If bundling imports? Don't strip them.
        if (config.build.script.bundleImports) {
          return reduced;
        }
        return node.specifiers.reduce(
          (reducedSpecifier, specifier) => {
            const importedName =
              specifier.type === 'ImportDefaultSpecifier'
                ? specifier.local.name
                : specifier.type === 'ImportSpecifier'
                  ? specifier.imported.name
                  : null;
            if (
              importedName === null ||
              !importedName.toLowerCase().startsWith('catalyst')
            ) {
              throw new Error(
                `Cannot automatically process import "${importedName}."`
              );
            }

            return [
              [...reducedSpecifier[0], nodeIndex],
              [...reducedSpecifier[1], [nodeIndex, node]],
              reducedSpecifier[2]
            ] as Wrapper;
          },
          [[], [], []] as Wrapper
        );
      }
      if (node.type === 'ExportNamedDeclaration') {
        return [
          [...reduced[0], nodeIndex],
          reduced[1],
          [...reduced[2], [nodeIndex, node]]
        ] as Wrapper;
      }
      return reduced;
    },
    [[], [], []] as Wrapper
  );

  // Strip imports and exports.
  const strippedCode = {
    ...program,
    body: program.body.filter(
      (_: any, i: number) => !codeIndexesToRemove.includes(i)
    )
  };

  return {
    strippedCode,
    esImports: new Map(esImports),
    esExports: new Map(esExports)
  };
}

/**
 * Replace catalyst element's imports with globally accessible object import.
 *
 * @param program
 *   The parsed code with the imports already stripped out.
 * @param esImports
 *   The imports that have been stripped out of the parsed code.
 */
function processImports(
  program: Program,
  esImports: Map<number, ImportDeclaration>
): Program {
  const updatedBody = Array.from(esImports.entries()).reduce(
    (body, importDetail) => {
      const [insertIndex, declaration] = importDetail;
      const bodyReplacement = declaration.specifiers.reduce(
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

          if (!importedName.toLowerCase().startsWith('catalyst')) {
            throw new Error(
              `Cannot automatically process import "${importedName}."`
            );
          }

          const insert = esprima.parseScript(
            `const ${localName} = window.CatalystElements.${importedName};`
          ).body;
          const offsetInsertIndex = insertIndex + reducedBodyInfo.offset;

          return {
            offset: reducedBodyInfo.offset + insert.length,
            body: [
              ...reducedBodyInfo.body.slice(0, offsetInsertIndex),
              ...insert,
              ...reducedBodyInfo.body.slice(offsetInsertIndex)
            ]
          };
        },
        {
          offset: 0,
          body: program.body
        }
      ).body;

      return [...body, ...bodyReplacement];
    },
    [] as ReadonlyArray<Statement | ModuleDeclaration>
  );

  return {
    ...program,
    // tslint:disable-next-line:readonly-array
    body: updatedBody as (Statement | ModuleDeclaration)[]
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
  insertIndex: number
): IExportDetails {
  return specifiers.reduce(
    (updateInfo, specifier) => {
      const localName = specifier.local.name;
      const exportedName = specifier.exported.name;

      // Already processed? skip.
      if (updateInfo.exportNamesProcessed[exportedName]) {
        return updateInfo;
      }

      // Generate insert.
      const insert = esprima.parseScript(
        `window.CatalystElements.${exportedName} = ${localName};`
      ).body;
      const offsetInsertIndex = insertIndex + updateInfo.offset;

      // Update.
      return {
        exportNamesProcessed: {
          ...updateInfo.exportNamesProcessed,
          [exportedName]: true
        },
        offset: updateInfo.offset + insert.length,
        body: [
          ...updateInfo.body.slice(0, offsetInsertIndex),
          ...insert,
          ...updateInfo.body.slice(offsetInsertIndex)
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
  const declarations =
    declaration.type !== 'VariableDeclaration'
      ? [declaration]
      : [...declaration.declarations];

  return (declarations as any).reduce(
    (
      updateInfo: IExportDetails,
      dec: FunctionDeclaration | ClassDeclaration | VariableDeclarator
    ) => {
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
      if (updateInfo.exportNamesProcessed[dec.id.name]) {
        return updateInfo;
      }

      // Generate insert.
      const insert = esprima.parseScript(
        `window.CatalystElements.${dec.id.name} = ${dec.id.name};`
      ).body;
      const offsetInsertIndex = insertIndex + updateInfo.offset;

      // Update.
      return {
        exportNamesProcessed: {
          ...updateInfo.exportNamesProcessed,
          [dec.id.name]: true
        },
        offset: updateInfo.offset + insert.length,
        body: [
          ...updateInfo.body.slice(0, offsetInsertIndex),
          ...insert,
          ...updateInfo.body.slice(offsetInsertIndex)
        ]
      };
    },
    {
      exportNamesProcessed,
      offset: 0,
      body
    } as IExportDetails
  );
}

/**
 * Insert globally accessible object exports where es exports once were.
 *
 * @param program
 *   The parsed code with the es exports already stripped out.
 * @param esExports
 *   The exports that have been stripped out of the parsed code.
 */
function processExports(
  program: Program,
  esExports: Map<number, ExportNamedDeclaration>
): Program {
  const updatedBody = Array.from(esExports.entries()).reduce(
    (exportDetails, exportDetail) => {
      const [insertIndex, exportDef] = exportDetail;
      const offsetInsertIndex = insertIndex + exportDetails.offset;

      if (exportDef.declaration == null) {
        return processExportWithSpecifiers(
          exportDef.specifiers,
          exportDetails.body,
          exportDetails.exportNamesProcessed,
          offsetInsertIndex
        );
      }
      return processExportWithDeclaration(
        exportDef.declaration,
        exportDetails.body,
        exportDetails.exportNamesProcessed,
        offsetInsertIndex
      );
    },
    {
      exportNamesProcessed: {},
      offset: 0,
      body: program.body
    } as IExportDetails
    // tslint:disable-next-line:readonly-array
  ).body as (Statement | ModuleDeclaration)[];

  return {
    ...program,
    body: updatedBody
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
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'initialize file';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const files = await glob(
      `./${
        config.temp.path
      }/${tempSubpath}/**/${tempEntrypointFileBaseName}${getFileExtension(config
        .src.entrypoint as string)}`
    );

    if (files.length !== 1) {
      throw new Error('Internal error: Cannot determin entryfile.');
    }
    const file = files[0];
    const fileContent = await readFile(file, {
      encoding: 'utf8',
      flag: 'r'
    });

    const program = esprima.parseModule(fileContent);
    const { strippedCode, esImports, esExports } = stripImportsAndExports(
      config,
      program
    );
    const updatedprogram = processExports(
      processImports(strippedCode, esImports),
      esExports
    );
    const updatedSourceCode =
      'window.CatalystElements = window.CatalystElements || {};\n' +
      `${escodegen.generate(updatedprogram)}`;

    await writeFile(
      `./${config.temp.path}/${tempSubpath}/${config.componenet.name}${
        config.build.script.extension
      }`,
      updatedSourceCode
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Pipe the task to inject the template html into the given stream.
 *
 * @param config - Config settings
 * @param file - The file to inject into
 * @param labelPrefix - A prefix to print before the label
 */
async function injectTemplateHTML(
  config: IConfig,
  file: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'html';

  if (
    config.src.template === undefined ||
    config.src.template.html === undefined
  ) {
    tasksHelpers.log.info(
      `skipping ${subTaskLabel} - no html to inject.`,
      labelPrefix
    );
    return;
  }

  tasksHelpers.log.starting(subTaskLabel, labelPrefix);

  const htmlFile = `./${config.temp.path}/${tempSubpath}/${
    config.src.template.html
  }`;
  const [element, html] = await Promise.all(
    // tslint:disable-next-line:promise-function-async
    [file, htmlFile].map(filepath =>
      readFile(filepath, {
        encoding: 'utf8',
        flag: 'r'
      })
    )
  );

  const injectedElement = element.replace(
    getInjectRegExp('template'),
    html.replace(/`/g, '\\`')
  );

  await writeFile(file, injectedElement);
  tasksHelpers.log.successful(subTaskLabel, labelPrefix);
}

/**
 * Pipe the task to inject the template css into the given stream.
 *
 * @param config - Config settings
 * @param file - The file to inject into
 * @param labelPrefix - A prefix to print before the label
 */
async function injectTemplateCSS(
  config: IConfig,
  file: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'css';

  if (
    config.src.template === undefined ||
    config.src.template.css === undefined
  ) {
    tasksHelpers.log.info(
      `skipping ${subTaskLabel} - no css to inject.`,
      labelPrefix
    );
    return;
  }

  tasksHelpers.log.starting(subTaskLabel, labelPrefix);

  const cssFile = `./${config.temp.path}/${tempSubpath}/${
    config.src.template.css
  }`;
  const [element, css] = await Promise.all(
    // tslint:disable-next-line:promise-function-async
    [file, cssFile].map(filepath =>
      readFile(filepath, {
        encoding: 'utf8',
        flag: 'r'
      })
    )
  );

  const injectedElement = element.replace(
    getInjectRegExp('style'),
    css.replace(/`/g, '\\`')
  );

  await writeFile(file, injectedElement);
  tasksHelpers.log.successful(subTaskLabel, labelPrefix);
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
    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await injectTemplateHTML(config, file, subTaskLabelPrefix);
    await injectTemplateCSS(config, file, subTaskLabelPrefix);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
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
  labelPrefix: string
): Promise<void> {
  await injectTemplate(
    config,
    `./${config.temp.path}/${tempSubpath}/${config.componenet.name}${
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
  labelPrefix: string
): Promise<void> {
  await injectTemplate(
    config,
    `./${config.temp.path}/${tempSubpath}/${config.componenet.name}${
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
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'finalize';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    await copyFile(
      `./${config.temp.path}/${tempSubpath}/${config.componenet.name}${
        config.build.module.extension
      }`,
      `./${config.dist.path}/${config.componenet.name}${
        config.build.module.extension
      }`
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
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
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'finalize';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const compiler: webpack.Compiler = webpack({
      mode: 'none',
      entry: `./${config.temp.path}/${tempSubpath}/${config.componenet.name}${
        config.build.script.extension
      }`,
      output: {
        path: joinPaths(process.cwd(), config.dist.path),
        chunkFilename: `${config.componenet.name}.part-[id]${
          config.build.script.extension
        }`,
        filename: `${config.componenet.name}${config.build.script.extension}`
      },
      plugins: getWebpackPlugIns(),
      target: 'web'
    } as any);

    const runCompiler = promisify(compiler.run.bind(compiler));
    const stats = await runCompiler();

    // tslint:disable-next-line:no-console
    console.log(
      stats.toString({
        chunks: false,
        colors: true
      })
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
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
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'module';

  try {
    if (!config.build.module.build) {
      tasksHelpers.log.info(
        `skipping ${subTaskLabel} - turned off in config.`,
        labelPrefix
      );

      return;
    }

    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await initializeModuleFile(config, subTaskLabelPrefix);
    await injectTemplateModule(config, subTaskLabelPrefix);
    await finalizeModule(config, subTaskLabelPrefix);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
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
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'script';

  try {
    if (!config.build.script.build) {
      tasksHelpers.log.info(
        `skipping ${subTaskLabel} - turned off in config.`,
        labelPrefix
      );

      return;
    }

    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await initializeScriptFile(config, subTaskLabelPrefix);
    await injectTemplateScript(config, subTaskLabelPrefix);
    await finalizeScript(config, subTaskLabelPrefix);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
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
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const files = await glob(['./README.md', './LICENSE']);
    await Promise.all(
      // tslint:disable-next-line:promise-function-async
      files.map(file => copyFile(file, `./${config.dist.path}/${file}`))
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
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
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'package.json';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const fileContents = await readFile('./package.json', {
      encoding: 'utf8',
      flag: 'r'
    });
    const modifiedContent = {
      ...JSON.parse(fileContents),
      version: null,
      main: `${config.componenet.name}${config.build.module.extension}`
    };

    const updatedContent = Object.keys(modifiedContent)
      .filter(key =>
        ['scripts', 'directories', 'devDependencies', 'engines'].includes(key)
      )
      .reduce(
        (content, key) => {
          return {
            ...content,
            [key]: modifiedContent[key]
          };
        },
        {} as { readonly [key: string]: any }
      );

    await writeFile(
      `./${config.dist.path}/package.json`,
      JSON.stringify(updatedContent, null, 2)
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Get the build ready for distribution.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function finalize(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = 'finalize';

  try {
    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await runAllPromises([
      finalizeCopyFiles(config, subTaskLabelPrefix),
      finalizePackageJson(config, subTaskLabelPrefix)
    ]);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
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
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'symlinks';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const files = await glob(
      `./${config.dist.path}/${config.componenet.name}**.?(m)js`
    );
    // tslint:disable-next-line:promise-function-async
    await Promise.all(files.map(file => symlink(file, './', 'file')));

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Build the component.
 */
export async function build(taskName: string, config: IConfig): Promise<void> {
  if (config.componenet.name === undefined) {
    throw new Error('Cannot build: `config.componenet.name` is not set.');
  }
  if (config.src.entrypoint === undefined) {
    throw new Error('Cannot build: `config.src.entrypoint` is not set.');
  }
  await cleanDist(config, taskName);
  await checkSourceFiles(config, taskName);
  await preprocessSourceFiles(config, taskName);
  await runAllPromises([
    minifyHTML(config, taskName),
    compileSASS(config, taskName)
  ]);
  await runAllPromises([
    buildModule(config, taskName),
    buildScript(config, taskName)
  ]);
  await finalize(config, taskName);
  await buildSymlinks(config, taskName);
}
