// Load util.
const tasksUtil = require('./util');

// Libraries.
const foreach = require('gulp-foreach');
const fs = require('fs');
const git = require('gulp-git');
const glob = require('glob');
const inject = require('gulp-inject');
const mergeStream = require('merge-stream');
const modifyFile = require('gulp-modify-file');
const named = require('vinyl-named');
const path = require('path');
const PolymerProject = require('polymer-build');
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
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function cloneRepository(repoPath, dirPath, labelDepth = 1) {
  const subTaskLabel = `cloning: ${repoPath}`;

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    try {
      await gitClone(repoPath, { args: `${dirPath} --quiet` });
      tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(labelDepth, subTaskLabel);
      reject(error);
    }
  });
}

/**
 * Clone all the repos specified by the given package.json files.
 *
 * @param {string[]} packageFiles
 *   Array of file paths to the package.json files that contrain the infomation
 *   about the repos to clone
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function cloneRepositories(packageFiles, config, labelDepth = 1) {
  const repos = [];

  for (const packageFile of packageFiles) {
    repos.push(
      // eslint-disable-next-line no-loop-func
      new Promise(async (resolve, reject) => {
        const data = fs.readFileSync(packageFile);

        const json = JSON.parse(data);
        const name = json.name;
        const version = json.version;
        const repository = json.repository;

        if (repository == null) {
          reject(
            new Error(`Repository not set in ${name}'s package.json file.`)
          );
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
            labelDepth,
            `skipping clone ${repoPath} - output dir not empty.`
          );
        } else {
          await cloneRepository(repoPath, clonePath, labelDepth);
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
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function copyNodeModules(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'node modules';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    gulp
      .src('./node_modules/**', { follow: true })
      .pipe(
        gulp.dest(
          `./${config.temp.path}/${tempSubpath}/${config.docs.nodeModulesPath}`
        )
      )
      .on('finish', () => {
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Copy the docs' index page.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function copyDocsIndex(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'index page';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    gulp
      .src(`./${config.docs.indexPage}`)
      .pipe(
        rename({
          basename: 'index'
        })
      )
      .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Copy the docs' extra dependencies.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function copyExtraDocDependencies(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'extra dependencies';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    gulp
      .src([
        `./${config.docs.importsImporterFilename}`,
        `./${config.docs.importsFilename}`,
        `./${config.docs.analysisFilename}`
      ])
      .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Copy over all the distribution files.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function copyDistributionFiles(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'distribution files';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

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
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Copy over the demos in the demos folder.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function copyLocalDemos(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'local demos';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

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
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Copy all the dependencies so they can be editor with out affecting anything else.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function copyDependencies(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'copy dependencies';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    try {
      await Promise.all([
        copyNodeModules(gulp, config, labelDepth + 1),
        copyDocsIndex(gulp, config, labelDepth + 1),
        copyExtraDocDependencies(gulp, config, labelDepth + 1),
        copyDistributionFiles(gulp, config, labelDepth + 1),
        copyLocalDemos(gulp, config, labelDepth + 1)
      ]);

      tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(labelDepth, subTaskLabel);
      reject(error);
    }
  });
}

/**
 * Update the analysis.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function updateAnalysis(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'update analysis';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

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
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Get the demos.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function getDemos(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'get demos';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    try {
      const files = await globPromise(
        `./${config.componenet.nodeModulesPath}/catalyst-*/package.json`
      );

      await cloneRepositories(files, config, labelDepth + 1);

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

      tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(labelDepth, subTaskLabel);
      reject(error);
    }
  });
}

/**
 * Inject the custom-elements-es5-adapter into the index page.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function indexInjectCustomElementsES5Adapter(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'inject ES5 Adapter';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    gulp
      .src(`./${config.temp.path}/${tempSubpath}/index.html`, { base: './' })
      .pipe(
        // FIXME: Find a better way to do this.
        // The file specified here don't matter but exactly one is needed.
        inject(gulp.src('./gulpfile.js', { base: './', read: false }), {
          starttag: '<!-- [[inject:custom-elements-es5-adapter]] -->',
          endtag: '<!-- [[endinject]] -->',
          removeTags: true,
          transform: () =>
            '<script src="../../@webcomponents/webcomponentsjs/custom-elements-es5-adapter.js"></script>'
        })
      )
      .pipe(gulp.dest('./'))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Inject the custom-elements-es5-adapter into each of the demo pages.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function demosInjectCustomElementsES5Adapter(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'inject ES5 Adapter';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    gulp
      .src(
        `./${config.temp.path}/${tempSubpath}/${config.docs.nodeModulesPath}/${
          config.componenet.scope
        }/*/${config.demos.path}/**/*.html`,
        { base: './' }
      )
      .pipe(
        foreach((stream, file) => {
          const relPath = path.relative(
            path.join(file.cwd, file.base),
            file.path
          );
          const dir = path.dirname(relPath);

          const es5AdapterSrc = path.relative(
            dir,
            `./${config.temp.path}/${tempSubpath}/${
              config.docs.nodeModulesPath
            }/@webcomponents/webcomponentsjs/custom-elements-es5-adapter.js`
          );
          return stream
            .pipe(
              // FIXME: Find a better way to do this.
              // The file specified here don't matter but exactly one is needed.
              inject(gulp.src('./gulpfile.js', { base: './', read: false }), {
                starttag: '<!-- [[inject:custom-elements-es5-adapter]] -->',
                endtag: '<!-- [[endinject]] -->',
                removeTags: true,
                transform: () => `<script src="${es5AdapterSrc}"></script>`
              })
            )
            .pipe(gulp.dest('./'));
        })
      )
      .on('finish', () => {
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Update the references in the index file.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function indexPageUpdateReferences(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'index';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    gulp
      .src(`./${config.temp.path}/${tempSubpath}/index.html`, { base: './' })
      .pipe(
        modifyFile(content => {
          let modifiedContent = content;
          modifiedContent = modifiedContent.replace(
            /\.\.\/\.\.\//g,
            `./${config.docs.nodeModulesPath}/`
          );

          // FIXME: Remove `type="module"` from script tags in a more fullprof way.
          return modifiedContent.replace(/<script type="module"/g, '<script');
        })
      )
      .pipe(gulp.dest('./'))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Update the references in each of the demos' pages.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function demosPagesUpdateReferences(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'index';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    gulp
      .src(
        `./${config.temp.path}/${tempSubpath}/${config.docs.nodeModulesPath}/${
          config.componenet.scope
        }/*/${config.demos.path}/*.html`,
        { base: './' }
      )
      .pipe(
        modifyFile(content => {
          // FIXME: Remove `type="module"` from script tags in a more fullprof way.
          return content.replace(/<script type="module"/g, '<script');
        })
      )
      .pipe(gulp.dest('./'))
      .on('finish', () => {
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Update the references in the imported files.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function indexImportsUpdateReferences(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'imports';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

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
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Update the references in the index file.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function indexUpdateReferences(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'update references';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    try {
      await indexPageUpdateReferences(gulp, config, labelDepth + 1);
      await indexImportsUpdateReferences(gulp, config, labelDepth + 1);

      tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(labelDepth, subTaskLabel);
      reject(error);
    }
  });
}

/**
 * Update the references in each of the demo files.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function demosUpdateReferences(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'update references';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    try {
      await demosPagesUpdateReferences(gulp, config, labelDepth + 1);

      tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(labelDepth, subTaskLabel);
      reject(error);
    }
  });
}

/**
 * Finalize the index page.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function finalizeIndexPage(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'finalize';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    const docsImportsBaseName = path.basename(
      config.docs.importsFilename,
      '.js'
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
              filename: `${config.docs.importsImporterFilename}`
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
                basename: path.basename(file.path, '.js')
              })
            )
            .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`));
        })
      )
      .on('finish', () => {
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Finalize the demos.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function finalizeDemos(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'finalize';

  return new Promise(resolve => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    const demoImportsBaseName = path.basename(
      config.demos.importsFilename,
      '.js'
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
                    filename: `${config.demos.importsImporterFilename}`
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
        tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
        resolve();
      });
  });
}

/**
 * Build the index page.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function buildIndexPage(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'index page';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    try {
      await indexInjectCustomElementsES5Adapter(gulp, config, labelDepth + 1);
      await indexUpdateReferences(gulp, config, labelDepth + 1);
      await finalizeIndexPage(gulp, config, labelDepth + 1);

      tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(labelDepth, subTaskLabel);
      reject(error);
    }
  });
}

/**
 * Build the index page.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function buildDemos(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'demos';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    try {
      await demosInjectCustomElementsES5Adapter(gulp, config, labelDepth + 1);
      await demosUpdateReferences(gulp, config, labelDepth + 1);
      await finalizeDemos(gulp, config, labelDepth + 1);

      tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(labelDepth, subTaskLabel);
      reject(error);
    }
  });
}

/**
 * Build the index page.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function build(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'build';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

    try {
      await Promise.all([
        buildIndexPage(gulp, config, labelDepth + 1),
        buildDemos(gulp, config, labelDepth + 1)
      ]);

      tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(labelDepth, subTaskLabel);
      reject(error);
    }
  });
}

/**
 * Generate the docs.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function generate(gulp, config, labelDepth = 1) {
  const subTaskLabel = 'generate';

  return new Promise((resolve, reject) => {
    try {
      tasksUtil.tasks.log.starting(labelDepth, subTaskLabel);

      const docsImportsBaseName = path.basename(
        config.docs.importsFilename,
        '.js'
      );

      const buildConfig = {
        root: `${config.temp.path}/${tempSubpath}/`,
        entrypoint: 'index.html',
        fragments: [],
        sources: [
          `${config.docs.nodeModulesPath}/${
            config.componenet.scope
          }/catalyst-*/**`
        ],
        extraDependencies: [
          `${
            config.docs.nodeModulesPath
          }/@webcomponents/webcomponentsjs/[!gulpfile]*.js`,
          `${
            config.docs.nodeModulesPath
          }/@webcomponents/shadycss/[!gulpfile]*.js`,
          `${config.docs.importsImporterFilename}`,
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

      const docBuilder = new PolymerProject.Builder(buildConfig);

      mergeStream(docBuilder.sources(), docBuilder.dependencies())
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
          tasksUtil.tasks.log.successful(labelDepth, subTaskLabel);
          resolve();
        });
    } catch (error) {
      tasksUtil.tasks.log.failed(labelDepth, subTaskLabel);
      reject(error);
    }
  });
}

// Export the build docs function.
module.exports = (gulp, config) => {
  return new Promise(async resolve => {
    await tasksUtil.cleanDocs(config);
    await copyDependencies(gulp, config);
    await updateAnalysis(gulp, config);
    await getDemos(gulp, config);
    await build(gulp, config);
    await generate(gulp, config);
    resolve();
  });
};
