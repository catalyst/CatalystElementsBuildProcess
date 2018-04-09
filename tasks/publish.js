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
const fsReaddir = util.promisify(fs.readdir);
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
 * @returns {Promise}
 */
function promptUserForPublishSettings() {
  return new Promise(async (resolve, reject) => {
    try {
      prompt.start();

      // Get version.
      const promptSemVer = await promptGet({
        properties: {
          symver: {
            description: 'Release semantic version',
            type: 'string',
            pattern: /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/gi,
            message: 'Must be a semantic version e.g. x.y.z',
            required: true
          }
        }
      });

      // Prerelease version?
      const isPrerelease =
        promptSemVer.symver.search(
          /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/gi
        ) !== 0;

      // Get npm dist tag
      const promptNpm = await promptGet({
        properties: {
          tag: {
            description: 'npm-dist-tag',
            type: 'string',
            pattern: /^[a-z][a-z0-9-_]*$/gi,
            message: 'Invalid tag',
            default: isPrerelease ? 'beta' : 'latest',
            required: true
          }
        }
      });

      // Done.
      resolve({
        symver: promptSemVer.symver,
        isPrerelease: isPrerelease,
        npmTag: promptNpm.tag
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Prompt the user if they want to push the changes to git.
 *
 * @returns {Promise}
 */
function promptUserPushToGit() {
  return new Promise(async (resolve, reject) => {
    try {
      prompt.start();

      const promptPush = await promptGet({
        properties: {
          push: {
            description: 'Push changes to git?',
            type: 'boolean',
            default: true,
            required: true
          }
        }
      });

      resolve(promptPush.push);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Prompt the user for information about the GitHub release settings.
 *
 * @param {string} tag - The tag to release
 * @param {boolean} prerelease - Prerelease?
 * @param {Object} packageJson - The package.json info
 * @returns {Promise}
 */
function promptUserGitHubReleaseSettings(tag, prerelease, packageJson) {
  return new Promise(async (resolve, reject) => {
    try {
      prompt.start();

      const input = {
        create: false,
        settings: {
          tag: tag,
          prerelease: prerelease,
          manifest: packageJson
        }
      };

      const promptCreateRelease = await promptGet({
        properties: {
          createRelease: {
            description: 'Create a GitHub release',
            type: 'boolean',
            default: true,
            required: true
          }
        }
      });

      input.create = promptCreateRelease.createRelease;

      if (input.create) {
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
              default: tag,
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

        input.settings.token = releaseSettingsResult.token;
        input.settings.name = releaseSettingsResult.name;
        input.settings.notes = releaseSettingsResult.notes;
        input.settings.draft = releaseSettingsResult.draft;
      }

      resolve(input);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Prompt the user to confirm the publish.
 *
 * @returns {Promise}
 */
function promptUserConfirmPublish() {
  return new Promise(async (resolve, reject) => {
    try {
      prompt.start();

      const promptConfirmPublish = await promptGet({
        properties: {
          confirmPublish: {
            description: 'Are you sure you want to publish to npm?',
            type: 'boolean',
            default: true,
            required: true
          }
        }
      });

      resolve(promptConfirmPublish.confirmPublish);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Ensure the working director is clean.
 *
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function gitCheckWorkingDirector(config, labelPrefix) {
  const subTaskLabel = 'working director clean';

  return new Promise(async (resolve, reject) => {
    try {
      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      const status = await gitStatus({ args: '--porcelain' });
      if (status !== '') {
        throw new Error('Cannot publish - working directory is not clean.');
      }

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Ensure the branch is ok to publish from.
 *
 * @param {Object} config - Config settings
 * @param {string} branch - The branch to check if it's ok to publish from
 * @param {boolean} prerelease - Prerelease publish?
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function gitCheckGoodBranch(config, branch, prerelease, labelPrefix) {
  const subTaskLabel = 'branch';

  return new Promise((resolve, reject) => {
    try {
      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      const branchMuchMatch = prerelease
        ? config.publish.prereleaseBranchRegex
        : new RegExp(`^${escapeStringRegexp(config.publish.masterBranch)}$`);

      if (branch.search(branchMuchMatch) < 0) {
        throw new Error(
          prerelease
            ? `Cannot publish - not on valid prerelease branch. Branch name much match this regex: ${config.publish.prereleaseBranchRegex.toString()}`
            : `Cannot publish - not on "${config.publish.masterBranch}" branch.`
        );
      }

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Ensure there are no unpulled/unpushed changes.
 *
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function gitCheckSynced(config, labelPrefix) {
  const subTaskLabel = 'branch';

  return new Promise(async (resolve, reject) => {
    try {
      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      await exec('git fetch --quiet');

      if (
        (await gitRevParse({ args: 'HEAD' })) !==
        (await gitRevParse({ args: '@{u}' }))
      ) {
        throw new Error(
          'Cannot publish - remote history differ. Please push/pull changes.'
        );
      }

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Make sure git is ok.
 *
 * @param {Object} config - Config settings
 * @param {string} branch - The branch to check if it's ok to publish from
 * @param {boolean} prerelease - Prerelease publish?
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function gitChecks(config, branch, prerelease, labelPrefix) {
  const subTaskLabel = 'git checks';

  return new Promise(async (resolve, reject) => {
    try {
      if (!config.publish.runGitChecks) {
        resolve();
        tasksUtil.tasks.log.info(`skipping ${subTaskLabel}`, labelPrefix);
        return;
      }

      const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await tasksUtil.waitForAllPromises([
        gitCheckWorkingDirector(config, subTaskLabelPrefix),
        gitCheckGoodBranch(config, branch, prerelease, subTaskLabelPrefix),
        gitCheckSynced(config, subTaskLabelPrefix)
      ]);

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Ensure the module file is present.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string[]} distFiles - An array of all the files that will be published
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fileCheckModule(gulp, config, distFiles, labelPrefix) {
  const subTaskLabel = 'module';

  return new Promise((resolve, reject) => {
    try {
      if (!config.publish.checkFiles.module) {
        resolve();
        tasksUtil.tasks.log.info(`skipping ${subTaskLabel}`, labelPrefix);
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      const filename = `${config.componenet.name}${
        config.build.module.extension
      }`;
      if (config.build.module.build && !distFiles.includes(filename)) {
        throw new Error(
          `Module file missing ` +
            `(cannot find "./${config.dist.path}/${filename}").`
        );
      }

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Ensure the script file is present.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string[]} distFiles - An array of all the files that will be published
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fileCheckScript(gulp, config, distFiles, labelPrefix) {
  const subTaskLabel = 'script';

  return new Promise((resolve, reject) => {
    try {
      if (!config.publish.checkFiles.script) {
        resolve();
        tasksUtil.tasks.log.info(`skipping ${subTaskLabel}`, labelPrefix);
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      const filename = `${config.componenet.name}${
        config.build.script.extension
      }`;
      if (config.build.script.build && !distFiles.includes(filename)) {
        throw new Error(
          `Script file missing ` +
            `(cannot find "./${config.dist.path}/${filename}").`
        );
      }

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Ensure there is a package.json file.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string[]} distFiles - An array of all the files that will be published
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fileCheckPackage(gulp, config, distFiles, labelPrefix) {
  const subTaskLabel = 'package';

  return new Promise((resolve, reject) => {
    try {
      if (!config.publish.checkFiles.package) {
        resolve();
        tasksUtil.tasks.log.info(`skipping ${subTaskLabel}`, labelPrefix);
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      const filename = 'package.json';
      if (!distFiles.includes(filename)) {
        throw new Error(
          `Package file missing ` +
            `(cannot find "./${config.dist.path}/${filename}").`
        );
      }

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Ensure there is a license file.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string[]} distFiles - An array of all the files that will be published
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fileCheckLicense(gulp, config, distFiles, labelPrefix) {
  const subTaskLabel = 'license';

  return new Promise((resolve, reject) => {
    try {
      if (!config.publish.checkFiles.license) {
        resolve();
        tasksUtil.tasks.log.info(`skipping ${subTaskLabel}`, labelPrefix);
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      const filename = 'LICENSE';
      if (!distFiles.includes(filename)) {
        throw new Error(
          `License file missing ` +
            `(cannot find "./${config.dist.path}/${filename}").`
        );
      }

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Ensure there is a readme file.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string[]} distFiles - An array of all the files that will be published
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fileCheckReadme(gulp, config, distFiles, labelPrefix) {
  const subTaskLabel = 'readme';

  return new Promise((resolve, reject) => {
    try {
      if (!config.publish.checkFiles.readme) {
        resolve();
        tasksUtil.tasks.log.info(`skipping ${subTaskLabel}`, labelPrefix);
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      const filename = 'README.md';
      if (!distFiles.includes(filename)) {
        throw new Error(
          `Readme file missing ` +
            `(cannot find "./${config.dist.path}/${filename}").`
        );
      }

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
function fileChecks(gulp, config, labelPrefix) {
  const subTaskLabel = 'file checks';

  return new Promise(async (resolve, reject) => {
    try {
      if (!config.publish.runFileChecks) {
        resolve();
        tasksUtil.tasks.log.info(`skipping ${subTaskLabel}`, labelPrefix);
        return;
      }

      const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
        subTaskLabel,
        labelPrefix
      );

      // Read the files that will be published.
      const distFiles = await fsReaddir(config.dist.path, 'utf8');

      // Make sure there are files.
      if (distFiles.length === 0) {
        throw new Error('There are no files to publish.');
      }

      // Check files.
      await tasksUtil.waitForAllPromises([
        fileCheckModule(gulp, config, distFiles, subTaskLabelPrefix),
        fileCheckScript(gulp, config, distFiles, subTaskLabelPrefix),
        fileCheckPackage(gulp, config, distFiles, subTaskLabelPrefix),
        fileCheckLicense(gulp, config, distFiles, subTaskLabelPrefix),
        fileCheckReadme(gulp, config, distFiles, subTaskLabelPrefix)
      ]);

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Update the version.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} newVersion - The version to update to
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function updateVersion(gulp, config, newVersion, labelPrefix) {
  const subTaskLabel = 'update version';

  return new Promise((resolve, reject) => {
    try {
      // Are we doing a dryrun?
      if (config.publish.dryrun) {
        resolve();
        tasksUtil.tasks.log.info(
          `skipping ${subTaskLabel}${colors.magenta(' - dry run')}`,
          labelPrefix
        );
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

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
          // If there were changes.
          if ((await gitStatus({ args: '--porcelain' })) !== '') {
            // Commit them.
            await exec(`git add . && git commit -m "${newVersion}"`);
          }

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
 * Create a git tag.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} tag - The tag to create
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function createTag(gulp, config, tag, labelPrefix) {
  const subTaskLabel = 'create tag';

  return new Promise(async (resolve, reject) => {
    try {
      // Are we doing a dryrun?
      if (config.publish.dryrun) {
        resolve();
        tasksUtil.tasks.log.info(
          `skipping ${subTaskLabel}${colors.magenta(' - dry run')}`,
          labelPrefix
        );
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      await gitTag(tag, null, null);

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Merge the changes into the major branch for this release.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} majorBranch - The branch to merge into
 * @param {string} fromBranch - Thr branch to merge from
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function mergeIntoMajorBranch(
  gulp,
  config,
  majorBranch,
  fromBranch,
  labelPrefix
) {
  const subTaskLabel = 'merge into major branch';

  return new Promise(async (resolve, reject) => {
    try {
      if (majorBranch === null) {
        resolve();
        tasksUtil.tasks.log.info(`skipping ${subTaskLabel}`, labelPrefix);
        return;
      }

      // Are we doing a dryrun?
      if (config.publish.dryrun) {
        resolve();
        tasksUtil.tasks.log.info(
          `skipping ${subTaskLabel}${colors.magenta(' - dry run')}`,
          labelPrefix
        );
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      await gitCheckout(majorBranch, { args: '-b' });
      await gitMerge(fromBranch);

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Publish to npm.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} npmTag - The npm release tag
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function publishToNpm(gulp, config, npmTag, labelPrefix) {
  const subTaskLabel = 'publish to npm';

  return new Promise(async (resolve, reject) => {
    try {
      // Are we doing a dryrun?
      if (config.publish.dryrun) {
        resolve({
          versionCommit: '?????',
          lastCommit: (await exec('git log -1 --oneline')).replace(/\n$/, ''),
          publisher: (await exec('npm whoami --silent')).replace(/\n$/, '')
        });
        tasksUtil.tasks.log.info(
          `skipping ${subTaskLabel}${colors.magenta(' - dry run')}`,
          labelPrefix
        );
        return;
      }

      const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
        subTaskLabel,
        labelPrefix
      );

      const confirm = await promptUserConfirmPublish(subTaskLabelPrefix);

      if (confirm) {
        await exec(
          `npm publish ${path.normalize(
            `./${config.dist.path}`
          )} --tag ${npmTag}`
        );
      } else {
        throw new Error('User aborted.');
      }

      resolve({
        versionCommit: (await exec('git log -1 --oneline')).replace(/\n$/, ''),
        lastCommit: (await exec(
          'git log -2 --oneline --reverse | head -1'
        )).replace(/\n$/, ''),
        publisher: (await exec('npm whoami --silent')).replace(/\n$/, '')
      });
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Checkout the branch the user was originally on.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} branch - The branch the git repo should be on.
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function restoreBranch(gulp, config, branch, labelPrefix) {
  const subTaskLabel = 'restore branch';

  return new Promise(async (resolve, reject) => {
    try {
      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      // No need to check the branch out if it is already checked out.
      if ((await gitRevParse({ args: '--abbrev-ref HEAD' })) !== branch) {
        await gitCheckout(branch);
      }

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Clean up.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} branch - The branch the git repo should be on.
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function cleanUp(gulp, config, branch, labelPrefix) {
  const subTaskLabel = 'clean up';

  return new Promise(async (resolve, reject) => {
    try {
      const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
        subTaskLabel,
        labelPrefix
      );

      await restoreBranch(gulp, config, branch, subTaskLabelPrefix);

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Print out info about the release.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} releaseInfo - Information about the release
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function printNpmReleaseInfo(gulp, config, releaseInfo, labelPrefix) {
  const subTaskLabel = 'release info';

  return new Promise((resolve, reject) => {
    try {
      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      // Are we doing a dryrun?
      if (config.publish.dryrun) {
        // eslint-disable-next-line no-console
        console.info(`  ${colors.magenta('=== Dry Run ===')}`);
      }

      // eslint-disable-next-line no-console
      console.info(`\
  ${colors.yellow('Version')}:               ${releaseInfo.version}
  ${colors.yellow('Version commit')}:        ${releaseInfo.versionCommit}
  ${colors.yellow('Last commit')}:           ${releaseInfo.lastCommit}
  ${colors.yellow('NPM tag')}:               ${releaseInfo.npmTag}
  ${colors.yellow('Publisher')}:             ${releaseInfo.publisher}`);

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Push everything to git.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} currentBranch - The branch the user is on
 * @param {string} majorBranch - The release's major branch
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function pushToGit(gulp, config, currentBranch, majorBranch, labelPrefix) {
  const subTaskLabel = 'git push';

  return new Promise(async (resolve, reject) => {
    try {
      // Are we doing a dryrun?
      if (config.publish.dryrun) {
        resolve();
        tasksUtil.tasks.log.info(
          `skipping ${subTaskLabel}${colors.magenta(' - dry run')}`,
          labelPrefix
        );
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      const branches = [currentBranch];
      if (majorBranch != null) {
        branches.push(majorBranch);
      }

      await gitPush('origin', branches);
      await gitPush('origin', null, { args: '--tags' });

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Create the archives for the GitHub release.
 *
 * @param {Object} directory - The directory that contains the files to add.
 * @param {string} outputFile - The output file
 * @param {string} format - The format of the archive
 * @param {string} formatConfig - The format settings
 * @returns {Promise}
 */
function createArchive(directory, outputFile, format, formatConfig) {
  return new Promise(async (resolve, reject) => {
    try {
      // Delete the file if it already exists.
      await del(outputFile);

      const outputStream = fs.createWriteStream(outputFile);
      const archive = archiver(format, formatConfig.options);

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
      archive.directory(directory, false);

      // Finalize the archive.
      archive.finalize();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Create the archives for the GitHub release.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} version - The version of the release
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise<string[]>}
 */
function createArchivesForGitHubRelease(gulp, config, version, labelPrefix) {
  const subTaskLabel = 'create archives';

  return new Promise(async (resolve, reject) => {
    try {
      if (config.componenet.name == null) {
        resolve();
        tasksUtil.tasks.log.info(`skipping ${subTaskLabel}`, labelPrefix);
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      const archiveFormats = config.publish.archiveFormats;

      const assets = [];
      const archivers = [];

      for (const [format, formatConfig] of Object.entries(archiveFormats)) {
        if (!formatConfig.ignore) {
          const outputFile = `./${config.temp.path}/${
            config.componenet.name
          }-${version}${formatConfig.extension}`;

          archivers.push(
            createArchive(
              `./${config.dist.path}`,
              outputFile,
              format,
              formatConfig
            )
          );

          assets.push(outputFile);
        }
      }

      await Promise.all(archivers);

      resolve(assets);
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Commit the GitHub release.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} settings - Settings for the release
 * @param {string[]} assets - Extra assets to upload
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function commitGitHubRelease(gulp, config, settings, assets, labelPrefix) {
  const subTaskLabel = 'commit';

  return new Promise((resolve, reject) => {
    try {
      // Are we doing a dryrun?
      if (config.publish.dryrun) {
        resolve();
        tasksUtil.tasks.log.info(
          `skipping ${subTaskLabel}${colors.magenta(' - dry run')}`,
          labelPrefix
        );
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      let rejected = false;

      gulp
        .src(assets, { allowEmpty: true })
        .pipe(release(settings))
        .on('end', () => {
          if (!rejected) {
            resolve();
            tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
          }
        })
        .on('error', error => {
          rejected = true;
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Create a GitHub release.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {Object} settings - Settings for the release
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function createGitHubRelease(gulp, config, settings, labelPrefix) {
  const subTaskLabel = 'GitHub release';

  return new Promise(async (resolve, reject) => {
    try {
      const subTaskLabelPrefix = tasksUtil.tasks.log.starting(
        subTaskLabel,
        labelPrefix
      );

      const archives = await createArchivesForGitHubRelease(
        gulp,
        config,
        settings,
        subTaskLabelPrefix
      );
      await commitGitHubRelease(
        gulp,
        config,
        settings,
        archives,
        subTaskLabelPrefix
      );

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

// Export the publish function.
module.exports = (gulp, config) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Information about the environment and setting the user want for publishing.
      const info = {
        version: {
          semantic: null,
          prerelease: false
        },
        releaseInfo: {
          lastCommit: null,
          publisher: null,
          npmTag: null,
          versionCommit: null
        },
        git: {
          currentBranch: await gitRevParse({ args: '--abbrev-ref HEAD' }),
          majorBranch: null,
          tag: null
        }
      };

      // Input from the user.
      const input = {};

      try {
        // Get publishing settings from the user.
        input.publishing = await promptUserForPublishSettings();
        info.version.semantic = input.publishing.symver;
        info.version.prerelease = input.publishing.prereleaseVersion;
        info.releaseInfo.npmTag = input.publishing.npmTag;

        info.git.tag = `v${info.version.semantic}`;
        info.git.majorBranch =
          Number.parseInt(info.version.semantic.split('.')[0], 10) !== 0 &&
          !info.version.prerelease
            ? `${info.version.semantic.split('.')[0]}.x`
            : null;

        // Check that git is ok based on the settings given.
        try {
          await gitChecks(
            config,
            info.git.currentBranch,
            info.version.prerelease
          );
        } catch (error) {
          // Ignore the error if force is true.
          if (!config.publish.force) {
            throw error;
          }
        }

        // Check that the files are ok based on the settings given.
        try {
          await fileChecks(gulp, config);
        } catch (error) {
          // Ignore the error if force is true.
          if (!config.publish.force) {
            throw error;
          }
        }

        // Update the version.
        await updateVersion(gulp, config, info.version.semantic);

        // Merge changes into the release's major branch.
        await mergeIntoMajorBranch(
          gulp,
          config,
          info.git.majorBranch,
          info.git.currentBranch
        );

        // Create a git tag for the release.
        await createTag(gulp, config, info.git.tag);

        // Publish the release to npm.
        const publishResults = await publishToNpm(
          gulp,
          config,
          info.releaseInfo.npmTag
        );
        info.releaseInfo.versionCommit = publishResults.versionCommit;
        info.releaseInfo.lastCommit = publishResults.lastCommit;
        info.releaseInfo.publisher = publishResults.publisher;
      } catch (error) {
        reject(error);
        return;
      } finally {
        // Clean up.
        await cleanUp(gulp, config, info.git.currentBranch);
      }

      // Print out information about the npm release. Ignore any errors.
      try {
        await printNpmReleaseInfo(gulp, config, {
          version: info.version.semantic,
          ...info.releaseInfo
        });
      } catch (error) {}

      // Ask the user if they want to push the changes to git.
      input.pushToGit = await promptUserPushToGit();

      // User want to push changes.
      if (input.pushToGit) {
        // Push changes to GitHub.
        await pushToGit(gulp, config);

        // Only prompt about a GitHub release if the hosted on GitHub.
        if (config.publish.hostedOnGitHub) {
          // Ask the user if they want to do a GitHub release.
          input.gitHubRelease = await promptUserGitHubReleaseSettings(
            info.git.tag,
            info.version.prerelease,
            config.package
          );

          // User wants to create a release.
          if (input.gitHubRelease.create) {
            await createGitHubRelease(
              gulp,
              config,
              input.gitHubRelease.settings
            );
          }
        }
      }

      resolve();
    } catch (error) {
      // Resolve regardless of any errors caught here.
      resolve();
    }
  });
};
