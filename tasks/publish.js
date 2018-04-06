// Load util.
const tasksUtil = require('./util');

// Libraries.
const archiver = require('archiver');
const colors = require('ansi-colors');
const del = require('del');
const escapeStringRegexp = require('escape-string-regexp');
const exec = require('exec-chainable');
const fs = require('fs');
const git = require('gulp-git');
const modifyFile = require('gulp-modify-file');
const path = require('path');
const prompt = require('prompt');
const release = require('gulp-github-release');
const util = require('util');

// Promisified functions.
const gitCheckout = util.promisify(git.checkout);
const gitMerge = util.promisify(git.merge);
const gitRevParse = util.promisify(git.revParse);
const gitPush = util.promisify(git.push);
const gitStatus = util.promisify(git.status);
const gitTag = util.promisify(git.tag);
const promptGet = util.promisify(prompt.get);

/**
 * Prompt the user for information about how to publish.
 *
 * @param {Object} config - Config settings
 * @param {Object} info - Publishing info
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function promptUserForPublishSettings(config, info, labelPrefix) {
  const subTaskLabel = 'publish settings';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      prompt.start();

      const versionResult = await promptGet({
        properties: {
          version: {
            description: 'Release semantic version',
            type: 'string',
            pattern: /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/gi,
            message: 'Must be a semantic version e.g. 1.2.3',
            required: true
          }
        }
      });

      const prereleaseVersion =
        versionResult.version.search(
          /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/gi
        ) !== 0;

      const npmResult = await promptGet({
        properties: {
          npmTag: {
            description: 'npm-dist-tag',
            type: 'string',
            pattern: /^[a-z][a-z0-9-_]*$/gi,
            message: 'Invalid tag',
            default: prereleaseVersion ? 'beta' : 'latest',
            required: true
          }
        }
      });

      const input = {
        version: versionResult.version,
        prereleaseVersion: prereleaseVersion,
        npmTag: npmResult.npmTag
      };

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve(input);
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Prompt the user for information about the git release settings.
 *
 * @param {Object} config - Config settings
 * @param {Object} info - Publishing info
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function promptUserForGitReleaseSettings(config, info, labelPrefix) {
  const subTaskLabel = 'publish settings';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      prompt.start();

      const input = {};

      const pushResult = await promptGet({
        properties: {
          push: {
            description: 'Push changes to GitHub?',
            type: 'boolean',
            default: true,
            required: true
          }
        }
      });

      input.push = pushResult.push;

      if (pushResult.push) {
        const releaseResult = await promptGet({
          properties: {
            createRelease: {
              description: 'Create a GitHub release',
              type: 'boolean',
              default: true,
              required: true
            }
          }
        });

        input.createRelease = releaseResult.createRelease;

        if (releaseResult.createRelease) {
          const releaseSettingsResult = await promptGet({
            properties: {
              token: {
                description: 'GitHub access token',
                type: 'string',
                default: process.env.GITHUB_TOKEN,
                required: true
              },
              name: {
                description: 'Release name',
                type: 'string',
                default: info.gitTag,
                required: true
              },
              notes: {
                description: 'Release notes',
                type: 'string'
              },
              draft: {
                description: 'Draft release',
                type: 'boolean',
                default: false,
                required: true
              }
            }
          });

          input.releaseSettings = {
            token: releaseSettingsResult.token,
            tag: info.gitTag,
            name: releaseSettingsResult.name,
            notes: releaseSettingsResult.notes,
            draft: releaseSettingsResult.draft,
            prerelease: info.prereleaseVersion,
            manifest: config.package
          };
        }
      }

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve(input);
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Make sure git is ok.
 *
 * @param {Object} config - Config settings
 * @param {Object} info - Publishing info
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function gitChecks(config, info, labelPrefix) {
  const subTaskLabel = 'is git ok';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      // Ensure the working director is clean.
      const status = await gitStatus({ args: '--porcelain' });
      if (status !== '') {
        tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
        reject(new Error('Cannot publish - working directory is not clean.'));
        return;
      }

      // Ensure we are on a branch we can publish from.
      const branchMuchMatch = info.prereleaseVersion
        ? config.publish.prereleaseBranchRegex
        : new RegExp(`^${escapeStringRegexp(config.publish.masterBranch)}$`);

      if (info.currentBranch.search(branchMuchMatch) < 0) {
        tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
        reject(
          new Error(
            info.prereleaseVersion
              ? `Cannot publish prerelease - not on valid prerelease branch. Branch name much match this regex: ${config.publish.prereleaseBranchRegex.toString()}`
              : `Cannot publish - you must be on "${
                  config.publish.masterBranch
                }" branch to publish.`
          )
        );
        return;
      }

      // Ensure the their are no un pulled changes.
      await exec('git fetch --quiet');

      if (
        (await gitRevParse({ args: 'HEAD' })) ===
        (await gitRevParse({ args: '@{u}' }))
      ) {
        tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
        reject(
          new Error(
            'Cannot publish - remote history differ. Please pull changes.'
          )
        );
        return;
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
 * Make sure all the files are ok.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function checkFiles(gulp, config, labelPrefix) {
  const subTaskLabel = 'check files';

  return new Promise((resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      // Make sure the dist directory exists.
      if (!fs.existsSync(config.dist.path)) {
        tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
        reject(
          new Error(`Dist directory (${config.dist.path}) does not exist.`)
        );
        return;
      }

      // Ensure there are files to publish.
      const distFiles = fs.readdirSync(config.dist.path);
      if (distFiles.length === 0) {
        tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
        reject(new Error('No files to publish.'));
        return;
      }

      if (config.publish.checkFiles.module) {
        // Ensure the module file are present if the config says it should be.
        const moduleFile = `${config.componenet.name}${
          config.build.module.extension
        }`;
        if (config.build.module.build && !distFiles.includes(moduleFile)) {
          tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
          reject(
            new Error(
              `Module file missing from dist folder (cannot find "./${
                config.dist.path
              }/${moduleFile}").`
            )
          );
          return;
        }
      }

      if (config.publish.checkFiles.script) {
        // Ensure the script file are present if the config says it should be.
        const scriptFile = `${config.componenet.name}${
          config.build.script.extension
        }`;
        if (config.build.script.build && !distFiles.includes(scriptFile)) {
          tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
          reject(
            new Error(
              `Script file missing from dist folder (cannot find "./${
                config.dist.path
              }/${scriptFile}").`
            )
          );
          return;
        }
      }

      if (config.publish.checkFiles.package) {
        // Ensure there is a package.json file.
        if (!distFiles.includes('package.json')) {
          tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
          reject(
            new Error(
              `Package file missing from dist folder (cannot find "./${
                config.dist.path
              }/package.json").`
            )
          );
          return;
        }
      }

      if (config.publish.checkFiles.license) {
        // Ensure there is a license file.
        if (!distFiles.includes('LICENSE')) {
          tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
          reject(
            new Error(
              `License file missing from dist folder (cannot find "./${
                config.dist.path
              }/LICENSE").`
            )
          );
          return;
        }
      }

      if (config.publish.checkFiles.readme) {
        // Ensure there is a readme file.
        if (!distFiles.includes('README.md')) {
          tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
          reject(
            new Error(
              `Readme file missing from dist folder (cannot find "./${
                config.dist.path
              }/README.md").`
            )
          );
          return;
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
 * Update the version.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} promptInput - Publishing info
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function updateVersion(gulp, config, promptInput, labelPrefix) {
  const subTaskLabel = 'update version';

  return new Promise((resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      const newVersion = `${promptInput.version}`;

      gulp
        .src([`./package.json`, `./${config.dist.path}/package.json`], {
          base: './'
        })
        .pipe(
          modifyFile(content => {
            const json = JSON.parse(content);
            json.version = newVersion;
            return `${JSON.stringify(json, null, 2)}\n`;
          })
        )
        .pipe(gulp.dest('./'))
        .on('finish', async () => {
          if ((await gitStatus({ args: '--porcelain' })) !== '') {
            await exec(`git add . && git commit -m "${newVersion}"`);
          }
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
          resolve();
        })
        .on('error', error => {
          tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
          reject(error);
        });
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Create a git tag.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} promptInput - Publishing info
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function createTag(gulp, config, promptInput, labelPrefix) {
  const subTaskLabel = 'create tag';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      const tag = `v${promptInput.version}`;

      await gitTag(tag, null, null);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve({
        gitTag: tag
      });
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Merge the changes into the major branch.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} info - Publishing info
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function mergeIntoMajorBranch(gulp, config, info, labelPrefix) {
  const subTaskLabel = 'merge into major branch';

  return new Promise(async (resolve, reject) => {
    if (!info.addToMajorBranch) {
      tasksUtil.tasks.log.info(`skipping ${subTaskLabel}`, labelPrefix);
      resolve();
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      await gitCheckout(info.majorBranch, { args: '-b' });
      await gitMerge(config.publish.masterBranch);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Publish to npm.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} info - Publishing info
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function publishToNpm(gulp, config, info, labelPrefix) {
  const subTaskLabel = 'publish to npm';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      await exec(
        `npm publish ${path.normalize(`./${config.dist.path}`)} --tag ${
          info.npmTag
        }`
      );

      const data = {
        versionCommit: (await exec('git log -1 --oneline')).replace(/\n$/, ''),
        lastCommit: (await exec(
          'git log -2 --oneline --reverse | head -1'
        )).replace(/\n$/, ''),
        publisher: (await exec('npm whoami --silent')).replace(/\n$/, '')
      };

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve(data);
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Clean up.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function cleanUp(gulp, config, labelPrefix) {
  const subTaskLabel = 'clean up';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      await gitCheckout(config.publish.masterBranch);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Print out info about the release.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} info - Publishing info
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function printNpmReleaseInfo(gulp, config, info, labelPrefix) {
  const subTaskLabel = 'release info';

  return new Promise((resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      const padding = ' '.repeat(2);

      const infoString = `\
${padding}${colors.yellow('Version')}:               ${info.version}
${padding}${colors.yellow('Version commit')}:        ${info.versionCommit}
${padding}${colors.yellow('Last commit')}:           ${info.lastCommit}
${padding}${colors.yellow('NPM tag')}:               ${info.npmTag}
${padding}${colors.yellow('Publisher')}:             ${info.publisher}`;

      // eslint-disable-next-line no-console
      console.info(infoString);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Push everything to git.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} info - Publishing info
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function pushToGit(gulp, config, info, labelPrefix) {
  const subTaskLabel = 'git push';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      const branches = [info.currentBranch];
      if (info.addToMajorBranch) {
        branches.push(info.majorBranch);
      }

      await gitPush('origin', branches);
      await gitPush('origin', null, { args: '--tags' });

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Create the archives for the GitHub release.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} info - Publishing info
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function createArchivesForGitHubRelease(gulp, config, info, labelPrefix) {
  const subTaskLabel = 'create archives';

  return new Promise(async (resolve, reject) => {
    if (config.componenet.name == null) {
      tasksUtil.tasks.log.info(`skipping ${subTaskLabel}`, labelPrefix);
      resolve();
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      const archiveFormats = {
        tar: {
          extension: '.tar.gz',
          options: {
            gzip: true,
            gzipOptions: {
              level: 1
            }
          }
        },
        zip: {
          extension: '.zip',
          options: {
            zlib: {
              level: 6
            }
          }
        }
      };

      const archivers = [];

      for (const [archiveFormat, formatConfig] of Object.entries(
        archiveFormats
      )) {
        archivers.push(
          new Promise(async (resolve, reject) => {
            const outputFile = `./${config.temp.path}/${
              config.componenet.name
            }-${info.version}${formatConfig.extension}`;
            info.releaseAssets.push(outputFile);

            // Delete the file if it already exists.
            await del(outputFile);

            const outputStream = fs.createWriteStream(outputFile);
            const archive = archiver(archiveFormat, formatConfig.options);

            archive.on('warning', error => {
              if (error.code === 'ENOENT') {
                console.warn(error);
              } else {
                reject(error);
              }
            });

            archive.on('error', error => {
              reject(error);
            });

            archive.on('finish', () => {
              resolve();
            });

            // Connect the archive and output stream.
            archive.pipe(outputStream);

            // Add the files.
            archive.directory(`./${config.dist.path}`, false);

            // Finalize the archive.
            archive.finalize();
          })
        );
      }

      await Promise.all(archivers);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Commit the GitHub release.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} info - Publishing info
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function commitGitHubRelease(gulp, config, info, labelPrefix) {
  const subTaskLabel = 'commit';

  return new Promise((resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      let rejected = false;

      gulp
        .src(info.releaseAssets, { allowEmpty: true })
        .pipe(release(info.releaseSettings))
        .on('end', () => {
          if (!rejected) {
            tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
            resolve();
          }
        })
        .on('error', error => {
          tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
          rejected = true;
          reject(error);
        });
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Create a GitHub release.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} info - Publishing info
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function createGitHubRelease(gulp, config, info, labelPrefix) {
  const subTaskLabel = 'GitHub release';

  return new Promise(async (resolve, reject) => {
    const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
      subTaskLabel,
      labelPrefix
    );

    try {
      await createArchivesForGitHubRelease(
        gulp,
        config,
        info,
        subTaskLabelPrefix
      );
      await commitGitHubRelease(gulp, config, info, subTaskLabelPrefix);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

// Export the publish function.
module.exports = (gulp, config) => {
  return new Promise(async (resolve, reject) => {
    let info = null;

    try {
      info = {
        version: null,
        prereleaseVersion: false,
        versionCommit: null,
        lastCommit: null,
        npmTag: null,
        gitTag: null,
        publisher: null,
        majorBranch: null,
        currentBranch: await gitRevParse({ args: '--abbrev-ref HEAD' }),
        releaseAssets: [],
        releaseSettings: null
      };

      const publishSettings = await promptUserForPublishSettings(config, info);
      info.version = publishSettings.version;
      info.prereleaseVersion = publishSettings.prereleaseVersion;
      info.npmTag = publishSettings.npmTag;
      info.majorBranch = `${publishSettings.version.split('.')[0]}.x`;
      info.addToMajorBranch =
        Number.parseInt(info.version.split('.')[0], 10) !== 0 &&
        !info.prereleaseVersion;

      try {
        await gitChecks(config, info);
      } catch (error) {
        if (!config.publish.force) {
          throw error;
        }
      }

      try {
        await checkFiles(gulp, config);
      } catch (error) {
        if (!config.publish.force) {
          throw error;
        }
      }

      await updateVersion(gulp, config, info);
      await mergeIntoMajorBranch(gulp, config, info);

      const tagResults = await createTag(gulp, config, info);
      info.gitTag = tagResults.gitTag;

      const publishResults = await publishToNpm(gulp, config, info);
      info.versionCommit = publishResults.versionCommit;
      info.lastCommit = publishResults.lastCommit;
      info.publisher = publishResults.publisher;

      resolve();
    } catch (error) {
      reject(error);
      return;
    } finally {
      try {
        await cleanUp(gulp, config);
      } catch (error) {}
    }

    try {
      await printNpmReleaseInfo(gulp, config, info);

      const gitReleaseSettings = await promptUserForGitReleaseSettings(
        config,
        info
      );
      info.releaseSettings = gitReleaseSettings.releaseSettings;

      if (gitReleaseSettings.push) {
        await pushToGit(gulp, config, info);

        if (gitReleaseSettings.createRelease) {
          await createGitHubRelease(gulp, config, info);
        }
      }
    } catch (error) {}
  });
};
