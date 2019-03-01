import { test as wctRunner } from 'web-component-tester';

import { Config } from '../config';

/**
 * Run tests.
 */
export async function test(config: Config): Promise<void> {
  if (config.tests.wctConfig === undefined) {
    return Promise.reject(new Error('No config for wct set.'));
  }

  await wctRunner.test(config.tests.wctConfig);
}
