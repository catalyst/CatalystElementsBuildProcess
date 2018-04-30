// Libraries.
import escodegen from 'escodegen';
import esprima, { Program } from 'esprima';
import {
  ClassDeclaration,
  ExportNamedDeclaration,
  ExpressionStatement,
  FunctionDeclaration,
  Identifier,
  ImportDeclaration,
  ImportSpecifier,
  VariableDeclarator
} from 'estree';
import { readFile } from 'fs/promises';
import GulpClient from 'gulp';
import htmlmin from 'gulp-htmlmin';
import inject from 'gulp-inject';
import modifyFile from 'gulp-modify-file';
import postcss from 'gulp-postcss';
import rename from 'gulp-rename';
import replace from 'gulp-replace';
import sass from 'gulp-sass';
import path from 'path';
import * as webpack from 'webpack';
import webpackStream from 'webpack-stream';

import { IConfig } from '../config';
import {
  cleanDist,
  getWebpackPlugIns,
  tasksHelpers,
  transformGetFileContents,
  waitForAllPromises
} from '../util';

// The temp path.
const tempSubpath = 'build';
const tempEntrypointFileBaseName = 'entrypoint';

/**
 * Get the local names of all the static imports in the given a JavaScript.
 *
 * @param javascript - The JavaScript
 */
function getStaticImportLocalNames(javascript: string): string[] {
  const parsedCode = esprima.parseModule(javascript);
  const localNames = [];

  // Static imports declaration must be defined in the body.
  for (const node of parsedCode.body) {
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) {
        if (
          specifier.type === 'ImportDefaultSpecifier' ||
          specifier.type === 'ImportSpecifier'
        ) {
          if (specifier.local.type === 'Identifier') {
            localNames.push(specifier.local.name);
          }
        }
      }
    }
  }

  return localNames;
}

/**
 * Check the source files are all good.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function checkSourceFiles(
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'check source files';

  return new Promise(async (resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      const entrypoint = await readFile(
        `./${config.src.path}/${config.src.entrypoint}`,
        'utf8'
      );
      const parsedCode = esprima.parseModule(entrypoint);

      for (const node of parsedCode.body) {
        switch (node.type) {
          case 'ExportDefaultDeclaration':
            throw new Error('Do not use default exports.');

          // Different type? Do nothing.
          default:
        }
      }

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Prepare the entrypoint file.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function prepareEntrypoint(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'prepare entrypoint';

  return new Promise((resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(`./${config.src.path}/${config.src.entrypoint}`)
        .pipe(
          modifyFile((content: string) => {
            let modifiedContent = content;

            const pathChange = path.relative(
              `./${config.src.path}`,
              `./${config.temp.path}/${tempSubpath}`
            );

            let depthChange = 0;
            for (const element of pathChange.split('/')) {
              if (element == null || element === '' || element === '.') {
                continue;
              }
              depthChange += element === '..' ? -1 : 1;
            }

            if (depthChange > 0) {
              modifiedContent = modifiedContent.replace(
                new RegExp(`../${config.nodeModulesPath}/`, 'g'),
                `${'../'.repeat(depthChange + 1)}${config.nodeModulesPath}/`
              );
            }

            return modifiedContent;
          })
        )
        .pipe(
          rename(filepath => {
            filepath.basename = tempEntrypointFileBaseName;
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
 * Export the static imports in the entrypoint file.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function exportStaticImports(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'export static imports';

  return new Promise((resolve, reject) => {
    try {
      if (!config.build.script.exportAllStaticImports) {
        resolve();
        tasksHelpers.log.info(
          `skipping ${subTaskLabel} - turned off in config.`,
          labelPrefix
        );
        return;
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(
          `./${
            config.temp.path
          }/${tempSubpath}/**/${tempEntrypointFileBaseName}*`
        )
        .pipe(
          modifyFile((content: string) => {
            let modifiedContent = content;

            // Export all imports.
            modifiedContent += '\n// Export all the imports.\n';
            modifiedContent = `${modifiedContent}export {\n  ${getStaticImportLocalNames(
              content
            ).join(',\n  ')}\n};`;

            return modifiedContent;
          })
        )
        .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
        .on('finish', () => {
          resolve();
          tasksHelpers.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', (error: Error) => {
          tasksHelpers.log.failed(subTaskLabel, labelPrefix);
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Process the source files before handling them off to be turned into the module/script.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function preprocessSourceFiles(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'preprocess source files';

  return new Promise(async (resolve, reject) => {
    try {
      const subTaskLabelPrefix = tasksHelpers.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await prepareEntrypoint(gulp, config, subTaskLabelPrefix);
      await exportStaticImports(gulp, config, subTaskLabelPrefix);

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Minify HTML.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function minifyHTML(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'minify HTML';

  return new Promise((resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(`./${config.src.path}/**/[^_]*.html`)
        .pipe(htmlmin(config.build.tools.htmlMinifier))
        .pipe(replace('\n', ''))
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
 * Compile Sass.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function compileSASS(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'compile SASS';

  return new Promise((resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      let plugins;
      let options;
      if (config.build.tools.postcss) {
        plugins = config.build.tools.postcss.plugins;
        options = config.build.tools.postcss.options;
      }

      gulp
        .src(`./${config.src.path}/**/[^_]*.scss`)
        .pipe(sass({ outputStyle: 'expanded' }).on('error', sass.logError))
        .pipe(postcss(plugins, options))
        .pipe(replace('\n', ''))
        .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
        .on('finish', () => {
          resolve();
          tasksHelpers.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', (error: Error) => {
          tasksHelpers.log.failed(subTaskLabel, labelPrefix);
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Create the module file.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function initializeModuleFile(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'initialize file';

  return new Promise((resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(
          `./${
            config.temp.path
          }/${tempSubpath}/**/${tempEntrypointFileBaseName}*`
        )
        .pipe(
          modifyFile((content: string) => {
            let modifiedContent = content;

            // Strip eslint comments.
            modifiedContent = modifiedContent.replace(
              new RegExp('/\\*\\s*eslint[ -].*\\*/', 'gm'),
              ''
            );

            // Correct `node_modules` links.
            modifiedContent = modifiedContent.replace(
              new RegExp(
                `(../)*${config.nodeModulesPath}/${config.componenet.scope}/`,
                'g'
              ),
              '../'
            );
            modifiedContent = modifiedContent.replace(
              new RegExp(`(../)*${config.nodeModulesPath}/`, 'g'),
              '../../'
            );

            // Trim extra white space.
            modifiedContent = modifiedContent.trim();

            // End with a newline.
            modifiedContent += '\n';

            return modifiedContent;
          })
        )
        .pipe(
          rename(filepath => {
            filepath.basename = config.componenet.name;
            filepath.extname = config.build.module.extension;
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
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Create the element file.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function initializeScriptFile(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'initialize file';

  return new Promise((resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(
          `./${
            config.temp.path
          }/${tempSubpath}/**/${tempEntrypointFileBaseName}*`
        )
        .pipe(
          modifyFile((content: string) => {
            /**
             * Strip the imports and exports out of the parse code and return them.
             *
             * @param parsedCode - The parsed code.
             */
            function stripImportsAndExports(
              parsedCode: Program
            ): {
              esImports: Map<number, ImportDeclaration>;
              esExports: Map<number, ExportNamedDeclaration>;
            } {
              // Get info about the code.
              const codeIndexesToRemove: number[] = [];
              const esImports = new Map<number, ImportDeclaration>();
              const esExports = new Map<number, ExportNamedDeclaration>();
              for (const [nodeIndex, node] of parsedCode.body.entries()) {
                switch (node.type) {
                  case 'ImportDeclaration':
                    // Not bundling imports? Strip them.
                    if (!config.build.script.bundleImports) {
                      for (const specifiers of node.specifiers) {
                        let importedName;
                        if (specifiers.type === 'ImportDefaultSpecifier') {
                          importedName = specifiers.local.name;
                        } else if (specifiers.type === 'ImportSpecifier') {
                          importedName = specifiers.imported.name;
                        }

                        if (
                          importedName != null &&
                          importedName.toLowerCase().startsWith('catalyst')
                        ) {
                          esImports.set(nodeIndex, node);
                          codeIndexesToRemove.push(nodeIndex);
                        } else {
                          throw new Error(
                            `Cannot automatically process import "${importedName}."`
                          );
                        }
                      }
                    }
                    break;

                  case 'ExportNamedDeclaration':
                    // Strip all exports.
                    esExports.set(nodeIndex, parsedCode.body[nodeIndex] as ExportNamedDeclaration);
                    codeIndexesToRemove.push(nodeIndex);
                    break;

                  // Different type? Do nothing.
                  default:
                }
              }

              // Remove imports and exports.
              parsedCode.body = parsedCode.body.filter(
                (_, i) => !codeIndexesToRemove.includes(i)
              );

              return {
                esExports,
                esImports
              };
            };

            /**
             * Replace catalyst element's imports with globally accessible object import.
             *
             * @param parsedCode
             *   The parsed code with the imports already stripped out.
             * @param esImports
             *   The imports that have been stripped out of the parsed code.
             */
            function processImports(
              parsedCode: Program,
              esImports: Map<number, ImportDeclaration>
            ): void {
              for (const [importDefIndex, importDef] of esImports) {
                for (const specifier of Object.values(importDef.specifiers)) {
                  const localName = specifier.local.name;
                  const importedName = (specifier as any).imported
                    ? (specifier as ImportSpecifier).imported.name
                    : localName;

                  if (importedName.toLowerCase().startsWith('catalyst')) {
                    parsedCode.body.splice(
                      importDefIndex,
                      0,
                      ...esprima.parseScript(
                        `let ${localName} = window.CatalystElements.${importedName};`
                      ).body
                    );
                  } else {
                    throw new Error(
                      `Cannot automatically process import "${importedName}."`
                    );
                  }
                }
              }
            };

            /**
             * Replace exports with globally accessible object exports.
             *
             * @param parsedCode
             *   The parsed code with the exports already stripped out.
             * @param esExports
             *   The exports that have been stripped out of the parsed code.
             */
            function processExports(
              parsedCode: Program,
              esExports: Map<number, ExportNamedDeclaration>
            ): void {
              const exportNamesUsed: string[] = [];

              // Replace exports with globally accessible object exports.
              for (const [exportDefIndex, exportDef] of esExports) {
                if (exportDef.declaration == null) {
                  const inserts: ExpressionStatement[] = [];
                  for (const specifier of Object.values(exportDef.specifiers)) {
                    const localName = specifier.local.name;
                    const exportedName = specifier.exported.name;

                    if (!exportNamesUsed.includes(exportedName)) {
                      inserts.push(
                        ...(esprima.parseScript(
                          `window.CatalystElements.${exportedName} = ${localName};`
                        ).body as ExpressionStatement[])
                      );
                      exportNamesUsed.push(exportedName);
                    }
                  }
                  if (inserts.length > 0) {
                    parsedCode.body.splice(exportDefIndex, 0, ...inserts);
                  }
                } else {
                  const declarations: Array<
                    FunctionDeclaration | ClassDeclaration | VariableDeclarator
                  > = [];
                  if (exportDef.declaration.type === 'VariableDeclaration') {
                    for (const declaration of exportDef.declaration
                      .declarations) {
                      if (declaration.id.type === 'Identifier') {
                        declarations.push(declaration);
                      } else {
                        throw new Error(
                          `Cannot automatically process declaration of type ${
                            declaration.id.type
                          }`
                        );
                      }
                    }
                  } else {
                    if (exportDef.declaration.id.type === 'Identifier') {
                      declarations.push(exportDef.declaration);
                    } else {
                      throw new Error(
                        `Cannot automatically process declaration of type ${
                          exportDef.declaration.id.type
                        }`
                      );
                    }
                  }

                  for (const declaration of declarations) {
                    const id = declaration.id as Identifier;
                    if (!exportNamesUsed.includes(id.name)) {
                      parsedCode.body.splice(
                        exportDefIndex,
                        0,
                        ...esprima.parseScript(
                          `window.CatalystElements.${id.name} = ${id.name};`
                        ).body
                      );
                      exportNamesUsed.push(id.name);
                    }
                  }
                }
              }
            };

            // Parse the code.
            const parsedCode = esprima.parseModule(content);

            // Run functions defined above.
            const { esImports, esExports } = stripImportsAndExports(parsedCode);
            processImports(parsedCode, esImports);
            processExports(parsedCode, esExports);

            // Generate the updated code.
            return (
              'window.CatalystElements = window.CatalystElements || {};\n' +
              `${escodegen.generate(parsedCode)}`
            );
          })
        )
        .pipe(
          rename(filepath => {
            filepath.basename = config.componenet.name;
            filepath.extname = config.build.script.extension;
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
 * Pipe the task to inject the template html into the given stream.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param stream - The stream
 * @param labelPrefix - A prefix to print before the label
 */
function injectTemplateHTML(
  gulp: GulpClient.Gulp,
  config: IConfig,
  stream: NodeJS.ReadWriteStream,
  labelPrefix?: string
) {
  const subTaskLabel = 'html';

  if (config.src.template == null || config.src.template.html == null) {
    tasksHelpers.log.info(
      `skipping ${subTaskLabel} - no html to inject.`,
      labelPrefix
    );
  } else {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    stream
      .pipe(
        inject(
          gulp.src(
            `./${config.temp.path}/${tempSubpath}/${config.src.template.html}`
          ),
          {
            starttag: '[[inject:template]]',
            endtag: '[[endinject]]',
            removeTags: true,
            transform: transformGetFileContents
          }
        )
      )
      .on('finish', () => {
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      })
      .on('error', (error: Error) => {
        throw error;
      });
  }
}

/**
 * Pipe the task to inject the template css into the given stream.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param stream - The stream
 * @param labelPrefix - A prefix to print before the label
 */
function injectTemplateCSS(
  gulp: GulpClient.Gulp,
  config: IConfig,
  stream: NodeJS.ReadWriteStream,
  labelPrefix?: string
) {
  const subTaskLabel = 'css';

  if (config.src.template == null || config.src.template.css == null) {
    tasksHelpers.log.info(
      `skipping ${subTaskLabel} - no css to inject.`,
      labelPrefix
    );
  } else {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    stream
      .pipe(
        inject(
          gulp.src(
            `./${config.temp.path}/${tempSubpath}/${config.src.template.css}`
          ),
          {
            starttag: '[[inject:style]]',
            endtag: '[[endinject]]',
            removeTags: true,
            transform: transformGetFileContents
          }
        )
      )
      .on('finish', () => {
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      })
      .on('error', (error: Error) => {
        throw error;
      });
  }
}

/**
 * Inject the template into the element.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param options - Options
 * @param labelPrefix - A prefix to print before the label
 */
function injectTemplate(
  gulp: GulpClient.Gulp,
  config: IConfig,
  options: { type: 'module' | 'script' },
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'inject template';

  return new Promise((resolve, reject) => {
    try {
      const subTaskLabelPrefix = tasksHelpers.log.starting(
        subTaskLabel,
        labelPrefix
      );

      const stream = (() => {
        switch (options.type) {
          case 'module':
            return gulp.src(
              `./${config.temp.path}/${tempSubpath}/${config.componenet.name}${
                config.build.module.extension
              }`
            );
          case 'script':
            return gulp.src(
              `./${config.temp.path}/${tempSubpath}/${config.componenet.name}${
                config.build.script.extension
              }`
            );
          default:
            throw new Error('Invalid type.');
        }
      })();

      injectTemplateHTML(gulp, config, stream, subTaskLabelPrefix);
      injectTemplateCSS(gulp, config, stream, subTaskLabelPrefix);

      stream
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
 * Finalize the module.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function finalizeModule(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'finalize';

  return new Promise((resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(
          `./${config.temp.path}/${tempSubpath}/${config.componenet.name}${
            config.build.module.extension
          }`
        )
        .pipe(
          rename(filepath => {
            filepath.basename = config.componenet.name;
          })
        )
        .pipe(gulp.dest(`./${config.dist.path}`))
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
 * Finalize the script.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function finalizeScript(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'finalize';

  return new Promise((resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(
          `./${config.temp.path}/${tempSubpath}/${config.componenet.name}${
            config.build.script.extension
          }`
        )
        .pipe(
          webpackStream(
            {
              mode: 'none',
              output: {
                chunkFilename: `${config.componenet.name}.part-[id]${
                  config.build.script.extension
                }`,
                filename: `${config.componenet.name}${
                  config.build.script.extension
                }`
              },
              plugins: getWebpackPlugIns(),
              target: 'web'
            },
            webpack
          )
        )
        .pipe(gulp.dest(`./${config.dist.path}`))
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
 * Build the es6 module version of the component.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function buildModule(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'module';

  return new Promise(async (resolve, reject) => {
    try {
      if (!config.build.module.build) {
        resolve();
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

      await initializeModuleFile(gulp, config, subTaskLabelPrefix);
      await injectTemplate(
        gulp,
        config,
        { type: 'module' },
        subTaskLabelPrefix
      );
      await finalizeModule(gulp, config, subTaskLabelPrefix);

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Build the es5 script version of the component.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function buildScript(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'script';

  return new Promise(async (resolve, reject) => {
    try {
      if (!config.build.script.build) {
        resolve();
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

      await initializeScriptFile(gulp, config, subTaskLabelPrefix);
      await injectTemplate(
        gulp,
        config,
        { type: 'script' },
        subTaskLabelPrefix
      );
      await finalizeScript(gulp, config, subTaskLabelPrefix);

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Copy over other wanted files into the distribution folder.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function finalizeCopyFiles(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'copy files';

  return new Promise((resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(['README.md', 'LICENSE'])
        .pipe(gulp.dest(`./${config.dist.path}`))
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
 * Create the package.json file for the distribution.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function finalizePackageJson(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'package.json';

  return new Promise((resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src('package.json')
        .pipe(
          modifyFile((content: string) => {
            const json = JSON.parse(content);
            json.version = null;
            json.main = `${config.componenet.name}${
              config.build.module.extension
            }`;
            delete json.scripts;
            delete json.directories;
            delete json.engines;
            delete json.devDependencies;
            return JSON.stringify(json, null, 2);
          })
        )
        .pipe(gulp.dest(`./${config.dist.path}`))
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
 * Get the build ready for distribution.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function finalize(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'finalize';

  return new Promise(async (resolve, reject) => {
    try {
      const subTaskLabelPrefix = tasksHelpers.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await waitForAllPromises([
        finalizeCopyFiles(gulp, config, subTaskLabelPrefix),
        finalizePackageJson(gulp, config, subTaskLabelPrefix)
      ]);

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Build symlinks at the root of the project to the distribution files.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function buildSymlinks(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'symlinks';

  return new Promise((resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(`./${config.dist.path}/${config.componenet.name}**.?(m)js`)
        .pipe(gulp.symlink('./'))
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
 * Build the component.
 */
export function build(gulp: GulpClient.Gulp, config: IConfig) {
  return new Promise(async (resolve, reject) => {
    try {
      if (config.componenet.name == null) {
        throw new Error('Cannot build: `config.componenet.name` is not set.');
      }
      if (config.src.entrypoint == null) {
        throw new Error('Cannot build: `config.src.entrypoint` is not set.');
      }
      await cleanDist(config);
      await checkSourceFiles(config);
      await preprocessSourceFiles(gulp, config);
      await waitForAllPromises([
        minifyHTML(gulp, config),
        compileSASS(gulp, config)
      ]);
      await waitForAllPromises([
        buildModule(gulp, config),
        buildScript(gulp, config)
      ]);
      await finalize(gulp, config);
      await buildSymlinks(gulp, config);

      resolve();
    } catch (error) {
      reject(error);
    }
  });
}
