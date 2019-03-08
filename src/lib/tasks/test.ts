import { test as wctRunner } from 'web-component-tester';

import { Config } from '../config';
import { EnvironmentError } from '../errors';
import { Options } from '../types';

import { buildComponent, watchComponent } from './build';

/**
 * Run the tests.
 */
export async function run(options: Options, config: Config): Promise<void> {
  if (options.env !== 'test') {
    return Promise.reject(new EnvironmentError(options.env, 'Invalid testing environment.'));
  }

  if (options.test.compileOnly) {
    if (options.watch) {
      watchComponent(config.build.tools.test.rollup);
    } else {
      await buildComponent(config.build.tools.test);
    }
  } else {
    await buildComponent(config.build.tools.test);
    await test(config);
  }
}

/**
 * Run tests.
 */
export async function test(config: Config): Promise<void> {
  if (config.tests.wctConfig === undefined) {
    return Promise.reject(new Error('No config for wct set.'));
  }

  await wctRunner.test(config.tests.wctConfig);
}
