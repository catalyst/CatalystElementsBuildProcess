// Load util.
const tasksUtil = require('./util');
const PreWebpackClosureCompilerPlugin = require('./classes/PreWebpackClosureCompilerPlugin');

// Libraries.
const cheerio = require('gulp-cheerio');
const foreach = require('gulp-foreach');
const fs = require('fs');
const git = require('gulp-git');
const glob = require('glob');
const gulpIf = require('gulp-if');
const htmlmin = require('gulp-htmlmin');
const mergeStream = require('merge-stream');
const modifyFile = require('gulp-modify-file');
const named = require('vinyl-named');
const path = require('path');
const PolymerBuild = require('polymer-build');
const postcss = require('gulp-postcss');
const rename = require('gulp-rename');
const util = require('util');
const webpack = require('webpack');
const WebpackClosureCompilerPlugin = require('webpack-closure-compiler');
const webpackStream = require('webpack-stream');

// Promisify functions.
const gitClone = util.promisify(git.clone);
const gitCheckout = util.promisify(git.checkout);
const globPromise = util.promisify(glob);
const fsAccess = util.promisify(fs.access);
const fsReaddir = util.promisify(fs.readdir);

// The temp path.
const tempSubpath = 'docs';

// States if everything is ok. i.e. No important tasks have failed.
let allOK = true;

/**
 * Test if a directory is ready for cloning.
 *
 * @param {string} dirPath - Path of the directory to check
 * @returns {Promise}
 */
function directoryReadyForCloning(dirPath) {
  return new Promise(async (resolve, reject) => {
    if (fs.existsSync(dirPath)) {
      await fsAccess(dirPath, fs.constants.R_OK | fs.constants.W_OK);

      const files = await fsReaddir(dirPath);

      if (files.length === 0) {
        resolve();
      } else {
        reject(new Error('Directory not empty.'));
      }
    } else {
      resolve();
    }
  });
}

/**
 * Clone the given repository; then if a branch is given, check it out.
 *
 * @param {string} repoPath - The path to the repo
 * @param {string} dirPath - The path to clone the repo into
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function cloneRepository(repoPath, dirPath, labelPrefix) {
  const subTaskLabel = `clone of ${repoPath}`;

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      await gitClone(repoPath, { args: `${dirPath} --quiet` });
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      allOK = false;
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Clone all the repos specified by the given package.json files.
 *
 * @param {string[]} packageFilePaths
 *   Array of file paths to the package.json files that contrain the infomation
 *   about the repos to clone
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function cloneRepositories(packageFilePaths, config, labelPrefix) {
  const repos = [];

  for (const packageFilePath of packageFilePaths) {
    repos.push(
      // eslint-disable-next-line no-loop-func
      new Promise(async (resolve, reject) => {
        const data = fs.readFileSync(packageFilePath);

        const json = JSON.parse(data);

        const name = json.name;
        if (name == null) {
          reject(
            new Error(
              `Name not set in the package.json file "${packageFilePath}".`
            )
          );
          return;
        }

        const version = json.version;
        if (version == null) {
          reject(new Error(`Version not set in ${name}'s package.json file.`));
          return;
        }

        const repository = json.repository;
        if (repository == null) {
          reject(
            new Error(`Repository not set in ${name}'s package.json file.`)
          );
          return;
        }

        const repoPath = (() => {
          let p = '';
          if (typeof repository === 'object') {
            if (repository.type !== 'git') {
              reject(new Error(`"${repoPath}" is not a git repository.`));
              return null;
            }
            p = repository.url;
          } else {
            p = repository;
          }

          return p.replace(/^git\+https:\/\//, 'git://');
        })();

        const clonePath = `./${
          config.temp.path
        }/${tempSubpath}/demo-clones/${name}`;

        let skipClone = false;
        try {
          await directoryReadyForCloning(clonePath);
        } catch (error) {
          if (error.message === 'Directory not empty.') {
            skipClone = true;
          } else {
            throw error;
          }
        }

        if (skipClone) {
          tasksUtil.tasks.log.info(
            `skipping clone of "${repoPath}" - output dir not empty.`,
            labelPrefix
          );
        } else {
          await cloneRepository(repoPath, clonePath, labelPrefix);
        }

        await gitCheckout(`v${version}`, { args: '--quiet', cwd: clonePath });
        resolve();
      })
    );
  }

  return Promise.all(repos);
}

/**
 * Copy all the node modules.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function copyNodeModules(gulp, config, labelPrefix) {
  const subTaskLabel = 'node modules';

  return new Promise((resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    gulp
      .src(`./${config.nodeModulesPath}/**`, { follow: true })
      .pipe(
        gulp.dest(
          `./${config.temp.path}/${tempSubpath}/${config.docs.nodeModulesPath}`
        )
      )
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Copy the docs' index page.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function copyDocsIndex(gulp, config, labelPrefix) {
  const subTaskLabel = 'index page';

  return new Promise((resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    gulp
      .src(`./${config.docs.indexPage}`)
      .pipe(
        rename({
          basename: 'index'
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
 * Copy the docs' extra dependencies.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function copyExtraDocDependencies(gulp, config, labelPrefix) {
  const subTaskLabel = 'extra dependencies';

  return new Promise((resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    gulp
      .src([
        `./${config.docs.importsImporterFilename}`,
        `./${config.docs.importsFilename}`,
        `./${config.docs.analysisFilename}`
      ])
      .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Copy over all the distribution files.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function copyDistributionFiles(gulp, config, labelPrefix) {
  const subTaskLabel = 'distribution files';

  return new Promise((resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    gulp
      .src(`./${config.dist.path}/**`)
      .pipe(
        gulp.dest(
          `./${config.temp.path}/${tempSubpath}/${
            config.docs.nodeModulesPath
          }/${config.package.name}/`
        )
      )
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Copy over the demos in the demos folder.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function copyLocalDemos(gulp, config, labelPrefix) {
  const subTaskLabel = 'local demos';

  return new Promise((resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    gulp
      .src(`./${config.demos.path}/**`, {
        base: './'
      })
      .pipe(
        gulp.dest(
          `./${config.temp.path}/${tempSubpath}/${
            config.docs.nodeModulesPath
          }/${config.package.name}/`
        )
      )
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Copy all the dependencies so they can be editor with out affecting anything else.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function copyDependencies(gulp, config, labelPrefix) {
  const subTaskLabel = 'copy dependencies';

  return new Promise(async (resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
      subTaskLabel,
      labelPrefix
    );

    try {
      const subTasks = [
        copyDocsIndex(gulp, config, subTaskLabelPrefix),
        copyExtraDocDependencies(gulp, config, subTaskLabelPrefix),
        copyDistributionFiles(gulp, config, subTaskLabelPrefix),
        copyLocalDemos(gulp, config, subTaskLabelPrefix)
      ];

      // Only copy node modules if they aren't already in place.
      if (
        fs.existsSync(
          `./${config.temp.path}/${tempSubpath}/${config.docs.nodeModulesPath}`
        )
      ) {
        tasksUtil.tasks.log.info(
          'skipping copying of node modules - already in place.',
          subTaskLabelPrefix
        );
      } else {
        subTasks.push(copyNodeModules(gulp, config, subTaskLabelPrefix));
      }

      await tasksUtil.waitForAllPromises(subTasks);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      allOK = false;
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Update the analysis.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function updateAnalysis(gulp, config, labelPrefix) {
  const subTaskLabel = 'update analysis';

  return new Promise((resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    gulp
      .src(
        `./${config.temp.path}/${tempSubpath}/${config.docs.analysisFilename}`,
        {
          base: './'
        }
      )
      .pipe(
        modifyFile(content => {
          const analysis = JSON.parse(content);
          const typesToFix = ['elements', 'mixins'];
          for (const type of typesToFix) {
            if (analysis[type]) {
              for (const component of analysis[type]) {
                if (component.demos) {
                  for (const demo of component.demos) {
                    // Fix demo paths.
                    demo.url = `${config.docs.nodeModulesPath}/${
                      config.package.name
                    }/${demo.url}`;
                  }
                }
              }
            }
          }
          return JSON.stringify(analysis);
        })
      )
      .pipe(gulp.dest('./'))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Get the demos.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function getDemos(gulp, config, labelPrefix) {
  const subTaskLabel = 'get demos';

  return new Promise(async (resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
      subTaskLabel,
      labelPrefix
    );

    try {
      const files = await globPromise(
        `./${config.componenet.nodeModulesPath}/catalyst-*/package.json`
      );

      await cloneRepositories(files, config, subTaskLabelPrefix);

      for (const file of files) {
        const fileDirPath = path.dirname(file);
        const name =
          config.componenet.scope === null
            ? fileDirPath.substring(fileDirPath.lastIndexOf('/') + 1)
            : fileDirPath.substring(
                fileDirPath.lastIndexOf(config.componenet.scope)
              );
        const dir = `./${config.temp.path}/${tempSubpath}/demo-clones/${name}`;

        const base = path.normalize(
          config.componenet.scope === null ? `${dir}/..` : `${dir}/../..`
        );

        gulp
          .src(`${dir}/${config.demos.path}/**`, { base: base })
          .pipe(
            gulp.dest(
              `./${config.temp.path}/${tempSubpath}/${
                config.docs.nodeModulesPath
              }`
            )
          );
      }

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      allOK = false;
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Update the references in the index file.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function indexPageUpdateReferences(gulp, config, labelPrefix) {
  const subTaskLabel = 'index';

  return new Promise((resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    gulp
      .src(`./${config.temp.path}/${tempSubpath}/index.html`, { base: './' })
      .pipe(
        modifyFile(content => {
          let modifiedContent = content;
          modifiedContent = modifiedContent.replace(
            /\.\.\/\.\.\//g,
            `./${config.docs.nodeModulesPath}/`
          );

          return modifiedContent;
        })
      )
      .pipe(
        cheerio($ => {
          $('script[type="module"]').each((index, element) => {
            delete element.attribs.type;
            element.attribs.src = element.attribs.src.replace(/.mjs$/, '.js');
          });
        })
      )
      .pipe(gulp.dest('./'))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Update the references in each of the demos' pages.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function demosPagesUpdateReferences(gulp, config, labelPrefix) {
  const subTaskLabel = 'index';

  return new Promise((resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    gulp
      .src(
        `./${config.temp.path}/${tempSubpath}/${config.docs.nodeModulesPath}/${
          config.componenet.scope
        }/*/${config.demos.path}/*.html`,
        { base: './' }
      )
      .pipe(
        cheerio($ => {
          $('script[type="module"]').each((index, element) => {
            delete element.attribs.type;
            element.attribs.src = element.attribs.src.replace(/.mjs$/, '.js');
          });
        })
      )
      .pipe(gulp.dest('./'))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Update the references in the imported files.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function indexImportsUpdateReferences(gulp, config, labelPrefix) {
  const subTaskLabel = 'imports';

  return new Promise((resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    gulp
      .src(
        `./${config.temp.path}/${tempSubpath}/${config.docs.importsFilename}`,
        {
          base: './'
        }
      )
      .pipe(
        modifyFile(content => {
          return content.replace(
            /\.\.\/\.\.\//g,
            `./${config.docs.nodeModulesPath}/`
          );
        })
      )
      .pipe(gulp.dest('./'))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Update the references in the index file.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function indexUpdateReferences(gulp, config, labelPrefix) {
  const subTaskLabel = 'update references';

  return new Promise(async (resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
      subTaskLabel,
      labelPrefix
    );

    try {
      await tasksUtil.waitForAllPromises([
        indexPageUpdateReferences(gulp, config, subTaskLabelPrefix),
        indexImportsUpdateReferences(gulp, config, subTaskLabelPrefix)
      ]);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      allOK = false;
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Update the references in each of the demo files.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function demosUpdateReferences(gulp, config, labelPrefix) {
  const subTaskLabel = 'update references';

  return new Promise(async (resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
      subTaskLabel,
      labelPrefix
    );

    try {
      await tasksUtil.waitForAllPromises([
        demosPagesUpdateReferences(gulp, config, subTaskLabelPrefix)
      ]);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      allOK = false;
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Finalize the index page.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function finalizeIndexPage(gulp, config, labelPrefix) {
  const subTaskLabel = 'finalize';

  return new Promise((resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    const docsImportsBaseName = path.basename(
      config.docs.importsFilename,
      path.extname(config.docs.importsFilename)
    );

    const docsImportsImporterBaseName = path.basename(
      config.docs.importsImporterFilename,
      path.extname(config.docs.importsImporterFilename)
    );

    try {
      gulp
        .src(
          `./${config.temp.path}/${tempSubpath}/${
            config.docs.importsImporterFilename
          }`,
          {
            base: config.temp.path
          }
        )
        .pipe(named())
        .pipe(
          webpackStream(
            {
              target: 'web',
              mode: 'none',
              output: {
                chunkFilename: `${docsImportsBaseName}.[id].js`,
                filename: `${docsImportsImporterBaseName}.js`
              },
              plugins: [
                new PreWebpackClosureCompilerPlugin(),
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
        .pipe(
          foreach((stream, file) => {
            return stream
              .pipe(
                modifyFile(content => {
                  return content.replace(/\\\\\$/g, '$');
                })
              )
              .pipe(
                rename({
                  basename: path.basename(file.path, path.extname(file.path))
                })
              )
              .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`));
          })
        )
        .on('finish', () => {
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
          resolve();
        });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Finalize the demos.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function finalizeDemos(gulp, config, labelPrefix) {
  const subTaskLabel = 'finalize';

  return new Promise((resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    const demoImportsBaseName = path.basename(
      config.demos.importsFilename,
      path.extname(config.demos.importsFilename)
    );

    const docsImportsImporterBaseName = path.basename(
      config.demos.importsImporterFilename,
      path.extname(config.demos.importsImporterFilename)
    );

    gulp
      .src(
        `${config.temp.path}/${tempSubpath}/${config.docs.nodeModulesPath}/${
          config.componenet.scope
        }/*/${config.demos.path}/${config.demos.importsImporterFilename}`
      )
      .pipe(
        foreach((demoStream, demoFile) => {
          const output = path.dirname(demoFile.path);
          return demoStream
            .pipe(
              webpackStream(
                {
                  target: 'web',
                  mode: 'none',
                  output: {
                    chunkFilename: `${demoImportsBaseName}.[id].js`,
                    filename: `${docsImportsImporterBaseName}.js`
                  },
                  plugins: [
                    new PreWebpackClosureCompilerPlugin(),
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
            .pipe(
              foreach((builtStream, builtFile) => {
                return builtStream
                  .pipe(
                    modifyFile(content => {
                      return content.replace(/\\\\\$/g, '$');
                    })
                  )
                  .pipe(
                    rename({
                      basename: path.basename(builtFile.path, '.js')
                    })
                  )
                  .pipe(gulp.dest(output));
              })
            );
        })
      )
      .on('finish', () => {
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        resolve();
      });
  });
}

/**
 * Build the index page.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function buildIndexPage(gulp, config, labelPrefix) {
  const subTaskLabel = 'index page';

  return new Promise(async (resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
      subTaskLabel,
      labelPrefix
    );

    try {
      await indexUpdateReferences(gulp, config, subTaskLabelPrefix);
      await finalizeIndexPage(gulp, config, subTaskLabelPrefix);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      allOK = false;
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Build the index page.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function buildDemos(gulp, config, labelPrefix) {
  const subTaskLabel = 'demos';

  return new Promise(async (resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
      subTaskLabel,
      labelPrefix
    );

    try {
      await demosUpdateReferences(gulp, config, subTaskLabelPrefix);
      await finalizeDemos(gulp, config, subTaskLabelPrefix);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      allOK = false;
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Build the index page.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function build(gulp, config, labelPrefix) {
  const subTaskLabel = 'build';

  return new Promise(async (resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
      subTaskLabel,
      labelPrefix
    );

    try {
      await tasksUtil.waitForAllPromises([
        buildIndexPage(gulp, config, subTaskLabelPrefix),
        buildDemos(gulp, config, subTaskLabelPrefix)
      ]);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      allOK = false;
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Generate the docs.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function generate(gulp, config, labelPrefix) {
  const subTaskLabel = 'generate';

  return new Promise((resolve, reject) => {
    // No point starting this task if another important task has already failed.
    if (!allOK) {
      reject(new tasksUtil.NotOKError());
      return;
    }

    try {
      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      const docsImportsBaseName = path.basename(
        config.docs.importsFilename,
        path.extname(config.docs.importsFilename)
      );

      const docsImportsImporterBaseName = path.basename(
        config.docs.importsImporterFilename,
        path.extname(config.docs.importsImporterFilename)
      );

      const buildConfig = {
        root: `${config.temp.path}/${tempSubpath}/`,
        entrypoint: `index${path.extname(config.docs.indexPage)}`,
        fragments: [],
        sources: [
          `${config.docs.nodeModulesPath}/${
            config.componenet.scope
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

      const docBuilder = new PolymerBuild.PolymerProject(buildConfig);
      const sourcesHtmlSplitter = new PolymerBuild.HtmlSplitter();

      mergeStream(docBuilder.sources(), docBuilder.dependencies())
        .pipe(docBuilder.addCustomElementsEs5Adapter())
        .pipe(sourcesHtmlSplitter.split())
        .pipe(gulpIf(/\.html$/, htmlmin({ collapseWhitespace: true })))
        .pipe(gulpIf(/\.css$/, postcss([], config.build.postcss.options)))
        .pipe(sourcesHtmlSplitter.rejoin())
        .pipe(
          rename(filepath => {
            const prefix = path.normalize(`${config.temp.path}/${tempSubpath}`);
            if (filepath.dirname.indexOf(prefix) === 0) {
              filepath.dirname = path.normalize(
                filepath.dirname.substring(prefix.length)
              );
            }
          })
        )
        .pipe(gulp.dest(`./${config.docs.path}`))
        .on('finish', () => {
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
          resolve();
        });
    } catch (error) {
      allOK = false;
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

// Export the build docs function.
module.exports = (gulp, config) => {
  return new Promise(async (resolve, reject) => {
    try {
      await copyDependencies(gulp, config);
      await updateAnalysis(gulp, config);
      await getDemos(gulp, config);
      await build(gulp, config);
      await tasksUtil.cleanDocs(config);
      await generate(gulp, config);
      resolve();
    } catch (error) {
      console.error(error);
      reject(error);
    }
  });
};
