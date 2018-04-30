// Libraries.
import { existsSync } from 'fs';
import { mkdir, readFile, symlink, writeFile } from 'fs/promises';

import { IConfig } from '../config';
import { tasksHelpers, waitForAllPromises } from '../util';

/**
 * Fix prismjs.
 *
 * @param Config config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function fixPrismjs(config: IConfig, labelPrefix?: string): Promise<void> {
  const subTaskLabel = `prismjs`;

  return new Promise(async (resolve, reject) => {
    try {
      const good = existsSync(`./${config.nodeModulesPath}/prismjs`);
      const bad = existsSync(`./${config.nodeModulesPath}/prism`);

      if (!good || bad) {
        resolve();
        tasksHelpers.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
        return;
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      await symlink('./prismjs', `./${config.nodeModulesPath}/prism`, 'dir');

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Fix test-fixture.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function fixTestFixture(config: IConfig, labelPrefix?: string): Promise<void> {
  const subTaskLabel = `test-fixture`;

  return new Promise(async (resolve, reject) => {
    try {
      const good = existsSync(
        `./${config.nodeModulesPath}/@polymer/test-fixture`
      );
      const bad = existsSync(`./${config.nodeModulesPath}/test-fixture`);

      if (!good || bad) {
        resolve();
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

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Fix async.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function fixAsync(config: IConfig, labelPrefix?: string): Promise<void> {
  const subTaskLabel = `async`;

  return new Promise(async (resolve, reject) => {
    try {
      const good = existsSync(
        `./${config.nodeModulesPath}/async/dist/async.js`
      );
      const bad = existsSync(`./${config.nodeModulesPath}/async/lib/async.js`);

      if (!good || bad) {
        resolve();
        tasksHelpers.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
        return;
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      if (!existsSync(`./${config.nodeModulesPath}/async/lib/`)) {
        await mkdir(`./${config.nodeModulesPath}/async/lib/`, 0o777);
      }

      await symlink(
        '../dist/async.js',
        `./${config.nodeModulesPath}/async/lib/async.js`,
        'file'
      );

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Fix sinon.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function fixSinon(config: IConfig, labelPrefix?: string): Promise<void> {
  const subTaskLabel = `sinon`;

  return new Promise(async (resolve, reject) => {
    try {
      const good = existsSync(`./${config.nodeModulesPath}/sinon/pkg/sinon.js`);
      const bad = existsSync(`./${config.nodeModulesPath}/sinonjs/sinon.js`);

      if (!good || bad) {
        resolve();
        tasksHelpers.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
        return;
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      if (!existsSync(`./${config.nodeModulesPath}/sinonjs`)) {
        await mkdir(`./${config.nodeModulesPath}/sinonjs`, 0o777);
      }

      await symlink(
        '../sinon/pkg/sinon.js',
        `./${config.nodeModulesPath}/sinonjs/sinon.js`,
        'file'
      );

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Fix iron-scroll-manager.js
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function fixIronScrollManager(
  config: IConfig,
  labelPrefix?: string
): Promise<void> {
  const subTaskLabel = `iron-scroll-manager.js`;

  return new Promise(async (resolve, reject) => {
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
        resolve();
        tasksHelpers.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
        return;
      }

      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      await writeFile(file, updatedContent, 'utf8');

      resolve();
      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Fix dependencies.
 *
 * @param config - Config settings
 */
export function fixDependencies(config: IConfig) {
  return new Promise(async (resolve, reject) => {
    try {
      await waitForAllPromises([
        fixPrismjs(config),
        fixTestFixture(config),
        fixAsync(config),
        fixSinon(config),
        fixIronScrollManager(config)
      ]);

      resolve();
    } catch (error) {
      reject(error);
    }
  });
}
