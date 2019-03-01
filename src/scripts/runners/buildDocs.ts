import { Options } from '../../types';
import { Config } from '../config';
import { buildDocs } from '../functions/buildDocs';

/**
 * Run the build process.
 */
export async function run(options: Options, config: Config): Promise<void> {
  return buildDocs(options, config);
}
