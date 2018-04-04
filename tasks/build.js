// Load util.
const tasksUtil = require('./util');

// Libraries.
const escodegen = require('escodegen');
const esprima = require('esprima');
const fs = require('fs');
const inject = require('gulp-inject');
const htmlmin = require('gulp-htmlmin');
const modifyFile = require('gulp-modify-file');
const postcss = require('gulp-postcss');
const prettier = require('prettier');
const replace = require('gulp-replace');
const rename = require('gulp-rename');
const sass = require('gulp-sass');
const webpack = require('webpack');
const WebpackClosureCompilerPlugin = require('webpack-closure-compiler');
const webpackStream = require('webpack-stream');

// The temp path.
const tempSubpath = 'build';
/**
 * Check the source files are all good.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function checkSourceFiles(gulp, config, labelPrefix) {
  const subTaskLabel = 'check source files';

  return new Promise((resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
    try {
      const entrypoint = fs.readFileSync(
        `./${config.src.path}/${config.src.entrypoint}`,
        'utf-8'
      );
      const parsedCode = esprima.parseModule(entrypoint);

      for (const node of parsedCode.body) {
        switch (node.type) {
          case 'ExportDefaultDeclaration':
            reject(new Error('Do not use default exports.'));
            return;

          // Different type? Do nothing.
          default:
        }
      }

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Minify HTML.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function minifyHTML(gulp, config, labelPrefix) {
  const subTaskLabel = 'minify HTML';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
    gulp
      .src(`./${config.src.path}/**/[^_]*.html`)
      .pipe(htmlmin(config.build.htmlMinifier))
      .pipe(replace('\n', ''))
      .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Compile Sass.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function compileSASS(gulp, config, labelPrefix) {
  const subTaskLabel = 'compile SASS';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
    gulp
      .src(`./${config.src.path}/**/[^_]*.scss`)
      .pipe(sass({ outputStyle: 'expanded' }).on('error', sass.logError))
      .pipe(postcss(config.build.postcss.plugins, config.build.postcss.options))
      .pipe(replace('\n', ''))
      .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Create the module file.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function initializeModuleFile(gulp, config, labelPrefix) {
  const subTaskLabel = 'initialize file';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
    gulp
      .src(`./${config.src.path}/${config.src.entrypoint}`)
      .pipe(
        modifyFile(content => {
          let modifiedContent = content;

          // Strip eslint comments.
          modifiedContent = modifiedContent.replace(
            new RegExp('/\\*\\s*eslint[ -].*\\*/', 'gm'),
            ''
          );

          // Correct `node_modules` links.
          modifiedContent = modifiedContent.replace(
            new RegExp(`../node_modules/${config.componenet.scope}/`, 'g'),
            '../'
          );
          modifiedContent = modifiedContent.replace(
            new RegExp(`../node_modules/`, 'g'),
            '../../'
          );

          // Trim extra white space.
          modifiedContent = modifiedContent.trim();

          return modifiedContent;
        })
      )
      .pipe(
        rename(filepath => {
          filepath.basename = config.componenet.name;
          filepath.extname = `.mjs`;
        })
      )
      .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Create the element file.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function initializeScriptFile(gulp, config, labelPrefix) {
  const subTaskLabel = 'initialize file';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
    gulp
      .src(`./${config.src.path}/${config.src.entrypoint}`)
      .pipe(
        modifyFile(content => {
          /**
           * Strip the imports and exports out of the parse code and return them.
           *
           * @param {Program} parsedCode
           *   The parsed code.
           * @returns {{esImports:Map<number,Object>, esExports:Map<number,Object>}}
           */
          const stripImportsAndExports = parsedCode => {
            // Get info about the code.
            const codeIndexesToRemove = [];
            const esImports = new Map();
            const esExports = new Map();
            for (const [nodeIndex, node] of parsedCode.body.entries()) {
              switch (node.type) {
                case 'ImportDeclaration':
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
                  break;

                case 'ExportDefaultDeclaration':
                case 'ExportNamedDeclaration':
                  esExports.set(nodeIndex, parsedCode.body[nodeIndex]);
                  codeIndexesToRemove.push(nodeIndex);
                  break;

                // Different type? Do nothing.
                default:
              }
            }

            // Remove imports and exports.
            parsedCode.body = parsedCode.body.filter(
              (e, i) => !codeIndexesToRemove.includes(i)
            );

            return {
              esImports: esImports,
              esExports: esExports
            };
          };

          /**
           * Replace catalyst element's imports with globally accessible object import.
           *
           * @param {Program} parsedCode
           *   The parsed code with the imports already stripped out.
           * @param {Map<number,Object>} esImports
           *   The imports that have been stripped out of the parsed code.
           */
          const processImports = (parsedCode, esImports) => {
            for (const [importDefIndex, importDef] of esImports) {
              for (const specifier of Object.values(importDef.specifiers)) {
                const localName = specifier.local.name;
                const importedName = specifier.imported
                  ? specifier.imported.name
                  : localName;

                if (importedName.toLowerCase().startsWith('catalyst')) {
                  parsedCode.body.splice(
                    importDefIndex,
                    0,
                    esprima.parseScript(
                      `let ${localName} = window.CatalystElements.${importedName};`
                    )
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
           * @param {Program} parsedCode
           *   The parsed code with the exports already stripped out.
           * @param {Map<number,Object>} esExports
           *   The exports that have been stripped out of the parsed code.
           */
          const processExports = (parsedCode, esExports) => {
            const exportNamesUsed = [];

            // Replace exports with globally accessible object exports.
            for (const [exportDefIndex, exportDef] of esExports) {
              if (exportDef.declaration === null) {
                const inserts = [];
                for (const specifier of Object.values(exportDef.specifiers)) {
                  const localName = specifier.local.name;
                  const exportedName = specifier.imported
                    ? specifier.imported.name
                    : localName;

                  if (!exportNamesUsed.includes(exportedName)) {
                    inserts.push(
                      esprima.parseScript(
                        `window.CatalystElements.${exportedName} = ${localName};`
                      )
                    );
                    exportNamesUsed.push(exportedName);
                  }
                }
                if (inserts.length > 0) {
                  parsedCode.body.splice(exportDefIndex, 0, ...inserts);
                }
              } else if (exportDef.declaration.type === 'Identifier') {
                if (!exportNamesUsed.includes(exportDef.declaration.name)) {
                  parsedCode.body.splice(
                    exportDefIndex,
                    0,
                    esprima.parseScript(
                      `window.CatalystElements.${
                        exportDef.declaration.name
                      } = ${exportDef.declaration.name};`
                    )
                  );
                  exportNamesUsed.push(exportDef.declaration.name);
                }
              } else {
                console.error(
                  `Cannot automatically process declaration in ${
                    exportDef.type
                  }.`
                );
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
          filepath.extname = `.js`;
        })
      )
      .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Inject the template into the element.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} options - Options
 * @param {string} options.type - Either `module` or `script`
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function injectTemplate(gulp, config, options = {}, labelPrefix) {
  const subTaskLabel = 'inject template';

  return new Promise((resolve, reject) => {
    const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
      subTaskLabel,
      labelPrefix
    );
    const stream = (() => {
      switch (options.type) {
        case 'module':
          return gulp.src(
            `./${config.temp.path}/${tempSubpath}/${config.componenet.name}.mjs`
          );
        case 'script':
          return gulp.src(
            `./${config.temp.path}/${tempSubpath}/${config.componenet.name}.js`
          );
        default:
          tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
          reject(new Error('Invalid type.'));
          return null;
      }
    })();

    if (stream == null) {
      return;
    }

    const innerTaskLabelHTML = 'html';
    const innerTaskLabelCSS = 'css';

    // Inject the template html.
    if (config.src.template == null || config.src.template.html == null) {
      tasksUtil.tasks.log.info(
        `skipping ${innerTaskLabelHTML} - no html to inject.`,
        subTaskLabelPrefix
      );
    } else {
      tasksUtil.tasks.log.starting(innerTaskLabelHTML, subTaskLabelPrefix);

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
              transform: tasksUtil.transforms.getFileContents
            }
          )
        )
        .on('finish', () => {
          tasksUtil.tasks.log.successful(
            innerTaskLabelHTML,
            subTaskLabelPrefix
          );
        });
    }

    // Inject the style css.
    if (config.src.template == null || config.src.template.css == null) {
      tasksUtil.tasks.log.info(
        `skipping ${innerTaskLabelCSS} - no css to inject.`,
        subTaskLabelPrefix
      );
    } else {
      tasksUtil.tasks.log.starting(innerTaskLabelCSS, subTaskLabelPrefix);

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
              transform: tasksUtil.transforms.getFileContents
            }
          )
        )
        .on('finish', () => {
          tasksUtil.tasks.log.successful(innerTaskLabelCSS, subTaskLabelPrefix);
        });
    }

    stream
      .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Finalize the module.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function finalizeModule(gulp, config, labelPrefix) {
  const subTaskLabel = 'finalize';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
    gulp
      .src(`./${config.temp.path}/${tempSubpath}/${config.componenet.name}.mjs`)
      .pipe(
        rename(filepath => {
          filepath.basename = config.componenet.name;
        })
      )
      .pipe(gulp.dest(`./${config.dist.path}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Finalize the script.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function finalizeScript(gulp, config, labelPrefix) {
  const subTaskLabel = 'finalize';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
    gulp
      .src(`./${config.temp.path}/${tempSubpath}/${config.componenet.name}.js`)
      .pipe(
        webpackStream(
          {
            target: 'web',
            mode: 'none',
            output: {
              chunkFilename: `${config.componenet.name}.part-[id].es5.min.js`,
              filename: `${config.componenet.name}.es5.min.js`
            },
            plugins: [
              new WebpackClosureCompilerPlugin({
                compiler: {
                  language_in: 'ECMASCRIPT_NEXT',
                  language_out: 'ECMASCRIPT5',
                  compilation_level: 'SIMPLE',
                  assume_function_wrapper: true,
                  output_wrapper: '(function(){%output%}).call(this)'
                }
              })
            ]
          },
          webpack
        )
      )
      .pipe(gulp.dest(`./${config.dist.path}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Build the es6 module version of the component.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function buildModule(gulp, config, labelPrefix) {
  const subTaskLabel = 'module';

  return new Promise(async resolve => {
    const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await initializeModuleFile(gulp, config, subTaskLabelPrefix);
    await injectTemplate(gulp, config, { type: 'module' }, subTaskLabelPrefix);
    await finalizeModule(gulp, config, subTaskLabelPrefix);

    tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    resolve();
  });
}

/**
 * Build the es5 script version of the component.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function buildScript(gulp, config, labelPrefix) {
  const subTaskLabel = 'script';

  return new Promise(async resolve => {
    const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await initializeScriptFile(gulp, config, subTaskLabelPrefix);
    await injectTemplate(gulp, config, { type: 'script' }, subTaskLabelPrefix);
    await finalizeScript(gulp, config, subTaskLabelPrefix);

    tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    resolve();
  });
}

/**
 * Copy over other wanted files into the distribution folder.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function finalizeCopyFiles(gulp, config, labelPrefix) {
  const subTaskLabel = 'copy files';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
    gulp
      .src(['README.md', 'LICENSE'])
      .pipe(gulp.dest(`./${config.dist.path}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Create the package.json file for the distribution.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function finalizePackageJson(gulp, config, labelPrefix) {
  const subTaskLabel = 'package.json';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
    gulp
      .src('package.json')
      .pipe(
        modifyFile(content => {
          const json = JSON.parse(content);
          json.main = `${config.componenet.name}.mjs`;
          json.scripts = {
            prepublishOnly:
              "node -e \"assert.equal(require('./package.json').version, require('../package.json').version)\""
          };
          delete json.directories;
          delete json.engines;
          delete json.devDependencies;
          return prettier.format(JSON.stringify(json), { parser: 'json' });
        })
      )
      .pipe(gulp.dest(`./${config.dist.path}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Get the build ready for distribution.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function finalize(gulp, config, labelPrefix) {
  const subTaskLabel = 'finalize';

  return new Promise(async resolve => {
    const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
      subTaskLabel,
      labelPrefix
    );
    await Promise.all([
      finalizeCopyFiles(gulp, config, subTaskLabelPrefix),
      finalizePackageJson(gulp, config, subTaskLabelPrefix)
    ]);

    tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    resolve();
  });
}

/**
 * Build symlinks at the root of the project to the distribution files.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function buildSymlinks(gulp, config, labelPrefix) {
  const subTaskLabel = 'symlinks';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
    gulp
      .src(`./${config.dist.path}/${config.componenet.name}**.?(m)js`)
      .pipe(gulp.symlink('./'))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

// Export the build function.
module.exports = (gulp, config) => {
  return new Promise(async (resolve, reject) => {
    if (config.componenet.name == null) {
      reject(new Error('Cannot build: `config.componenet.name` is not set.'));
    } else if (config.src.entrypoint == null) {
      reject(new Error('Cannot build: `config.src.entrypoint` is not set.'));
    } else {
      await tasksUtil.cleanDist(config);
      await checkSourceFiles(gulp, config);
      await Promise.all([minifyHTML(gulp, config), compileSASS(gulp, config)]);
      await Promise.all([buildModule(gulp, config), buildScript(gulp, config)]);
      await finalize(gulp, config);
      await buildSymlinks(gulp, config);
      resolve();
    }
  });
};
