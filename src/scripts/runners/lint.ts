import { Options } from '../../types';
import { Config } from '../config';
import { lint } from '../functions/lint';

/**
 * Run the build process.
 */
export async function run(_options: Options, config: Config): Promise<void> {
  return lint(config);
}
