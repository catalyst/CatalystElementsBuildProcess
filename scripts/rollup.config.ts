// tslint:disable: no-default-export

/**
 * Rollup Config.
 */

import { RollupOptions } from 'rollup';
import rollupPluginBabel from 'rollup-plugin-babel';
import rollupPluginHashbang from 'rollup-plugin-hashbang';
import rollupPluginJson from 'rollup-plugin-json';
import rollupPluginTypescript from 'rollup-plugin-typescript2';

const chuckFileNamePattern = 'lib/common/[hash]';
const tsconfig = 'tsconfig.json';

const commonConfig = {
  output: {
    dir: '.',
    sourcemap: false
  },

  external: (id: string) => {
    // Internal?
    if (id.startsWith('.') || id.startsWith('/')) {
      return false;
    }

    return true;
  },

  treeshake: {
    pureExternalModules: true,
    propertyReadSideEffects: false,
    annotations: true
  }
};

const jsConfigEsm: RollupOptions = {
  ...commonConfig,

  input: 'src/lib/index.ts',

  output: {
    ...commonConfig.output,
    entryFileNames: `lib/[name].mjs`,
    chunkFileNames: `${chuckFileNamePattern}.mjs`,
    format: 'esm'
  },

  plugins: [
    rollupPluginTypescript({
      tsconfig
    }),
    rollupPluginJson()
  ]
};

const jsConfigCjs: RollupOptions = {
  ...commonConfig,

  input: 'src/lib/index.ts',

  output: {
    ...commonConfig.output,
    entryFileNames: `lib/[name].js`,
    chunkFileNames: `${chuckFileNamePattern}.js`,
    format: 'cjs'
  },

  plugins: [
    rollupPluginTypescript({
      tsconfig,
      tsconfigOverride: {
        compilerOptions: {
          declaration: false  // declarations are handled by jsConfigEsm.
        }
      }
    }),
    rollupPluginJson(),
    rollupPluginBabel({
      extensions: ['.js', '.mjs', '.ts']
    })
  ]
};

const cliConfig: RollupOptions = {
  ...commonConfig,

  input: 'src/bin/cli.ts',

  output: {
    ...commonConfig.output,
    entryFileNames: `bin/[name].js`,
    chunkFileNames: `${chuckFileNamePattern}.js`,
    format: 'cjs'
  },

  plugins: [
    rollupPluginHashbang(),
    rollupPluginTypescript({
      tsconfig,
      tsconfigOverride: {
        compilerOptions: {
          declaration: false  // declarations are handled by jsConfigEsm.
        }
      }
    }),
    rollupPluginJson(),
    rollupPluginBabel({
      extensions: ['.js', '.mjs', '.ts']
    })
  ]
};

export default [
  jsConfigEsm,
  jsConfigCjs,
  cliConfig
];
