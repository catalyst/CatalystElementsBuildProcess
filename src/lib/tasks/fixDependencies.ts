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
import {
  logTaskFailed,
  logTaskInfo,
  logTaskStarting,
  logTaskSuccessful,
  runTasksParallel
} from '../util';

/**
 * Fix dependencies.
 *
 * @param config - Config settings
 */
export async function fixDependencies(
  taskName: string,
  config: IConfig
): Promise<void> {
  await runTasksParallel([
    fixPrismjs(taskName),
    fixTestFixture(taskName),
    fixAsync(taskName),
    fixSinon(taskName),
    fixIronScrollManager(config, taskName)
  ]);
}

/**
 * Fix prismjs.
 *
 * @param labelPrefix - A prefix to print before the label
 */
async function fixPrismjs(labelPrefix: string): Promise<void> {
  const subTaskLabel = `prismjs`;

  try {
    const good = existsSync(`./node_modules/prismjs`);
    const bad = existsSync(`./node_modules/prism`);

    if (!good || bad) {
      logTaskInfo(`skipping "${subTaskLabel}" - seems ok.`, labelPrefix);

      return;
    }

    logTaskStarting(subTaskLabel, labelPrefix);

    await symlink('./prismjs', `./node_modules/prism`, 'dir');

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Fix async.
 *
 * @param labelPrefix - A prefix to print before the label
 */
async function fixAsync(labelPrefix: string): Promise<void> {
  const subTaskLabel = `async`;

  try {
    const good = existsSync(`./node_modules/async/dist/async.js`);
    const bad = existsSync(`./node_modules/async/lib/async.js`);

    if (!good || bad) {
      logTaskInfo(`skipping "${subTaskLabel}" - seems ok.`, labelPrefix);

      return;
    }

    logTaskStarting(subTaskLabel, labelPrefix);

    if (!existsSync(`./node_modules/async/lib/`)) {
      await mkdir(`./node_modules/async/lib/`);
    }

    await symlink(
      '../dist/async.js',
      `./node_modules/async/lib/async.js`,
      'file'
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Fix sinon.
 *
 * @param labelPrefix - A prefix to print before the label
 */
async function fixSinon(labelPrefix: string): Promise<void> {
  const subTaskLabel = `sinon`;

  try {
    const good = existsSync(`./node_modules/sinon/pkg/sinon.js`);
    const bad = existsSync(`./node_modules/sinonjs/sinon.js`);

    if (!good || bad) {
      logTaskInfo(`skipping "${subTaskLabel}" - seems ok.`, labelPrefix);

      return;
    }

    logTaskStarting(subTaskLabel, labelPrefix);

    if (!existsSync(`./node_modules/sinonjs`)) {
      await mkdir(`./node_modules/sinonjs`);
    }

    await symlink(
      '../sinon/pkg/sinon.js',
      `./node_modules/sinonjs/sinon.js`,
      'file'
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
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
      logTaskInfo(
        `skipping "${subTaskLabel}" - file doesn't exist.`,
        labelPrefix
      );

      return;
    }

    const content = await readFile(file, { encoding: 'utf8', flag: 'r' });

    const updatedContent = content
      .replace(
        /export const _lockedElementCache = undefined;/g,
        'export let _lockedElementCache = undefined;'
      )
      .replace(
        /export const _unlockedElementCache = undefined;/g,
        'export let _unlockedElementCache = undefined;'
      );

    if (updatedContent === content) {
      logTaskInfo(`skipping "${subTaskLabel}" - seems ok.`, labelPrefix);

      return;
    }

    logTaskStarting(subTaskLabel, labelPrefix);

    await ensureDir(getDirName(file));
    await writeFile(file, updatedContent, 'utf8');

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Fix test-fixture.
 *
 * @param labelPrefix - A prefix to print before the label
 */
async function fixTestFixture(labelPrefix: string): Promise<void> {
  const subTaskLabel = `test-fixture`;

  try {
    const good = existsSync(`./node_modules/@polymer/test-fixture`);
    const bad = existsSync(`./node_modules/test-fixture`);

    if (!good || bad) {
      logTaskInfo(`skipping "${subTaskLabel}" - seems ok.`, labelPrefix);

      return;
    }

    logTaskStarting(subTaskLabel, labelPrefix);

    await symlink(
      './@polymer/test-fixture',
      `./node_modules/test-fixture`,
      'dir'
    );

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}
