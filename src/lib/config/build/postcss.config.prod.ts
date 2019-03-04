import colorGuard from 'colorguard';
import postcssContainerQueryProlyfill from 'cq-prolyfill/postcss-plugin';
import cssMediaQueryPacker from 'css-mqpacker';
import cssnano from 'cssnano';
import * as postcss from 'postcss';
import postcssFontMagician from 'postcss-font-magician';
import postcssImport from 'postcss-import';
import postcssPresetEnv from 'postcss-preset-env';
import postcssReporter from 'postcss-reporter';

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
    postcssPresetEnv({
      stage: 2,
      browsers: ['last 5 versions', '>= 1%', 'ie >= 11'],
      features: {
        'custom-properties': false
      }
    }),
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
