/**
 * Terser Config.
 */

import { MinifyOptions } from 'terser';

const defaultConfig: Partial<MinifyOptions> = {
  compress: {
    arrows: true,
    arguments: false,
    booleans: true,
    // @ts-ignore
    booleans_as_integers: false,
    collapse_vars: true,
    comparisons: true,
    computed_props: true,
    conditionals: true,
    dead_code: true,
    defaults: false,
    directives: true,
    drop_console: false,
    drop_debugger: true,
    evaluate: true,
    expression: false,
    global_defs: {},
    hoist_funs: false,
    hoist_props: true,
    hoist_vars: false,
    if_return: true,
    inline: true,
    join_vars: true,
    keep_fargs: false,
    keep_infinity: false,
    loops: true,
    negate_iife: true,
    passes: 5,
    properties: true,
    pure_funcs: [],
    pure_getters: 'strict',
    reduce_funcs: true,
    reduce_vars: true,
    sequences: true,
    side_effects: true,
    switches: true,
    top_retain: undefined,
    typeofs: true,
    unsafe: false,
    unsafe_arrows: false,
    unsafe_comps: false,
    unsafe_Function: false,
    unsafe_math: false,
    unsafe_methods: false,
    unsafe_proto: false,
    unsafe_regexp: false,
    unsafe_undefined: false,
    unused: true
  },
  mangle: true,
  // @ts-ignore
  output: {
    ascii_only: false,
    beautify: false,
    braces: false,
    comments: false,
    indent_level: 2,
    indent_start: 0,
    inline_script: true,
    keep_quoted_props: false,
    max_line_len: false,
    preamble: undefined,
    quote_keys: false,
    quote_style: 0,
    semicolons: true
  },
  ie8: false,
  module: true,
  nameCache: undefined,
  safari10: false,
  toplevel: true,
  warnings: false
};

export const prettyModule: MinifyOptions = {
  ...defaultConfig,
  compress: false,
  mangle: false,
  // @ts-ignore
  output: {
    ...defaultConfig.output,
    beautify: true,
    braces: true,
    comments: true,
    ecma: 6,
    max_line_len: 1024
  }
};

export const minModule: MinifyOptions = {
  ...defaultConfig,
  output: {
    ...defaultConfig.output,
    ecma: 6
  }
};

export const minScript: MinifyOptions = {
  ...defaultConfig,
  output: {
    ...defaultConfig.output
  },
  ecma: 5
};
