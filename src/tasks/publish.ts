// Libraries.
import { magenta, yellow } from 'ansi-colors';
import archiver, { ArchiverOptions, Format as ArchiverFormat } from 'archiver';
import del from 'del';
import escapeStringRegexp from 'escape-string-regexp';
import {
  createWriteStream,
  readdir as _readdir,
  readFile as _readFile,
  writeFile as _writeFile
} from 'fs';
import { normalize as normalizePath } from 'path';
import _prompt from 'prompt';
import _gitHubRelease, { PublishReleaseSettings } from 'publish-release';
import { quote as shellQuote } from 'shell-quote';
import { promisify } from 'util';

import { IConfig } from '../config';
import { glob, runAllPromises, runCommand, tasksHelpers } from '../util';

// Promisified functions.
const readdir = promisify(_readdir);
const readFile = promisify(_readFile);
const writeFile = promisify(_writeFile);
const promptGet = promisify(_prompt.get);
const gitHubRelease = promisify(_gitHubRelease);

const dryRunLabel = magenta(' - dry run');

// tslint:disable-next-line:max-line-length
const fullSymVerRegExp = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/gi;
const basicSymVerRegExp = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/gi;

/**
 * Publish the component.
 */
export async function publish(
  taskName: string,
  config: IConfig
): Promise<void> {
  // Are we doing a dryrun?
  if (config.publish.dryrun) {
    tasksHelpers.log.info(`${magenta('Performing dry run')}`);
  }

  if (config.package === undefined) {
    throw new Error('No package data.');
  }

  const currentBranch = await runCommand('git rev-parse --abbrev-ref HEAD');

  _prompt.start();

  // Publish to npm.
  const publishedInfo = await (async () => {
    try {
      return await npmPublish(currentBranch, config, taskName);
    } finally {
      await cleanUp(currentBranch, taskName);
    }
  })();

  // Print out information about the npm release. Ignore any errors.
  try {
    await printNpmReleaseInfo(
      config,
      {
        version: publishedInfo.version.semantic,
        ...publishedInfo.releaseInfo
      },
      taskName
    );
  } catch (error) {}

  // Ask the user if they want to push the changes to git.
  if (await promptUserPushToGit()) {
    // Push changes to GitHub.
    await doPushToGit(
      config,
      publishedInfo.git.currentBranch,
      publishedInfo.git.majorBranch,
      taskName
    );

    // Only prompt about a GitHub release if the project is hosted on GitHub.
    if (config.publish.hostedOnGitHub) {
      // Ask the user if they want to do a GitHub release.
      const gitHubReleaseSettings = await promptUserGitHubReleaseSettings(
        publishedInfo.git.tag,
        publishedInfo.version.prerelease,
        config.package
      );

      if (gitHubReleaseSettings.create) {
        await createGitHubRelease(
          config,
          {
            ...gitHubReleaseSettings.options,
            version: publishedInfo.version.semantic
          },
          taskName
        );
      }
    }
  }
}

/**
 * Perform a dry run of the publish task.
 */
export async function publishDry(
  taskName: string,
  config: IConfig
): Promise<void> {
  const dryConfig = {
    ...config,
    publish: {
      ...config.publish,
      dryrun: true,
      force: true
    }
  };

  return publish(taskName, dryConfig);
}

/**
 * Publish the release to npm.
 */
async function npmPublish(
  currentBranch: string,
  config: IConfig,
  taskName: string
): Promise<IPublishedInfo> {
  const publishInfoSettingsUpdate = await getPublishSettings(currentBranch);

  // Run checks.
  await runAllPromises([
    gitChecks(
      config,
      publishInfoSettingsUpdate.git.currentBranch,
      publishInfoSettingsUpdate.version.prerelease,
      taskName
    ),
    fileChecks(config, taskName)
  ]);

  // Update the version in package.json.
  await updateVersion(
    config,
    publishInfoSettingsUpdate.version.semantic,
    taskName
  );

  // Merge changes into the release's major branch.
  await mergeChangesIntoMajorBranch(
    config,
    publishInfoSettingsUpdate.git.majorBranch,
    publishInfoSettingsUpdate.git.currentBranch,
    taskName
  );

  // Create a git tag for the release.
  await createTag(config, publishInfoSettingsUpdate.git.tag, taskName);

  // Publish the release to npm.
  const publishResults = await releaseToNpm(
    config,
    publishInfoSettingsUpdate.releaseInfo.npmTag,
    taskName
  );

  return {
    ...publishInfoSettingsUpdate,
    releaseInfo: {
      ...publishInfoSettingsUpdate.releaseInfo,
      versionCommit: publishResults.versionCommit,
      lastCommit: publishResults.lastCommit,
      publisher: publishResults.publisher
    }
  };
}

/**
 * Prompt the user for information about how to publish.
 */
async function promptUserPublishSettings(): Promise<{
  readonly isPrerelease: boolean;
  readonly npmTag: string;
  readonly symver: string;
}> {
  // Get version.
  const promptSemVer: { readonly symver: string } = await promptGet({
    properties: {
      symver: {
        description: 'Release semantic version',
        message: 'Must be a semantic version e.g. x.y.z',
        pattern: fullSymVerRegExp,
        required: true,
        type: 'string'
      }
    }
  });

  // Prerelease version?
  const isPrerelease = promptSemVer.symver.search(basicSymVerRegExp) !== 0;

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

  return {
    isPrerelease,
    npmTag: promptNpm.tag,
    symver: promptSemVer.symver
  };
}

/**
 * Prompt the user if they want to push the changes to git.
 */
async function promptUserPushToGit(): Promise<boolean> {
  const promptPush: { readonly push: boolean } = await promptGet({
    properties: {
      push: {
        default: true,
        description: 'Push changes to git?',
        required: true,
        type: 'boolean'
      }
    }
  });

  return promptPush.push;
}

/**
 * Prompt the user for information about the GitHub release settings.
 *
 * @param tag - The tag to release
 * @param prerelease - Prerelease?
 * @param packageJson - The package.json info
 */
async function promptUserGitHubReleaseSettings(
  tag: string,
  prerelease: boolean,
  packageJson: { readonly [key: string]: any }
): Promise<
  | {
      readonly create: true;
      readonly options: {
        readonly manifest: { readonly [key: string]: any };
        readonly prerelease: boolean;
        readonly tag: string;
        readonly token: string;
        readonly name: string;
        readonly notes: string;
        readonly draft: boolean;
      };
    }
  | {
      readonly create: false;
    }
> {
  const promptCreateRelease: {
    readonly createRelease: boolean;
  } = await promptGet({
    properties: {
      createRelease: {
        default: true,
        description: 'Create a GitHub release',
        required: true,
        type: 'boolean'
      }
    }
  });

  const create = promptCreateRelease.createRelease;

  if (!create) {
    return {
      create: false
    };
  }

  const releaseSettingsResult: {
    readonly token: string;
    readonly name: string;
    readonly notes: string;
    readonly draft: boolean;
  } = await promptGet({
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

  return {
    create: true,
    options: {
      manifest: packageJson,
      prerelease,
      tag,
      token: releaseSettingsResult.token,
      name: releaseSettingsResult.name,
      notes: releaseSettingsResult.notes,
      draft: releaseSettingsResult.draft
    }
  };
}

/**
 * Prompt the user to confirm the publish.
 */
async function promptUserConfirmPublish(): Promise<boolean> {
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

  return promptConfirmPublish.confirmPublish;
}

/**
 * Ensure the working director is clean.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function gitCheckWorkingDirector(labelPrefix: string): Promise<void> {
  const subTaskLabel = 'working director clean';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const status = await runCommand('git status --porcelain');
    if (status !== '') {
      throw new Error('Cannot publish - working directory is not clean.');
    }

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Ensure the branch is ok to publish from.
 *
 * @param config - Config settings
 * @param branch - The branch to check if it's ok to publish from
 * @param prerelease - Prerelease publish?
 * @param labelPrefix - A prefix to print before the label
 */
async function gitCheckGoodBranch(
  config: IConfig,
  branch: string,
  prerelease: boolean,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'branch';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const branchMuchMatch = prerelease
      ? config.publish.prereleaseBranchRegex
      : new RegExp(`^${escapeStringRegexp(config.publish.masterBranch)}$`);

    if (branch.search(branchMuchMatch) < 0) {
      throw new Error(
        prerelease
          ? `Cannot publish - not on valid prerelease branch. Branch name much match this regex: ` +
            config.publish.prereleaseBranchRegex.toString()
          : `Cannot publish - not on "${config.publish.masterBranch}" branch.`
      );
    }

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Ensure there are no unpulled/unpushed changes.
 *
 * @param labelPrefix - A prefix to print before the label
 */
async function gitCheckSynced(labelPrefix: string): Promise<void> {
  const subTaskLabel = 'in sync with upstream';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    await runCommand('git fetch --quiet');

    const [head, remote] = await Promise.all([
      runCommand('git rev-parse HEAD'),
      runCommand('git rev-parse @{u}')
    ]);

    if (head !== remote) {
      throw new Error(
        'Cannot publish - remote history differs. Please pull/push changes.'
      );
    }

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Make sure git is ok.
 *
 * @param config - Config settings
 * @param branch - The branch to check if it's ok to publish from
 * @param prerelease - Prerelease publish?
 * @param labelPrefix - A prefix to print before the label
 */
async function gitChecks(
  config: IConfig,
  branch: string,
  prerelease: boolean,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'git checks';

  try {
    if (!config.publish.runGitChecks) {
      tasksHelpers.log.info(`skipping ${subTaskLabel}`, labelPrefix);
      return;
    }

    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await runAllPromises([
      gitCheckWorkingDirector(subTaskLabelPrefix),
      gitCheckGoodBranch(config, branch, prerelease, subTaskLabelPrefix),
      gitCheckSynced(subTaskLabelPrefix)
    ]);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);

    // Ignore the error if force is true.
    if (config.publish.force) {
      console.warn(`Continuing despite error (force):\n  ${error}`);
    } else {
      throw error;
    }
  }
}

/**
 * Ensure the module file is present.
 *
 * @param config - Config settings
 * @param distFiles - An array of all the files that will be published
 * @param labelPrefix - A prefix to print before the label
 */
async function fileCheckModule(
  config: IConfig,
  distFiles: ReadonlyArray<string>,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'module';

  try {
    if (
      config.componenet.name === undefined ||
      !config.publish.checkFiles.module
    ) {
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

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Ensure the script file is present.
 *
 * @param config - Config settings
 * @param distFiles - An array of all the files that will be published
 * @param labelPrefix - A prefix to print before the label
 */
async function fileCheckScript(
  config: IConfig,
  distFiles: ReadonlyArray<string>,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'script';

  try {
    if (
      config.componenet.name === undefined ||
      !config.publish.checkFiles.script
    ) {
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

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Ensure there is a package.json file.
 *
 * @param config - Config settings
 * @param distFiles - An array of all the files that will be published
 * @param labelPrefix - A prefix to print before the label
 */
async function fileCheckPackage(
  config: IConfig,
  distFiles: ReadonlyArray<string>,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'package';

  try {
    if (!config.publish.checkFiles.package) {
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

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Ensure there is a license file.
 *
 * @param config - Config settings
 * @param distFiles - An array of all the files that will be published
 * @param labelPrefix - A prefix to print before the label
 */
async function fileCheckLicense(
  config: IConfig,
  distFiles: ReadonlyArray<string>,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'license';

  try {
    if (!config.publish.checkFiles.license) {
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

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Ensure there is a readme file.
 *
 * @param config - Config settings
 * @param distFiles - An array of all the files that will be published
 * @param labelPrefix - A prefix to print before the label
 */
async function fileCheckReadme(
  config: IConfig,
  distFiles: ReadonlyArray<string>,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'readme';

  try {
    if (!config.publish.checkFiles.readme) {
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

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Make sure all the files are ok.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function fileChecks(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = 'file checks';

  try {
    if (!config.publish.runFileChecks) {
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
    await runAllPromises([
      fileCheckModule(config, distFiles, subTaskLabelPrefix),
      fileCheckScript(config, distFiles, subTaskLabelPrefix),
      fileCheckPackage(config, distFiles, subTaskLabelPrefix),
      fileCheckLicense(config, distFiles, subTaskLabelPrefix),
      fileCheckReadme(config, distFiles, subTaskLabelPrefix)
    ]);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);

    // Ignore the error if force is true.
    if (config.publish.force) {
      console.warn(`Continuing despite error (force):\n  ${error}`);
    } else {
      throw error;
    }
  }
}

/**
 * Update the version.
 *
 * @param config - Config settings
 * @param newVersion - The version to update to
 * @param labelPrefix - A prefix to print before the label
 */
async function updateVersion(
  config: IConfig,
  newVersion: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'update version';

  try {
    // Are we doing a dryrun?
    if (config.publish.dryrun) {
      tasksHelpers.log.info(
        `skipping ${subTaskLabel}${dryRunLabel}`,
        labelPrefix
      );

      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const files = await glob([
      `./package.json`,
      `./${config.dist.path}/package.json`
    ]);

    await runAllPromises(
      files.map(async file => {
        const fileContent = await readFile(file, {
          encoding: 'utf8',
          flag: 'r'
        });
        const packageObject = JSON.parse(fileContent);
        const updatedPackageObject = `${JSON.stringify(
          { ...packageObject, version: newVersion },
          null,
          2
        )}\n`;

        await writeFile(file, updatedPackageObject);
      })
    );

    // If there were changes.
    if ((await runCommand('git status --porcelain')) !== '') {
      // Commit them.
      await runCommand(
        `git add . && git commit -m "${shellQuote([newVersion])}"`
      );
    }

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Create a git tag.
 *
 * @param config - Config settings
 * @param tag - The tag to create
 * @param labelPrefix - A prefix to print before the label
 */
async function createTag(
  config: IConfig,
  tag: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'create tag';

  try {
    // Are we doing a dryrun?
    if (config.publish.dryrun) {
      tasksHelpers.log.info(
        `skipping ${subTaskLabel}${dryRunLabel}`,
        labelPrefix
      );

      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    await runCommand(`git tag ${shellQuote([tag])}`);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Merge the changes into the major branch for this release.
 *
 * @param config - Config settings
 * @param majorBranch - The branch to merge into
 * @param fromBranch - Thr branch to merge from
 * @param labelPrefix - A prefix to print before the label
 */
async function mergeChangesIntoMajorBranch(
  config: IConfig,
  majorBranch: string | null,
  fromBranch: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'merge into major branch';

  try {
    if (majorBranch === null) {
      tasksHelpers.log.info(`skipping ${subTaskLabel}`, labelPrefix);
      return;
    }

    // Are we doing a dryrun?
    if (config.publish.dryrun) {
      tasksHelpers.log.info(
        `skipping ${subTaskLabel}${dryRunLabel}`,
        labelPrefix
      );
      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    await runCommand(`git checkout ${shellQuote([majorBranch])} -b`);
    await runCommand(`git merge ${shellQuote([fromBranch])}`);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Publish to npm.
 *
 * @param config - Config settings
 * @param npmTag - The npm release tag
 * @param labelPrefix - A prefix to print before the label
 */
async function releaseToNpm(
  config: IConfig,
  npmTag: string,
  labelPrefix: string
): Promise<{
  readonly lastCommit: string;
  readonly publisher: string;
  readonly versionCommit: string;
}> {
  const subTaskLabel = 'publish to npm';

  try {
    // Are we doing a dryrun?
    if (config.publish.dryrun) {
      tasksHelpers.log.info(
        `skipping ${subTaskLabel}${dryRunLabel}`,
        labelPrefix
      );
      return {
        lastCommit: await runCommand('git log -1 --oneline'),
        publisher: await runCommand('npm whoami --silent'),
        versionCommit: '?????'
      };
    }

    const confirm = await promptUserConfirmPublish();

    if (confirm) {
      await runCommand(
        `npm publish ${shellQuote([
          normalizePath(`./${config.dist.path}`)
        ])} --tag ${shellQuote([npmTag])}`
      );
    } else {
      throw new Error('User aborted.');
    }

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    return {
      lastCommit: await runCommand('git log -2 --oneline --reverse | head -1'),
      publisher: await runCommand('npm whoami --silent'),
      versionCommit: await runCommand('git log -1 --oneline')
    };
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Checkout the branch the user was originally on.
 *
 * @param branch - The branch the git repo should be on.
 * @param labelPrefix - A prefix to print before the label
 */
async function restoreBranch(
  branch: string,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'restore branch';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    // No need to check the branch out if it is already checked out.
    if ((await runCommand('rev-parse --abbrev-ref HEAD')) !== branch) {
      await runCommand(`git checkout ${shellQuote([branch])}`);
    }

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Clean up.
 *
 * @param branch - The branch the git repo should be on.
 * @param labelPrefix - A prefix to print before the label
 */
async function cleanUp(branch: string, labelPrefix: string): Promise<void> {
  const subTaskLabel = 'clean up';

  try {
    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    await restoreBranch(branch, subTaskLabelPrefix);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Print out info about the release.
 *
 * @param config - Config settings
 * @param releaseInfo - Information about the release
 * @param labelPrefix - A prefix to print before the label
 */
async function printNpmReleaseInfo(
  config: IConfig,
  releaseInfo: any,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'release info';

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

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Push everything to git.
 *
 * @param config - Config settings
 * @param currentBranch - The branch the user is on
 * @param majorBranch - The release's major branch
 * @param labelPrefix - A prefix to print before the label
 */
async function doPushToGit(
  config: IConfig,
  currentBranch: string,
  majorBranch: string | null,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'git push';

  try {
    // Are we doing a dryrun?
    if (config.publish.dryrun) {
      tasksHelpers.log.info(
        `skipping ${subTaskLabel}${dryRunLabel}`,
        labelPrefix
      );
      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const branches =
      majorBranch === null
        ? `${shellQuote([currentBranch])}`
        : `${shellQuote([currentBranch])} ${shellQuote([majorBranch])}`;

    await runCommand(`git push origin ${branches}`);
    await runCommand('git push origin --tags');

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Create the archives for the GitHub release.
 *
 * @param directory - The directory that contains the files to add.
 * @param outputFile - The output file
 * @param format - The format of the archive
 * @param formatOptions - The format settings
 */
async function createArchive(
  directory: string,
  outputFile: string,
  format: ArchiverFormat,
  formatOptions: ArchiverOptions
): Promise<void> {
  // Delete the file if it already exists.
  await del(outputFile);

  const outputStream = createWriteStream(outputFile);
  const archive = archiver(format, formatOptions);

  archive.on('warning', (error: any) => {
    if (error.code === 'ENOENT') {
      console.warn(error);
    } else {
      throw error;
    }
  });

  archive.on('error', (error: Error) => {
    throw error;
  });

  archive.on('finish', () => {
    return;
  });

  // Connect the archive and output stream.
  archive.pipe(outputStream);

  // Add the files.
  archive.directory(directory, false);

  // Finalize the archive.
  archive.finalize();
}

/**
 * Create the archives for the GitHub release.
 *
 * @param config - Config settings
 * @param version - The version of the release
 * @param labelPrefix - A prefix to print before the label
 */
async function createArchivesForGitHubRelease(
  config: IConfig,
  version: string,
  labelPrefix: string
  // tslint:disable-next-line:readonly-array
): Promise<string[]> {
  const subTaskLabel = 'create archives';

  try {
    if (config.componenet.name === undefined) {
      tasksHelpers.log.info(`skipping ${subTaskLabel}`, labelPrefix);
      return [];
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    const archiveFormats = config.publish.archiveFormats;

    const { assets, archivers } = Object.entries(archiveFormats).reduce(
      (result, format) => {
        const archiveFormatRaw = format[0];

        if (archiveFormatRaw !== 'tar' && archiveFormatRaw !== 'zip') {
          throw new Error('Unknown archive format.');
        }

        const [archiveFormat, formatConfig]: [
          ArchiverFormat,
          {
            readonly extension: string;
            readonly ignore: boolean;
            readonly options: ArchiverOptions;
          }
        ] = [archiveFormatRaw, format[1]];

        if (formatConfig.ignore) {
          return result;
        }

        const outputFile = `./${config.temp.path}/${
          config.componenet.name
        }-${version}${formatConfig.extension}`;

        return {
          assets: [...result.assets, outputFile],
          archivers: [
            ...result.archivers,
            createArchive(
              `./${config.dist.path}`,
              outputFile,
              archiveFormat,
              formatConfig.options
            )
          ]
        };
      },
      // tslint:disable:readonly-array
      { assets: [], archivers: [] } as {
        readonly assets: string[];
        readonly archivers: Promise<void>[];
      }
      // tslint:enable:readonly-array
    );

    await Promise.all(archivers);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    return assets;
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Commit the GitHub release.
 *
 * @param config - Config settings
 * @param settings - Settings for the release
 * @param [assets=[]] - Extra assets to upload
 * @param labelPrefix - A prefix to print before the label
 */
async function commitGitHubRelease(
  config: IConfig,
  settings: PublishReleaseSettings,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'commit';

  try {
    // Are we doing a dryrun?
    if (config.publish.dryrun) {
      tasksHelpers.log.info(
        `skipping ${subTaskLabel}${dryRunLabel}`,
        labelPrefix
      );
      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    await gitHubRelease(settings);

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Create a GitHub release.
 *
 * @param config - Config settings
 * @param options - Settings for the release
 * @param labelPrefix - A prefix to print before the label
 */
async function createGitHubRelease(
  config: IConfig,
  options: {
    readonly manifest: {
      readonly [key: string]: any;
    };
    readonly prerelease: boolean;
    readonly tag: string;
    readonly token: string;
    readonly name: string;
    readonly notes: string;
    readonly draft: boolean;
    readonly version: string;
  },
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = 'GitHub release';

  try {
    const subTaskLabelPrefix = tasksHelpers.log.starting(
      subTaskLabel,
      labelPrefix
    );

    const archives = await createArchivesForGitHubRelease(
      config,
      options.version,
      subTaskLabelPrefix
    );

    try {
      const releaseSettings = {
        ...options,
        assets: archives
      };

      await commitGitHubRelease(config, releaseSettings, subTaskLabelPrefix);
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

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Get publishing settings from the user.
 */
async function getPublishSettings(
  currentBranch: string
): Promise<IPublishSettings> {
  const input = await promptUserPublishSettings();

  return {
    version: {
      semantic: input.symver,
      prerelease: input.isPrerelease
    },
    releaseInfo: {
      npmTag: input.npmTag
    },
    git: {
      currentBranch,
      tag: `v${input.symver}`,
      majorBranch:
        Number.parseInt(input.symver.split('.')[0], 10) !== 0 &&
        !input.isPrerelease
          ? `${input.symver.split('.')[0]}.x`
          : null
    }
  };
}

interface IPublishSettings {
  readonly git: {
    readonly currentBranch: string;
    readonly majorBranch: string | null;
    readonly tag: string;
  };
  readonly releaseInfo: {
    readonly npmTag: string;
  };
  readonly version: {
    readonly prerelease: boolean;
    readonly semantic: string;
  };
}

interface IPublishedInfo extends IPublishSettings {
  readonly releaseInfo: {
    readonly npmTag: string;
    readonly lastCommit: string;
    readonly publisher: string;
    readonly versionCommit: string;
  };
}
