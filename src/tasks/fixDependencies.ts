// Libraries.
import { existsSync } from 'fs';
import { mkdir, readFile, symlink, writeFile } from 'fs/promises';

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
    const good = existsSync(`./${config.nodeModulesPath}/prismjs`);
    const bad = existsSync(`./${config.nodeModulesPath}/prism`);

    if (!good || bad) {
      tasksHelpers.log.info(
        `skipping "${subTaskLabel}" - seems ok.`,
        labelPrefix
      );

      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    await symlink('./prismjs', `./${config.nodeModulesPath}/prism`, 'dir');

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
      `./${config.nodeModulesPath}/@polymer/test-fixture`
    );
    const bad = existsSync(`./${config.nodeModulesPath}/test-fixture`);

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
      `./${config.nodeModulesPath}/test-fixture`,
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
    const good = existsSync(`./${config.nodeModulesPath}/async/dist/async.js`);
    const bad = existsSync(`./${config.nodeModulesPath}/async/lib/async.js`);

    if (!good || bad) {
      tasksHelpers.log.info(
        `skipping "${subTaskLabel}" - seems ok.`,
        labelPrefix
      );

      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    if (!existsSync(`./${config.nodeModulesPath}/async/lib/`)) {
      await mkdir(`./${config.nodeModulesPath}/async/lib/`, 0o777); // tslint:disable-line:no-magic-numbers
    }

    await symlink(
      '../dist/async.js',
      `./${config.nodeModulesPath}/async/lib/async.js`,
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
    const good = existsSync(`./${config.nodeModulesPath}/sinon/pkg/sinon.js`);
    const bad = existsSync(`./${config.nodeModulesPath}/sinonjs/sinon.js`);

    if (!good || bad) {
      tasksHelpers.log.info(
        `skipping "${subTaskLabel}" - seems ok.`,
        labelPrefix
      );

      return;
    }

    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    if (!existsSync(`./${config.nodeModulesPath}/sinonjs`)) {
      await mkdir(`./${config.nodeModulesPath}/sinonjs`, 0o777); // tslint:disable-line:no-magic-numbers
    }

    await symlink(
      '../sinon/pkg/sinon.js',
      `./${config.nodeModulesPath}/sinonjs/sinon.js`,
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

    const content = await readFile(file, 'utf8');

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
