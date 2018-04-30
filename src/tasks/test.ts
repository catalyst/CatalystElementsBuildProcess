// Libraries.
import { existsSync } from 'fs';
import { test as runTests } from 'web-component-tester';

import { IConfig } from '../config';
import { tasksHelpers } from '../util';

/**
 * Run the web componet tester tests.
 *
 * @param config - Config settings
 * @param labelPrefix - A prefix to print before the label
 */
function wctTests(config: IConfig, labelPrefix?: string): Promise<void> {
  const subTaskLabel = 'wct';

  return new Promise(async (resolve, reject) => {
    try {
      tasksHelpers.log.starting(subTaskLabel, labelPrefix);

      if (existsSync(`./${config.dist.path}`)) {
        await runTests(config.tests.wctConfig);

        resolve();
        tasksHelpers.log.successful(subTaskLabel, labelPrefix);
      } else {
        throw new Error(
          `No ${config.dist.path}/ path exists - cannot run wct tests. ` +
            `Please build the component before testing.`
        );
      }
    } catch (error) {
      reject(error);
      tasksHelpers.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Run tests.
 *
 * @param config - Config settings
 */
export function test(config: IConfig) {
  return new Promise(async (resolve, reject) => {
    try {
      await wctTests(config);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}
