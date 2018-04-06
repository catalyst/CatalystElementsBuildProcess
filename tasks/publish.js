// Load util.
const tasksUtil = require('./util');

// Libraries.
const escapeStringRegexp = require('escape-string-regexp');
const fs = require('fs');
const git = require('gulp-git');
const modifyFile = require('gulp-modify-file');
const prompt = require('prompt');
const run = require('gulp-run-command');
const util = require('util');

// Promisified functions.
const gitCheckout = util.promisify(git.checkout);
const gitFetch = util.promisify(git.fetch);
const gitMerge = util.promisify(git.merge);
const gitRevParse = util.promisify(git.revParse);
const gitStatus = util.promisify(git.status);
const gitTag = util.promisify(git.tag);
const promptGet = util.promisify(prompt.get);

/**
 * Prompt the user for information about how to publish.
 *
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function promptUser(config, labelPrefix) {
  const subTaskLabel = 'get publish settings';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      prompt.start();

      const result = await promptGet({
        properties: {
          version: {
            pattern: /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/gi,
            message: 'Must be a semantic version e.g. 1.2.3',
            required: true
          }
        }
      });

      const input = {
        version: result.version,
        prereleaseVersion:
          result.version.search(
            /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/gi
          ) !== 0
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

      // Ensure we are on the master branch.
      const currentBranch = await gitRevParse({ args: '--abbrev-ref HEAD' });
      const branchMuchMatch = info.prereleaseVersion
        ? config.publish.prereleaseBranchRegex
        : new RegExp(`^${escapeStringRegexp(config.publish.masterBranch)}$`);

      if (currentBranch.search(branchMuchMatch) < 0) {
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
      await gitFetch('origin', currentBranch, { args: '--quiet' });
      const remoteStatus = await gitRevParse({
        args: "--count --left-only @'{u}'...HEAD"
      });
      if (Number.parseInt(remoteStatus, 10) !== 0) {
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
        .pipe(git.add())
        .pipe(git.commit(newVersion))
        .on('finish', () => {
          tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
          resolve();
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
      const newVersion = `${promptInput.version}`;

      await gitTag(`v${newVersion}`, null, null);

      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
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
    const majorVersion = info.version.split('.')[0];
    if (Number.parseInt(majorVersion, 10) === 0) {
      tasksUtil.tasks.log.info(
        `skipping ${subTaskLabel} - major version is zero.`,
        labelPrefix
      );
      resolve();
      return;
    }

    if (info.prereleaseVersion) {
      tasksUtil.tasks.log.info(
        `skipping ${subTaskLabel} - releasing prerelease version.`,
        labelPrefix
      );
      resolve();
      return;
    }

    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      await gitCheckout(`${majorVersion}.x`, { args: '-b' });
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
      await run(`npm publish --tag ${info.npmTag}`);

      const lastTag = await run('git tag | tail -r | head -1');
      const prevTag = await run('git tag | tail -r -2 | tail -1');

      const data = {
        versionCommit: await run('git log -1 --oneline'),
        lastCommit: await run('git log -2 --oneline --reverse | head -1'),
        numberOfCommits: await run(
          `git rev-list ${prevTag}..${lastTag} --count`
        ),
        publisher: await run('npm whoami --silent')
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
function printReleaseInfo(gulp, config, info, labelPrefix) {
  const subTaskLabel = 'release info';

  return new Promise((resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      let infoString = '';

      infoString += ` Version:            ${info.version}\n`;
      infoString += ` Version commit:     ${info.versionCommit}\n`;
      infoString += ` Last commit:        ${info.lastCommit}\n`;
      infoString += ` Commits in version: ${info.numberOfCommits}\n`;
      infoString += ` NPM tag:            ${info.npmTag}\n`;
      infoString += ` Publisher:          ${info.publisher}\n`;

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

// Export the publish function.
module.exports = (gulp, config) => {
  return new Promise(async (resolve, reject) => {
    try {
      const info = {
        version: null,
        versionCommit: null,
        lastCommit: null,
        numberOfCommits: null,
        npmTag: 'latest',
        publisher: null
      };

      const promptInput = await promptUser(config);
      info.version = promptInput.version;
      info.prereleaseVersion = prompt.prereleaseVersion;

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
      await createTag(gulp, config, info);

      const publishResults = await publishToNpm(gulp, config, info);
      info.versionCommit = publishResults.versionCommit;
      info.lastCommit = publishResults.lastCommit;
      info.numberOfCommits = publishResults.numberOfCommits;
      info.publisher = publishResults.publisher;

      try {
        await cleanUp(gulp, config);
      } catch (error) {}

      try {
        await printReleaseInfo(gulp, config, info);
      } catch (error) {}

      resolve();
    } catch (error) {
      reject(error);
    }
  });
};
