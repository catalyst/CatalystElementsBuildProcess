// tslint:disable: no-unsafe-any

import colorGuard from 'colorguard';
import postcssContainerQueryProlyfill from 'cq-prolyfill/postcss-plugin';
import cssMediaQueryPacker from 'css-mqpacker';
import cssnano from 'cssnano';
import * as postcss from 'postcss';
import postcssAssets from 'postcss-assets';
import postcssFlexbugsFixes from 'postcss-flexbugs-fixes';
import postcssFontMagician from 'postcss-font-magician';
import postcssImport from 'postcss-import';
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
    postcssImport(),
    postcssContainerQueryProlyfill(),
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
    postcssFlexbugsFixes(),
    cssMediaQueryPacker(),
    colorGuard(),
    cssnano({
      autoprefixer: false,
      discardComments: {
        removeAll: true
      }
    }),
    postcssReporter()
  ],

  options: {
    from: undefined
  }
};

export default config;
