import { EnvironmentError } from '../../errors';
import { Options } from '../../types';
import { Config } from '../config';
import { buildComponent, watchComponent } from '../functions/build';
import { test } from '../functions/test';

/**
 * Run the tests.
 */
export async function run(options: Options, config: Config): Promise<void> {
  if (options.env !== 'test') {
    return Promise.reject(new EnvironmentError(options.env, 'Invalid testing environment'));
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
