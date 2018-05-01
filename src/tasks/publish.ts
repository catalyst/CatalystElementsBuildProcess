// Libraries.
import { magenta, yellow } from 'ansi-colors';
import archiver, { ArchiverOptions, Format as ArchiverFormat } from 'archiver';
import del from 'del';
import escapeStringRegexp from 'escape-string-regexp';
import exec from 'exec-chainable';
import { createWriteStream } from 'fs';
import { readdir } from 'fs/promises';
import GulpClient from 'gulp';
import {
  checkout as _checkout,
  merge as _merge,
  push as _push,
  revParse as _revParse,
  status as _status,
  tag as _tag
} from 'gulp-git';
import release from 'gulp-github-release';
import modifyFile from 'gulp-modify-file';
import { normalize } from 'path';
import prompt from 'prompt';
import { promisify } from 'util';

import { IConfig } from '../config';
import { tasksHelpers, waitForAllPromises } from '../util';

// Promisified functions.
const gitCheckout = promisify(_checkout);
const gitMerge = promisify(_merge);
const gitRevParse = promisify(_revParse);
const gitPush = promisify(_push);
const gitStatus = promisify(_status);
const gitTag = promisify(_tag);
const promptGet = promisify(prompt.get);

const dryRunLabel = magenta(' - dry run');

type TPublishSettings = {
  isPrerelease: boolean;
  npmTag: string;
  symver: string;
};

/**
 * Prompt the user for information about how to publish.
 */
function promptUserPublishSettings(): Promise<TPublishSettings> {
  return new Promise(
    async (
      resolve: (value: TPublishSettings) => void,
      reject: (reason: Error) => void
    ) => {
      try {
        prompt.start();

        // Get version.
        const promptSemVer = await promptGet({
          properties: {
            symver: {
              description: 'Release semantic version',
              message: 'Must be a semantic version e.g. x.y.z',
              pattern: /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/gi,
              required: true,
              type: 'string'
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
              default: isPrerelease ? 'beta' : 'latest',
              description: 'npm-dist-tag',
              message: 'Invalid tag',
              pattern: /^[a-z][a-z0-9-_]*$/gi,
              required: true,
              type: 'string'
            }
          }
        });

        // Done.
        resolve({
          isPrerelease,
          npmTag: promptNpm.tag,
          symver: promptSemVer.symver
        });
      } catch (error) {
        reject(error);
      }
    }
  );
}

/**
 * Prompt the user if they want to push the changes to git.
 */
function promptUserPushToGit(): Promise<boolean> {
  return new Promise(
    async (
      resolve: (value: boolean) => void,
      reject: (reason: Error) => void
    ) => {
      try {
        prompt.start();

        const promptPush = await promptGet({
          properties: {
            push: {
              default: true,
              description: 'Push changes to git?',
              required: true,
              type: 'boolean'
            }
          }
        });

        resolve(promptPush.push);
      } catch (error) {
        reject(error);
      }
    }
  );
}

type TGitHubReleaseSettings = {
  create: boolean;
  settings: {
    manifest: { [key: string]: any };
    prerelease: boolean;
    tag: string;
    token: string;
    name: string;
    notes: string;
    draft: boolean;
  };
};

/**
 * Prompt the user for information about the GitHub release settings.
 *
 * @param tag - The tag to release
 * @param prerelease - Prerelease?
 * @param packageJson - The package.json info
 */
function promptUserGitHubReleaseSettings(
  tag: string,
  prerelease: boolean,
  packageJson: { [key: string]: any }
): Promise<TGitHubReleaseSettings> {
  return new Promise(
    async (
      resolve: (value: TGitHubReleaseSettings) => void,
      reject: (reason: Error) => void
    ) => {
      try {
        prompt.start();

        const input: any = {
          create: false,
          settings: {
            manifest: packageJson,
            prerelease,
            tag
          }
        };

        const promptCreateRelease = await promptGet({
          properties: {
            createRelease: {
              default: true,
              description: 'Create a GitHub release',
              required: true,
              type: 'boolean'
            }
          }
        });

        input.create = promptCreateRelease.createRelease;

        if (input.create) {
          const releaseSettingsResult = await promptGet({
            properties: {
              token: {
                default: process.env.GITHUB_TOKEN,
                description: 'GitHub access token',
                required: true,
                type: 'string'
              },
              name: {
                default: tag,
                description: 'Release name',
                required: true,
                type: 'string'
              },
              notes: {
                description: 'Release notes',
                type: 'string'
              },
              draft: {
                default: false,
                description: 'Draft release',
                required: true,
                type: 'boolean'
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
    }
  );
}

/**
 * Prompt the user to confirm the publish.
 */
function promptUserConfirmPublish(): Promise<boolean> {
  return new Promise(
    async (resolve: (value: boolean) => void, reject: (reason: Error) => void) => {
      try {
        prompt.start();

        const promptConfirmPublish = await promptGet({
          properties: {
            confirmPublish: {
              default: true,
              description: 'Are you sure you want to publish to npm?',
              required: true,
              type: 'boolean'
            }
          }
        });

        resolve(promptConfirmPublish.confirmPublish);
      } catch (error) {
        reject(error);
      }
    }
  );
}

/**
 * Ensure the working director is clean.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function gitCheckWorkingDirector(labelPrefix?: string): Promise<void> {
  const subTaskLabel = 'working director clean';

  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        tasksHelpers.log.starting(subTaskLabel, labelPrefix);

        const status = await gitStatus({ args: '--porcelain' });
        if (status !== '') {
          throw new Error('Cannot publish - working directory is not clean.');
        }

        resolve();
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

/**
 * Ensure the branch is ok to publish from.
 *
 * @param config - Config settings
 * @param branch - The branch to check if it's ok to publish from
 * @param prerelease - Prerelease publish?
 * @param labelPrefix - A prefix to print before the label
 */
function gitCheckGoodBranch(
  config: IConfig,
  branch: string,
  prerelease: boolean,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'branch';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

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
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Ensure there are no unpulled/unpushed changes.
 *
 * @param labelPrefix - A prefix to print before the label
 */
function gitCheckSynced(labelPrefix?: string): Promise<void> {
  const subTaskLabel = 'in sync with upstream';

  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        tasksHelpers.log.starting(subTaskLabel, labelPrefix);

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
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

/**
 * Make sure git is ok.
 *
 * @param config - Config settings
 * @param branch - The branch to check if it's ok to publish from
 * @param prerelease - Prerelease publish?
 * @param labelPrefix - A prefix to print before the label
 */
function gitChecks(
  config: IConfig,
  branch: string,
  prerelease: boolean,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'git checks';

  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        if (!config.publish.runGitChecks) {
          resolve();
          tasksHelpers.log.info(`skipping ${subTaskLabel}`, labelPrefix);

          return;
        }

        const subTaskLabelPrefix = tasksHelpers.log.starting(
          subTaskLabel,
          labelPrefix
        );

        await waitForAllPromises([
          gitCheckWorkingDirector(subTaskLabelPrefix),
          gitCheckGoodBranch(config, branch, prerelease, subTaskLabelPrefix),
          gitCheckSynced(subTaskLabelPrefix)
        ]);

        resolve();
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

/**
 * Ensure the module file is present.
 *
 * @param config - Config settings
 * @param distFiles - An array of all the files that will be published
 * @param labelPrefix - A prefix to print before the label
 */
function fileCheckModule(
  config: IConfig,
  distFiles: string[],
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'module';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      if (config.componenet.name == null || !config.publish.checkFiles.module) {
        resolve();
        tasksHelpers.log.info(`skipping ${subTaskLabel}`, labelPrefix);

        return;
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

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
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Ensure the script file is present.
 *
 * @param config - Config settings
 * @param distFiles - An array of all the files that will be published
 * @param labelPrefix - A prefix to print before the label
 */
function fileCheckScript(
  config: IConfig,
  distFiles: string[],
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'script';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      if (config.componenet.name == null || !config.publish.checkFiles.script) {
        resolve();
        tasksHelpers.log.info(`skipping ${subTaskLabel}`, labelPrefix);

        return;
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

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
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Ensure there is a package.json file.
 *
 * @param config - Config settings
 * @param distFiles - An array of all the files that will be published
 * @param labelPrefix - A prefix to print before the label
 */
function fileCheckPackage(
  config: IConfig,
  distFiles: string[],
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'package';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      if (!config.publish.checkFiles.package) {
        resolve();
        tasksHelpers.log.info(`skipping ${subTaskLabel}`, labelPrefix);

        return;
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      const filename = 'package.json';
      if (!distFiles.includes(filename)) {
        throw new Error(
          `Package file missing ` +
            `(cannot find "./${config.dist.path}/${filename}").`
        );
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
 * Ensure there is a license file.
 *
 * @param config - Config settings
 * @param distFiles - An array of all the files that will be published
 * @param labelPrefix - A prefix to print before the label
 */
function fileCheckLicense(
  config: IConfig,
  distFiles: string[],
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'license';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      if (!config.publish.checkFiles.license) {
        resolve();
        tasksHelpers.log.info(`skipping ${subTaskLabel}`, labelPrefix);

        return;
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      const filename = 'LICENSE';
      if (!distFiles.includes(filename)) {
        throw new Error(
          `License file missing ` +
            `(cannot find "./${config.dist.path}/${filename}").`
        );
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
 * Ensure there is a readme file.
 *
 * @param config - Config settings
 * @param distFiles - An array of all the files that will be published
 * @param labelPrefix - A prefix to print before the label
 */
function fileCheckReadme(
  config: IConfig,
  distFiles: string[],
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'readme';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      if (!config.publish.checkFiles.readme) {
        resolve();
        tasksHelpers.log.info(`skipping ${subTaskLabel}`, labelPrefix);

        return;
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      const filename = 'README.md';
      if (!distFiles.includes(filename)) {
        throw new Error(
          `Readme file missing ` +
            `(cannot find "./${config.dist.path}/${filename}").`
        );
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
 * Make sure all the files are ok.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function fileChecks(config: IConfig, labelPrefix?: string): Promise<void> {
  const subTaskLabel = 'file checks';

  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        if (!config.publish.runFileChecks) {
          resolve();
          tasksHelpers.log.info(`skipping ${subTaskLabel}`, labelPrefix);

          return;
        }

        const subTaskLabelPrefix = tasksHelpers.log.starting(
          subTaskLabel,
          labelPrefix
        );

        // Read the files that will be published.
        const distFiles = await readdir(config.dist.path, 'utf8');

        // Make sure there are files.
        if (distFiles.length === 0) {
          throw new Error('There are no files to publish.');
        }

        // Check files.
        await waitForAllPromises([
          fileCheckModule(config, distFiles, subTaskLabelPrefix),
          fileCheckScript(config, distFiles, subTaskLabelPrefix),
          fileCheckPackage(config, distFiles, subTaskLabelPrefix),
          fileCheckLicense(config, distFiles, subTaskLabelPrefix),
          fileCheckReadme(config, distFiles, subTaskLabelPrefix)
        ]);

        resolve();
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

/**
 * Update the version.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param newVersion - The version to update to
 * @param labelPrefix - A prefix to print before the label
 */
function updateVersion(
  gulp: GulpClient.Gulp,
  config: IConfig,
  newVersion: string,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'update version';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      // Are we doing a dryrun?
      if (config.publish.dryrun) {
        resolve();
        tasksHelpers.log.info(
          `skipping ${subTaskLabel}${dryRunLabel}`,
          labelPrefix
        );

        return;
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      gulp
        .src([`./package.json`, `./${config.dist.path}/package.json`], {
          base: './'
        })
        .pipe(
          modifyFile((content: string) => {
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
 * Create a git tag.
 *
 * @param config - Config settings
 * @param tag - The tag to create
 * @param labelPrefix - A prefix to print before the label
 */
function createTag(
  config: IConfig,
  tag: string,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'create tag';

  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        // Are we doing a dryrun?
        if (config.publish.dryrun) {
          resolve();
          tasksHelpers.log.info(
            `skipping ${subTaskLabel}${dryRunLabel}`,
            labelPrefix
          );

          return;
        }

        tasksHelpers.log.starting(subTaskLabel, labelPrefix);

        await gitTag(tag, null, null);

        resolve();
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

/**
 * Merge the changes into the major branch for this release.
 *
 * @param config - Config settings
 * @param majorBranch - The branch to merge into
 * @param fromBranch - Thr branch to merge from
 * @param labelPrefix - A prefix to print before the label
 */
function mergeIntoMajorBranch(
  config: IConfig,
  majorBranch: string,
  fromBranch: string,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'merge into major branch';

  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        if (majorBranch === null) {
          resolve();
          tasksHelpers.log.info(`skipping ${subTaskLabel}`, labelPrefix);

          return;
        }

        // Are we doing a dryrun?
        if (config.publish.dryrun) {
          resolve();
          tasksHelpers.log.info(
            `skipping ${subTaskLabel}${dryRunLabel}`,
            labelPrefix
          );

          return;
        }

        tasksHelpers.log.starting(subTaskLabel, labelPrefix);

        await gitCheckout(majorBranch, { args: '-b' });
        await gitMerge(fromBranch);

        resolve();
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

type TPublishToNpm = {
  lastCommit: string;
  publisher: string;
  versionCommit: string;
};

/**
 * Publish to npm.
 *
 * @param config - Config settings
 * @param npmTag - The npm release tag
 * @param labelPrefix - A prefix to print before the label
 */
function publishToNpm(
  config: IConfig,
  npmTag: string,
  labelPrefix?: string
): Promise<TPublishToNpm> {
  const subTaskLabel = 'publish to npm';

  return new Promise(
    async (resolve: (value: TPublishToNpm) => void, reject: (reason: Error) => void) => {
      try {
        // Are we doing a dryrun?
        if (config.publish.dryrun) {
          resolve({
            lastCommit: (await exec('git log -1 --oneline')).replace(/\n$/, ''),
            publisher: (await exec('npm whoami --silent')).replace(/\n$/, ''),
            versionCommit: '?????'
          });
          tasksHelpers.log.info(
            `skipping ${subTaskLabel}${dryRunLabel}`,
            labelPrefix
          );

          return;
        }

        const confirm = await promptUserConfirmPublish();

        if (confirm) {
          await exec(
            `npm publish ${normalize(`./${config.dist.path}`)} --tag ${npmTag}`
          );
        } else {
          throw new Error('User aborted.');
        }

        resolve({
          lastCommit: (await exec(
            'git log -2 --oneline --reverse | head -1'
          )).replace(/\n$/, ''),
          publisher: (await exec('npm whoami --silent')).replace(/\n$/, ''),
          versionCommit: (await exec('git log -1 --oneline')).replace(/\n$/, '')
        });
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

/**
 * Checkout the branch the user was originally on.
 *
 * @param branch - The branch the git repo should be on.
 * @param labelPrefix - A prefix to print before the label
 */
function restoreBranch(branch: string, labelPrefix?: string): Promise<void> {
  const subTaskLabel = 'restore branch';

  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        tasksHelpers.log.starting(subTaskLabel, labelPrefix);

        // No need to check the branch out if it is already checked out.
        if ((await gitRevParse({ args: '--abbrev-ref HEAD' })) !== branch) {
          await gitCheckout(branch);
        }

        resolve();
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

/**
 * Clean up.
 *
 * @param branch - The branch the git repo should be on.
 * @param labelPrefix - A prefix to print before the label
 */
function cleanUp(branch: string, labelPrefix?: string): Promise<void> {
  const subTaskLabel = 'clean up';

  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        const subTaskLabelPrefix = tasksHelpers.log.starting(
          subTaskLabel,
          labelPrefix
        );

        await restoreBranch(branch, subTaskLabelPrefix);

        resolve();
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

/**
 * Print out info about the release.
 *
 * @param config - Config settings
 * @param releaseInfo - Information about the release
 * @param labelPrefix - A prefix to print before the label
 */
function printNpmReleaseInfo(
  config: IConfig,
  releaseInfo: any,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'release info';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      // Are we doing a dryrun?
      if (config.publish.dryrun) {
        // eslint-disable-next-line no-console
        console.info(`  ${magenta('=== Dry Run ===')}`);
      }

      // eslint-disable-next-line no-console
      console.info(`\
  ${yellow('Version')}:               ${releaseInfo.version}
  ${yellow('Version commit')}:        ${releaseInfo.versionCommit}
  ${yellow('Last commit')}:           ${releaseInfo.lastCommit}
  ${yellow('NPM tag')}:               ${releaseInfo.npmTag}
  ${yellow('Publisher')}:             ${releaseInfo.publisher}`);

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Push everything to git.
 *
 * @param config - Config settings
 * @param currentBranch - The branch the user is on
 * @param majorBranch - The release's major branch
 * @param labelPrefix - A prefix to print before the label
 */
function pushToGit(
  config: IConfig,
  currentBranch: string,
  majorBranch: string,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'git push';

  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        // Are we doing a dryrun?
        if (config.publish.dryrun) {
          resolve();
          tasksHelpers.log.info(
            `skipping ${subTaskLabel}${dryRunLabel}`,
            labelPrefix
          );

          return;
        }

        tasksHelpers.log.starting(subTaskLabel, labelPrefix);

        const branches = [currentBranch];
        if (majorBranch != null) {
          branches.push(majorBranch);
        }

        await gitPush('origin', branches);
        await gitPush('origin', null, { args: '--tags' });

        resolve();
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

/**
 * Create the archives for the GitHub release.
 *
 * @param directory - The directory that contains the files to add.
 * @param outputFile - The output file
 * @param format - The format of the archive
 * @param formatOptions - The format settings
 */
function createArchive(
  directory: string,
  outputFile: string,
  format: ArchiverFormat,
  formatOptions: ArchiverOptions
): Promise<void> {
  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        // Delete the file if it already exists.
        await del(outputFile);

        const outputStream = createWriteStream(outputFile);
        const archive = archiver(format, formatOptions);

        archive.on('warning', (error: any) => {
          if (error.code === 'ENOENT') {
            console.warn(error);
          } else {
            reject(error);
          }
        });

        archive.on('error', (error: Error) => {
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
    }
  );
}

/**
 * Create the archives for the GitHub release.
 *
 * @param config - Config settings
 * @param version - The version of the release
 * @param labelPrefix - A prefix to print before the label
 */
function createArchivesForGitHubRelease(
  config: IConfig,
  version: string,
  labelPrefix?: string
): Promise<string[]> {
  const subTaskLabel = 'create archives';

  return new Promise(
    async (resolve: (value: string[]) => void, reject: (reason: Error) => void) => {
      try {
        if (config.componenet.name == null) {
          resolve([]);
          tasksHelpers.log.info(`skipping ${subTaskLabel}`, labelPrefix);

          return;
        }

        tasksHelpers.log.starting(subTaskLabel, labelPrefix);

        const archiveFormats = config.publish.archiveFormats;

        const assets: string[] = [];
        const archivers: Promise<void>[] = [];

        for (const [format, formatConfig] of Object.entries(archiveFormats)) {
          if (!formatConfig.ignore) {
            const outputFile = `./${config.temp.path}/${
              config.componenet.name
            }-${version}${formatConfig.extension}`;

            archivers.push(
              createArchive(
                `./${config.dist.path}`,
                outputFile,
                format as ArchiverFormat,
                formatConfig.options
              )
            );

            assets.push(outputFile);
          }
        }

        await Promise.all(archivers);

        resolve(assets);
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

/**
 * Commit the GitHub release.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param settings - Settings for the release
 * @param [assets=[]] - Extra assets to upload
 * @param labelPrefix - A prefix to print before the label
 */
function commitGitHubRelease(
  gulp: GulpClient.Gulp,
  config: IConfig,
  settings: object,
  assets: string[] = [],
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'commit';

  return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
    try {
      // Are we doing a dryrun?
      if (config.publish.dryrun) {
        resolve();
        tasksHelpers.log.info(
          `skipping ${subTaskLabel}${dryRunLabel}`,
          labelPrefix
        );

        return;
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      let rejected = false;

      gulp
        .src(assets, { allowEmpty: true })
        .pipe(release(settings))
        .on('end', () => {
          if (!rejected) {
            resolve();
            tasksHelpers.log.successful(subTaskLabel, labelPrefix);
          }
        })
        .on('error', (error: Error) => {
          rejected = true;
          throw error;
        });
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Create a GitHub release.
 *
 * @param gulp - Gulp library
 * @param config - Config settings
 * @param settings - Settings for the release
 * @param labelPrefix - A prefix to print before the label
 */
function createGitHubRelease(
  gulp: GulpClient.Gulp,
  config: IConfig,
  settings: any,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = 'GitHub release';

  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        const subTaskLabelPrefix = tasksHelpers.log.starting(
          subTaskLabel,
          labelPrefix
        );

        const archives = await createArchivesForGitHubRelease(
          config,
          settings.version,
          subTaskLabelPrefix
        );

        try {
          await commitGitHubRelease(
            gulp,
            config,
            settings,
            archives,
            subTaskLabelPrefix
          );
        } catch (error) {
          // TODO: Prompt the user if they want to try again.
          // TODO: Prompt for new parameters.

          // Display the error message.
          // console.error(
          //   `Failed to commit GitHub release.\nReturned error message: ${
          //     error.message
          //   }`
          // );

          // TODO: Replace with user abort error (once prompts above are working).
          throw error;
        }

        resolve();
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } catch (error) {
        reject(error);
        tasksHelpers.log.failed(subTaskLabel, labelPrefix);
      }
    }
  );
}

/**
 * Publish the component.
 *
 * @param gulp
 * @param config
 */
export function publish(gulp: GulpClient.Gulp, config: IConfig): Promise<void> {
  return new Promise(
    async (resolve: () => void, reject: (reason: Error) => void) => {
      try {
        // Are we doing a dryrun?
        if (config.publish.dryrun) {
          tasksHelpers.log.info(`${magenta('Performing dry run')}`);
        }

        if (config.package == null) {
          throw new Error('No package data.');
        }

        // Information about the environment and setting the user want for publishing.
        const info: any = {
          git: {
            currentBranch: await gitRevParse({ args: '--abbrev-ref HEAD' }),
            majorBranch: null,
            tag: null
          },
          releaseInfo: {
            lastCommit: null,
            npmTag: null,
            publisher: null,
            versionCommit: null
          },
          version: {
            prerelease: false,
            semantic: null
          }
        };

        // Input from the user.
        const input: any = {};
        let failed: Error | undefined;
        try {
          // Get publishing settings from the user.
          input.publishing = await promptUserPublishSettings();
          info.version.semantic = input.publishing.symver;
          info.version.prerelease = input.publishing.isPrerelease;
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
            if (config.publish.force) {
              console.warn(`Continuing despite error (force):\n  ${error}`);
            } else {
              throw error;
            }
          }

          // Check that the files are ok based on the settings given.
          try {
            await fileChecks(config);
          } catch (error) {
            // Ignore the error if force is true.
            if (config.publish.force) {
              console.warn(`Continuing despite error (force):\n  ${error}`);
            } else {
              throw error;
            }
          }

          // Update the version.
          await updateVersion(gulp, config, info.version.semantic);

          // Merge changes into the release's major branch.
          await mergeIntoMajorBranch(
            config,
            info.git.majorBranch,
            info.git.currentBranch
          );

          // Create a git tag for the release.
          await createTag(config, info.git.tag);

          // Publish the release to npm.
          const publishResults = await publishToNpm(
            config,
            info.releaseInfo.npmTag
          );
          info.releaseInfo.versionCommit = publishResults.versionCommit;
          info.releaseInfo.lastCommit = publishResults.lastCommit;
          info.releaseInfo.publisher = publishResults.publisher;
        } catch (error) {
          failed = error;
        } finally {
          // Clean up.
          await cleanUp(info.git.currentBranch);
        }

        // Failed?
        if (failed != null) {
          reject(failed);
          return;
        }

        // Print out information about the npm release. Ignore any errors.
        try {
          await printNpmReleaseInfo(config, {
            version: info.version.semantic,
            ...info.releaseInfo
          });
        } catch (error) {}

        // Ask the user if they want to push the changes to git.
        input.pushToGit = await promptUserPushToGit();

        // User want to push changes.
        if (input.pushToGit) {
          // Push changes to GitHub.
          await pushToGit(config, info.git.currentBranch, info.git.majorBranch);

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
              await createGitHubRelease(gulp, config, {
                version: info.version.semantic,
                ...input.gitHubRelease.settings
              });
            }
          }
        }
        resolve();
      } catch (error) {
        // Resolve regardless of any errors caught here.
        resolve();
        console.error(`Something when wrong: ${error.message}`);
      }
    }
  );
}

/**
 * Perform a dry run of the publish task.
 *
 * @param gulp
 * @param config
 */
export function publishDry(gulp: GulpClient.Gulp, config: IConfig): Promise<void> {
  config.publish.dryrun = true;
  config.publish.force = true;

  return publish(gulp, config);
}
