// tslint:disable: no-unsafe-any

import colorGuard from 'colorguard';
import postcssContainerQuery from 'cq-prolyfill/postcss-plugin';
import * as postcss from 'postcss';
import postcssAssets from 'postcss-assets';
import postcssFontMagician from 'postcss-font-magician';
import postcssPresetEnv from 'postcss-preset-env';
import postcssReporter from 'postcss-reporter';
import postcssRucksack from 'rucksack-css';

// tslint:disable: readonly-array
interface PostcssConfig {
  readonly plugins: Array<postcss.AcceptedPlugin>;
  readonly options: postcss.ProcessOptions;
}
// tslint:enable: readonly-array

const config: PostcssConfig = {
  plugins: [
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
  ],

  options: {
    from: undefined
  }
};

export default config;
