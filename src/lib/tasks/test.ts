// Libraries.
import { existsSync } from 'fs-extra';
import { test as runTests } from 'web-component-tester';

import { IConfig } from '../config';
import { tasksHelpers } from '../util';

/**
 * Run tests.
 *
 * @param config - Config settings
 */
export async function test(taskName: string, config: IConfig): Promise<void> {
  await wctTests(config, taskName);
}

/**
 * Run the web componet tester tests.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
async function wctTests(config: IConfig, labelPrefix: string): Promise<void> {
  const subTaskLabel = 'wct';

  try {
    tasksHelpers.log.starting(subTaskLabel, labelPrefix);

    if (config.tests.wctConfig === undefined) {
      throw new Error(`No config for wct - cannot run wct tests.`);
    }

    if (existsSync(`./${config.dist.path}`)) {
      await runTests(config.tests.wctConfig);

      tasksHelpers.log.successful(subTaskLabel, labelPrefix);
    } else {
      throw new Error(
        `No ${config.dist.path}/ path exists - cannot run wct tests. ` +
          `Please build the component before testing.`
      );
    }
  } catch (error) {
    tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    throw error;
  }
}
