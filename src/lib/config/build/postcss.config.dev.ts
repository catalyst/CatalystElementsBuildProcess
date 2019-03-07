// tslint:disable: no-unsafe-any

import colorGuard from 'colorguard';
import postcssContainerQuery from 'cq-prolyfill/postcss-plugin';
import * as postcss from 'postcss';
import postcssAssets from 'postcss-assets';
import postcssFontMagician from 'postcss-font-magician';
import postcssPresetEnv from 'postcss-preset-env';
import postcssReporter from 'postcss-reporter';
import postcssRucksack from 'rucksack-css';

// tslint:disable: readonly-array completed-docs
interface PostcssConfig {
  readonly plugins: Array<postcss.AcceptedPlugin>;
  readonly options: postcss.ProcessOptions;
}
// tslint:enable: readonly-array completed-docs

/**
 * Get the postcss config.
 */
export function getConfig(): PostcssConfig {
  // tslint:disable-next-line: readonly-array
  const plugins: Array<postcss.AcceptedPlugin> = [
    postcssContainerQuery(),
    postcssFontMagician(),
    postcssRucksack({
      reporter: true
    }),
    postcssPresetEnv({
      stage: 2,
      browsers: ['last 5 versions', '>= 1%', 'ie >= 11'],
      features: {
        'custom-properties': false
      }
    }),
    postcssAssets({
      cachebuster: true
    }),
    colorGuard(),
    postcssReporter()
  ];

  const options: postcss.ProcessOptions = {
    from: undefined
  };

  return {
    plugins,
    options
  };
}
