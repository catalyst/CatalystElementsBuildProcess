import { Config } from '../config';
import { EnvironmentError } from '../errors';
import { Options } from '../types';

import { buildDevelopment, buildProduction } from './functions/build';

/**
 * Run the build process.
 */
export async function run(options: Options, config: Config): Promise<void> {
  switch (options.env) {
    case 'development':
      return buildDevelopment(options, config);
    case 'production':
      return buildProduction(options, config);
    default:
      return Promise.reject(new EnvironmentError());
  }
}
