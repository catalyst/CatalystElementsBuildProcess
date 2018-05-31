// Libraries.
import {
  ensureDir,
  existsSync,
  mkdir,
  readFile,
  symlink,
  writeFile
} from 'fs-extra';
import { dirname as getDirName } from 'path';

import { IConfig } from '../config';
import { runAllPromises, tasksHelpers } from '../util';

/**
 * Fix prismjs.
 *
 * @param Config config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function fixPrismjs(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = `prismjs`;

  try {
    const good = existsSync(`./node_modules/prismjs`);
    const bad = existsSync(`./node_modules/prism`);

    if (!good || bad) {
      tasksHelpers.log.info(
        `skipping "${subTaskLabel}" - seems ok.`,
        labelPrefix
      );

      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    await symlink('./prismjs', `./node_modules/prism`, 'dir');

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Fix test-fixture.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function fixTestFixture(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = `test-fixture`;

  try {
    const good = existsSync(
      `./node_modules/@polymer/test-fixture`
    );
    const bad = existsSync(`./node_modules/test-fixture`);

    if (!good || bad) {
      tasksHelpers.log.info(
        `skipping "${subTaskLabel}" - seems ok.`,
        labelPrefix
      );

      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    await symlink(
      './@polymer/test-fixture',
      `./node_modules/test-fixture`,
      'dir'
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Fix async.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function fixAsync(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = `async`;

  try {
    const good = existsSync(`./node_modules/async/dist/async.js`);
    const bad = existsSync(`./node_modules/async/lib/async.js`);

    if (!good || bad) {
      tasksHelpers.log.info(
        `skipping "${subTaskLabel}" - seems ok.`,
        labelPrefix
      );

      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    if (!existsSync(`./node_modules/async/lib/`)) {
      await mkdir(`./node_modules/async/lib/`);
    }

    await symlink(
      '../dist/async.js',
      `./node_modules/async/lib/async.js`,
      'file'
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Fix sinon.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function fixSinon(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = `sinon`;

  try {
    const good = existsSync(`./node_modules/sinon/pkg/sinon.js`);
    const bad = existsSync(`./node_modules/sinonjs/sinon.js`);

    if (!good || bad) {
      tasksHelpers.log.info(
        `skipping "${subTaskLabel}" - seems ok.`,
        labelPrefix
      );

      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    if (!existsSync(`./node_modules/sinonjs`)) {
      await mkdir(`./node_modules/sinonjs`);
    }

    await symlink(
      '../sinon/pkg/sinon.js',
      `./node_modules/sinonjs/sinon.js`,
      'file'
    );

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Fix iron-scroll-manager.js
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function fixIronScrollManager(
  config: IConfig,
  labelPrefix: string
): Promise<void> {
  const subTaskLabel = `iron-scroll-manager.js`;

  try {
    const file = `./${
      config.nodeModulesPath
    }/@polymer/iron-overlay-behavior/iron-scroll-manager.js`;

    if (!existsSync(file)) {
      tasksHelpers.log.info(
        `skipping "${subTaskLabel}" - file doesn't exist.`,
        labelPrefix
      );

      return;
    }

    const content = await readFile(file, { encoding: 'utf8', flag: 'r' });

    const updatedContent = content
      .replace(
        /export const _lockedElementCache = null;/g,
        'export let _lockedElementCache = null;'
      )
      .replace(
        /export const _unlockedElementCache = null;/g,
        'export let _unlockedElementCache = null;'
      );

    if (updatedContent === content) {
      tasksHelpers.log.info(
        `skipping "${subTaskLabel}" - seems ok.`,
        labelPrefix
      );

      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    await ensureDir(getDirName(file));
    await writeFile(file, updatedContent, 'utf8');

    tasksHelpers.log.successful(subTaskLabel, labelPrefix);
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Fix dependencies.
 *
 * @param config - Config settings
 */
export async function fixDependencies(
  taskName: string,
  config: IConfig
): Promise<void> {
  await runAllPromises([
    fixPrismjs(config, taskName),
    fixTestFixture(config, taskName),
    fixAsync(config, taskName),
    fixSinon(config, taskName),
    fixIronScrollManager(config, taskName)
  ]);
}
