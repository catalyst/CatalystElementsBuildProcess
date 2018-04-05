// Load util.
const tasksUtil = require('./util');

// Libraries.
const escapeStringRegexp = require('escape-string-regexp');
const fs = require('fs');
const git = require('gulp-git');
const modifyFile = require('gulp-modify-file');
const prompt = require('prompt');
const util = require('util');

// Promisified functions.
const gitCheckout = util.promisify(git.checkout);
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
 * @param {Object} promptInput - The inputs from the user
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function checkGit(config, promptInput, labelPrefix) {
  const subTaskLabel = 'is git ok';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      // Ensure the working director is clean.
      const status = await gitStatus({ args: '--porcelain' });
      if (status !== '') {
        tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
        reject(new Error('Working directory is not clean.'));
        return;
      }

      // Ensure we are on the master branch.
      const currentBranch = await gitRevParse({ args: '--abbrev-ref HEAD' });
      const branchMuchMatch = promptInput.prereleaseVersion
        ? config.publish.prereleaseBranchRegex
        : new RegExp(`^${escapeStringRegexp(config.publish.masterBranch)}$`);

      if (currentBranch.search(branchMuchMatch) < 0) {
        tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
        reject(
          new Error(
            promptInput.prereleaseVersion
              ? `Cannot publish prerelease - not on valid prerelease branch. Branch name much match this regex: ${config.publish.prereleaseBranchRegex.toString()}`
              : `Cannot publish - you must be on "${
                  config.publish.masterBranch
                }" branch to publish.`
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
 * @param {Object} promptInput - The inputs from the user
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function updateVersion(gulp, config, promptInput, labelPrefix) {
  const subTaskLabel = 'bump version';

  return new Promise((resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      const newVersion = `${promptInput.version}`;

      gulp
        .src(`./package.json`, `./${config.dist.path}/package.json`, {
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
 * @param {Object} promptInput - The inputs from the user
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
 * @param {Object} promptInput - The inputs from the user
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function mergeIntoMajorBranch(gulp, config, promptInput, labelPrefix) {
  const subTaskLabel = 'merge into major branch';

  return new Promise(async (resolve, reject) => {
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    try {
      const newVersion = `${promptInput.version}`;
      const majorVersion = newVersion.split('.')[0];

      if (majorVersion > 0) {
        await gitCheckout(`${majorVersion}.x`, { args: '-b' });
        await gitMerge(config.publish.masterBranch);
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

// Export the publish functions.
module.exports = {
  prepublish: (gulp, config) => {
    return new Promise(async (resolve, reject) => {
      try {
        const promptInput = await promptUser(config);
        await checkGit(config, promptInput);
        await checkFiles(gulp, config);
        await updateVersion(gulp, config, promptInput);
        await mergeIntoMajorBranch(gulp, config, promptInput);
        await createTag(gulp, config, promptInput);
        await cleanUp(gulp, config);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
};
