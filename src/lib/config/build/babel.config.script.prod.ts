// tslint:disable: no-unsafe-any

import { TransformOptions } from '@babel/core';

/**
 * Get the babel config.
 */
export function getConfig(): TransformOptions {
  const presets: TransformOptions['presets'] = [
    [require.resolve('@babel/preset-env'), {
      useBuiltIns: 'usage'
    }],
    require.resolve('@babel/preset-typescript')
  ];

  const plugins: TransformOptions['plugins'] = [
    require.resolve('@babel/plugin-syntax-dynamic-import'),
    require.resolve('babel-plugin-unassert')
  ];

  const retainLines = false;
  const comments = false;
  const minified = true;

  return {
    comments,
    minified,
    retainLines,
    presets,
    plugins
  };
}
