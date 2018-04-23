// Load util.
const tasksUtil = require('./util');

// Libraries.
const cheerio = require('cheerio');
const escodegen = require('escodegen');
const esprima = require('esprima');
const flatmap = require('gulp-flatmap');
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
const rename = require('gulp-rename');
const util = require('util');
const webpack = require('webpack');
const webpackStream = require('webpack-stream');

// Promisified functions.
const fsAccess = util.promisify(fs.access);
const fsReaddir = util.promisify(fs.readdir);
const fsReadfile = util.promisify(fs.readFile);
const gitClone = util.promisify(git.clone);
const gitCheckout = util.promisify(git.checkout);
const globPromise = util.promisify(glob);

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
    try {
      if (fs.existsSync(dirPath)) {
        await fsAccess(dirPath, fs.constants.R_OK | fs.constants.W_OK);

        const files = await fsReaddir(dirPath, 'utf8');

        if (files.length === 0) {
          resolve();
        } else {
          reject(new Error('Directory not empty.'));
        }
      } else {
        resolve();
      }
    } catch (error) {
      reject(error);
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
    try {
      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      await gitClone(repoPath, { args: `${dirPath} --quiet` });

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
        try {
          const data = await fsReadfile(packageFilePath, 'utf8');
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
            throw new Error(
              `Repository not set in ${name}'s package.json file.`
            );
          }

          const repoPath = (() => {
            let p = '';
            if (typeof repository === 'object') {
              if (repository.type !== 'git') {
                throw new Error(`"${repoPath}" is not a git repository.`);
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
        } catch (error) {
          reject(error);
        }
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(`./${config.nodeModulesPath}/**`, { follow: true })
        .pipe(
          gulp.dest(
            `./${config.temp.path}/${tempSubpath}/${
              config.docs.nodeModulesPath
            }`
          )
        )
        .on('finish', () => {
          resolve();
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
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
          resolve();
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
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
          resolve();
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
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
          resolve();
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
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
          resolve();
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
      }

      const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
        subTaskLabel,
        labelPrefix
      );

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
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(
          `./${config.temp.path}/${tempSubpath}/${
            config.docs.analysisFilename
          }`,
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
          resolve();
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
      }

      const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
        subTaskLabel,
        labelPrefix
      );

      const files = await globPromise(
        `./${config.componenet.nodeModulesPath}/catalyst-*/package.json`
      );

      if (files.length > 0) {
        await cloneRepositories(files, config, subTaskLabelPrefix);

        const promises = [];

        for (const file of files) {
          const fileDirPath = path.dirname(file);
          const name =
            config.componenet.scope === null
              ? fileDirPath.substring(fileDirPath.lastIndexOf('/') + 1)
              : fileDirPath.substring(
                  fileDirPath.lastIndexOf(config.componenet.scope)
                );
          const dir = `./${
            config.temp.path
          }/${tempSubpath}/demo-clones/${name}`;

          const base = path.normalize(
            config.componenet.scope === null ? `${dir}/..` : `${dir}/../..`
          );

          promises.push(
            new Promise((resolve, reject) => {
              gulp
                .src(`${dir}/${config.demos.path}/**`, { base: base })
                .pipe(
                  gulp.dest(
                    `./${config.temp.path}/${tempSubpath}/${
                      config.docs.nodeModulesPath
                    }`
                  )
                )
                .on('finish', () => {
                  resolve();
                })
                .on('error', error => {
                  reject(error);
                });
            })
          );
        }

        await tasksUtil.waitForAllPromises(promises);
      }

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(`./${config.temp.path}/${tempSubpath}/index.html`, { base: './' })
        .pipe(
          modifyFile(content => {
            const $ = cheerio.load(content);
            $('script').each((index, element) => {
              if (element.attribs.type === 'module') {
                delete element.attribs.type;
              }
              element.attribs.src = element.attribs.src
                .replace(/^\.\.\/\.\.\//, `${config.docs.nodeModulesPath}/`)
                .replace(/.mjs$/, '.js');
            });

            return $.html();
          })
        )
        .pipe(gulp.dest('./'))
        .on('finish', () => {
          resolve();
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
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
  const subTaskLabel = 'demo files';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(
          `./${config.temp.path}/${tempSubpath}/${
            config.docs.nodeModulesPath
          }/${config.componenet.scope}/*/${config.demos.path}/*.html`,
          { base: './' }
        )
        .pipe(
          modifyFile(content => {
            const $ = cheerio.load(content);
            $('script[type="module"]').each((index, element) => {
              delete element.attribs.type;
              element.attribs.src = element.attribs.src.replace(/.mjs$/, '.js');
            });

            return $.html();
          })
        )
        .pipe(gulp.dest('./'))
        .on('finish', () => {
          resolve();
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
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
            const parsedCode = esprima.parseModule(content);

            // Static imports declaration must be defined in the body.
            // This file should only have static imports.
            for (const node of parsedCode.body) {
              if (node.type === 'ImportDeclaration') {
                if (
                  node.source != null &&
                  node.source.type === 'Literal' &&
                  typeof node.source.value === 'string'
                ) {
                  node.source.value = node.source.value.replace(
                    /\.\.\/\.\.\//g,
                    `./${config.docs.nodeModulesPath}/`
                  );
                  node.source.raw = `'${node.source.value}'`;
                }
              }
            }

            return escodegen.generate(parsedCode);
          })
        )
        .pipe(gulp.dest('./'))
        .on('finish', () => {
          resolve();
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
function indexUpdateReferences(gulp, config, labelPrefix) {
  const subTaskLabel = 'update references';

  return new Promise(async (resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
      }

      const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await tasksUtil.waitForAllPromises([
        indexPageUpdateReferences(gulp, config, subTaskLabelPrefix),
        indexImportsUpdateReferences(gulp, config, subTaskLabelPrefix)
      ]);

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
      }

      const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await tasksUtil.waitForAllPromises([
        demosPagesUpdateReferences(gulp, config, subTaskLabelPrefix)
      ]);

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
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
              plugins: tasksUtil.getWebpackPlugIns()
            },
            webpack
          )
        )
        .pipe(
          flatmap((stream, file) => {
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
          resolve();
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
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
          flatmap((demoStream, demoFile) => {
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
                    plugins: tasksUtil.getWebpackPlugIns()
                  },
                  webpack
                )
              )
              .pipe(
                flatmap((builtStream, builtFile) => {
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
          resolve();
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
function buildIndexPage(gulp, config, labelPrefix) {
  const subTaskLabel = 'index page';

  return new Promise(async (resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
      }

      const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await indexUpdateReferences(gulp, config, subTaskLabelPrefix);
      await finalizeIndexPage(gulp, config, subTaskLabelPrefix);

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
      }

      const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await demosUpdateReferences(gulp, config, subTaskLabelPrefix);
      await finalizeDemos(gulp, config, subTaskLabelPrefix);

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
      }

      const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await buildIndexPage(gulp, config, subTaskLabelPrefix);
      await buildDemos(gulp, config, subTaskLabelPrefix);

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new tasksUtil.NotOKError();
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
        .pipe(gulpIf(/\.html$/, htmlmin(config.build.htmlMinifier)))
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
          resolve();
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      allOK = false;
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
      reject(error);
    }
  });
};
