import { Config } from '../config';
import { Options } from '../types';

import { generateAutoAnalysis } from './functions/generate-auto-analysis';

/**
 * Run the build process.
 */
export async function run(_options: Options, config: Config): Promise<void> {
  return generateAutoAnalysis(config);
}
