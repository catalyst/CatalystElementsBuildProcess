// tslint:disable: no-unsafe-any

import { TransformOptions } from '@babel/core';

/**
 * Get the babel config.
 */
export function getConfig(): TransformOptions {
  const presets: TransformOptions['presets'] = [
    require.resolve('@babel/preset-typescript')
  ];

  const plugins: TransformOptions['plugins'] = [
    require.resolve('@babel/plugin-syntax-dynamic-import'),
    require.resolve('babel-plugin-unassert')
  ];

  const retainLines = true;

  const shouldPrintComment: TransformOptions['shouldPrintComment'] = (comment) => {
    // Remove tslint comments.
    if (/^ *tslint\:/.test(comment)) {
      return false;
    }

    // Remove typescript compiler comments.
    if (/^ *\@ts-/.test(comment)) {
      return false;
    }

    // Keep all other comments.
    return true;
  };

  return {
    shouldPrintComment,
    retainLines,
    presets,
    plugins
  };
}
