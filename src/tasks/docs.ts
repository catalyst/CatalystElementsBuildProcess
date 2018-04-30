// Libraries.
import cheerio from 'cheerio';
import escodegen from 'escodegen';
import esprima from 'esprima';
import { constants, existsSync } from 'fs';
import { access, readdir, readFile } from 'fs/promises';
import glob from 'glob';
import GulpClient from 'gulp';
import flatmap from 'gulp-flatmap';
import { checkout, clone } from 'gulp-git';
import htmlmin from 'gulp-htmlmin';
import gulpIf from 'gulp-if';
import modifyFile from 'gulp-modify-file';
import rename from 'gulp-rename';
import mergeStream from 'merge-stream';
import { basename, extname, normalize } from 'path';
import { dirname } from 'path';
import PolymerBuild from 'polymer-build';
import { Stream } from 'stream';
import { promisify } from 'util';
import VinylFile from 'vinyl';
import named from 'vinyl-named';
import * as webpack from 'webpack';
import webpackStream from 'webpack-stream';

import { IConfig } from '../config';
import {
  cleanDocs,
  getWebpackPlugIns,
  tasksHelpers,
  UnrecoverableError,
  waitForAllPromises
} from '../util';

// Promisified functions.
const gitClone = promisify(clone);
const gitCheckout = promisify(checkout);
const globPromise = promisify(glob);

// The temp
const tempSubpath = 'docs';

// States if everything is ok. i.e. No important tasks have failed.
let allOK = true;

/**
 * Test if a directory is ready for cloning.
 *
 * @param dirPath - Path of the directory to check
 */
function directoryReadyForCloning(dirPath: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      if (existsSync(dirPath)) {
        await access(dirPath, constants.R_OK | constants.W_OK);

        const files = await readdir(dirPath, 'utf8');

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
 * @param repoPath - The path to the repo
 * @param dirPath - The path to clone the repo into
 * @param labelPrefix - A prefix to print before the label
 */
function cloneRepository(
  repoPath: string,
  dirPath: string,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = `clone of ${repoPath}`;

  return new Promise(async (resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      await gitClone(repoPath, { args: `${dirPath} --quiet` });

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
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
function cloneRepositories(
  packageFilePaths: string[],
  config: IConfig,
  labelPrefix?: string
): Promise<void[]> {
  const repos: Array<Promise<void>> = [];

  for (const packageFilePath of packageFilePaths) {
    repos.push(
      // eslint-disable-next-line no-loop-func
      new Promise(async (resolve, reject) => {
        try {
          const data = await readFile(packageFilePath, 'utf8');
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
                throw new Error(`"${repository}" is not a git repository.`);
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
            tasksHelpers.log.info(
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
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function copyNodeModules(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'node modules';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

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
 * Copy the docs' index page.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function copyDocsIndex(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'index page';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

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
 * Copy the docs' extra dependencies.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function copyExtraDocDependencies(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'extra dependencies';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src([
          `./${config.docs.importsImporterFilename}`,
          `./${config.docs.importsFilename}`,
          `./${config.docs.analysisFilename}`
        ])
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
 * Copy over all the distribution files.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function copyDistributionFiles(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'distribution files';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

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
 * Copy over the demos in the demos folder.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function copyLocalDemos(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'local demos';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

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
 * Copy all the dependencies so they can be editor with out affecting anything else.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function copyDependencies(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'copy dependencies';

  return new Promise(async (resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      const subTaskLabelPrefix = tasksHelpers.log.starting(
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
        existsSync(
          `./${config.temp.path}/${tempSubpath}/${config.docs.nodeModulesPath}`
        )
      ) {
        tasksHelpers.log.info(
          'skipping copying of node modules - already in place.',
          subTaskLabelPrefix
        );
      } else {
        subTasks.push(copyNodeModules(gulp, config, subTaskLabelPrefix));
      }

      await waitForAllPromises(subTasks);

      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      allOK = false;
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Update the analysis.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function updateAnalysis(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'update analysis';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

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
          modifyFile((content: string) => {
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
 * Get the demos.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function getDemos(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'get demos';

  return new Promise(async (resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      const subTaskLabelPrefix = tasksHelpers.log.starting(
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
          const fileDirPath = dirname(file);
          const name =
            config.componenet.scope == null
              ? fileDirPath.substring(fileDirPath.lastIndexOf('/') + 1)
              : fileDirPath.substring(
                  fileDirPath.lastIndexOf(config.componenet.scope)
                );
          const dir = `./${
            config.temp.path
          }/${tempSubpath}/demo-clones/${name}`;

          const base = normalize(
            config.componenet.scope === null ? `${dir}/..` : `${dir}/../..`
          );

          promises.push(
            new Promise((resolve, reject) => {
              gulp
                .src(`${dir}/${config.demos.path}/**`, { base })
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
                .on('error', (error: Error) => {
                  reject(error);
                });
            })
          );
        }

        await waitForAllPromises(promises);
      }

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Update the references in the index file.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function indexPageUpdateReferences(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'index';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(`./${config.temp.path}/${tempSubpath}/index.html`, { base: './' })
        .pipe(
          modifyFile((content: string) => {
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
 * Update the references in each of the demos' pages.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function demosPagesUpdateReferences(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'demo files';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(
          `./${config.temp.path}/${tempSubpath}/${
            config.docs.nodeModulesPath
          }/${config.componenet.scope}/*/${config.demos.path}/*.html`,
          { base: './' }
        )
        .pipe(
          modifyFile((content: string) => {
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
 * Update the references in the imported files.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function indexImportsUpdateReferences(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'imports';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src(
          `./${config.temp.path}/${tempSubpath}/${config.docs.importsFilename}`,
          {
            base: './'
          }
        )
        .pipe(
          modifyFile((content: string) => {
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
 * Update the references in the index file.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function indexUpdateReferences(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'update references';

  return new Promise(async (resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      const subTaskLabelPrefix = tasksHelpers.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await waitForAllPromises([
        indexPageUpdateReferences(gulp, config, subTaskLabelPrefix),
        indexImportsUpdateReferences(gulp, config, subTaskLabelPrefix)
      ]);

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Update the references in each of the demo files.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function demosUpdateReferences(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'update references';

  return new Promise(async (resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      const subTaskLabelPrefix = tasksHelpers.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await waitForAllPromises([
        demosPagesUpdateReferences(gulp, config, subTaskLabelPrefix)
      ]);

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Finalize the index page.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function finalizeIndexPage(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'finalize';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      const docsImportsBaseName = basename(
        config.docs.importsFilename,
        extname(config.docs.importsFilename)
      );

      const docsImportsImporterBaseName = basename(
        config.docs.importsImporterFilename,
        extname(config.docs.importsImporterFilename)
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
              mode: 'none',
              output: {
                chunkFilename: `${docsImportsBaseName}.[id].js`,
                filename: `${docsImportsImporterBaseName}.js`
              },
              plugins: getWebpackPlugIns(),
              target: 'web'
            },
            webpack
          )
        )
        .pipe(
          flatmap((stream: Stream, file: VinylFile) => {
            return stream
              .pipe(
                modifyFile((content: string) => {
                  return content.replace(/\\\\\$/g, '$');
                })
              )
              .pipe(
                rename({
                  basename: basename(file.path, extname(file.path))
                })
              )
              .pipe(gulp.dest(`./${config.temp.path}/${tempSubpath}`));
          })
        )
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
 * Finalize the demos.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function finalizeDemos(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'finalize';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      const demoImportsBaseName = basename(
        config.demos.importsFilename,
        extname(config.demos.importsFilename)
      );

      const docsImportsImporterBaseName = basename(
        config.demos.importsImporterFilename,
        extname(config.demos.importsImporterFilename)
      );

      gulp
        .src(
          `${config.temp.path}/${tempSubpath}/${config.docs.nodeModulesPath}/${
            config.componenet.scope
          }/*/${config.demos.path}/${config.demos.importsImporterFilename}`
        )
        .pipe(
          flatmap((demoStream: Stream, demoFile: VinylFile) => {
            const output = dirname(demoFile.path);
            return demoStream
              .pipe(
                webpackStream(
                  {
                    mode: 'none',
                    output: {
                      chunkFilename: `${demoImportsBaseName}.[id].js`,
                      filename: `${docsImportsImporterBaseName}.js`
                    },
                    plugins: getWebpackPlugIns(),
                    target: 'web'
                  },
                  webpack
                )
              )
              .pipe(
                flatmap((builtStream: Stream, builtFile: VinylFile) => {
                  return builtStream
                    .pipe(
                      modifyFile((content: string) => {
                        return content.replace(/\\\\\$/g, '$');
                      })
                    )
                    .pipe(
                      rename({
                        basename: basename(builtFile.path, '.js')
                      })
                    )
                    .pipe(gulp.dest(output));
                })
              );
          })
        )
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
 * Build the index page.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function buildIndexPage(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'index page';

  return new Promise(async (resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      const subTaskLabelPrefix = tasksHelpers.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await indexUpdateReferences(gulp, config, subTaskLabelPrefix);
      await finalizeIndexPage(gulp, config, subTaskLabelPrefix);

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Build the index page.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function buildDemos(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'demos';

  return new Promise(async (resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      const subTaskLabelPrefix = tasksHelpers.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await demosUpdateReferences(gulp, config, subTaskLabelPrefix);
      await finalizeDemos(gulp, config, subTaskLabelPrefix);

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Build the index page.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function build(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'build';

  return new Promise(async (resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      const subTaskLabelPrefix = tasksHelpers.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await buildIndexPage(gulp, config, subTaskLabelPrefix);
      await buildDemos(gulp, config, subTaskLabelPrefix);

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      allOK = false;
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Generate the docs.
 *
 * @param  gulp - Gulp library
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function generate(
  gulp: GulpClient.Gulp,
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'generate';

  return new Promise((resolve, reject) => {
    try {
      // No point starting this task if another important task has already failed.
      if (!allOK) {
        throw new UnrecoverableError();
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      const docsImportsBaseName = basename(
        config.docs.importsFilename,
        extname(config.docs.importsFilename)
      );

      const docsImportsImporterBaseName = basename(
        config.docs.importsImporterFilename,
        extname(config.docs.importsImporterFilename)
      );

      const buildConfig = {
        root: `${config.temp.path}/${tempSubpath}/`,
        entrypoint: `index${extname(config.docs.indexPage)}`,
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
        .pipe(gulpIf(/\.html$/, htmlmin(config.build.tools.htmlMinifier)))
        .pipe(sourcesHtmlSplitter.rejoin())
        .pipe(
          rename(filepath => {
            const prefix = normalize(`${config.temp.path}/${tempSubpath}`);
            if (filepath.dirname && filepath.dirname.indexOf(prefix) === 0) {
              filepath.dirname = normalize(
                filepath.dirname.substring(prefix.length)
              );
            }
          })
        )
        .pipe(gulp.dest(`./${config.docs.path}`))
        .on('finish', () => {
          resolve();
          tasksHelpers.log.successful(subTaskLabel, labelPrefix);
        })
        .on('error', (error: Error) => {
          throw error;
        });
    } catch (error) {
      allOK = false;
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Build the docs for the component.
 *
 * @param gulp
 * @param config
 */
export function buildDocs(gulp: GulpClient.Gulp, config: IConfig) {
  return new Promise(async (resolve, reject) => {
    try {
      await copyDependencies(gulp, config);
      await updateAnalysis(gulp, config);
      await getDemos(gulp, config);
      await build(gulp, config);
      await cleanDocs(config);
      await generate(gulp, config);

      resolve();
    } catch (error) {
      reject(error);
    }
  });
}
