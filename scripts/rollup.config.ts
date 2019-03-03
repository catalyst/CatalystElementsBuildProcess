// tslint:disable: no-default-export

/**
 * Rollup Config.
 */

import { join as joinPath } from 'path';
import { RollupOptions } from 'rollup';
import rollupPluginBabel from 'rollup-plugin-babel';
import rollupPluginCommonjs from 'rollup-plugin-commonjs';
import rollupPluginCopy from 'rollup-plugin-cpy';
import rollupPluginHashbang from 'rollup-plugin-hashbang';
import rollupPluginJson from 'rollup-plugin-json';
import rollupPluginNodeResolve from 'rollup-plugin-node-resolve';
import rollupPluginTypescript from 'rollup-plugin-typescript2';

import packageJson from '../package.json';

const commonConfig = {
  output: {
    dir: 'dist',
    sourcemap: false
  },

  external: [
    // All the dependencies.
    ...Object.keys(packageJson.dependencies)
      .map((dependency) => {
        try {
          return require.resolve(dependency, { paths: [process.cwd()] });
        } catch (e) {
          return false;
        }
      })
      .filter((dependency) => dependency !== false) as ReadonlyArray<string>
  ],

  treeshake: {
    pureExternalModules: true,
    propertyReadSideEffects: false,
    annotations: true
  }
};

const jsConfig: RollupOptions = {
  ...commonConfig,

  input: 'src/index.ts',

  plugins: [
    rollupPluginHashbang(),
    rollupPluginNodeResolve(),
    rollupPluginCommonjs(),
    rollupPluginTypescript({
      tsconfig: 'src/tsconfig.json',
      useTsconfigDeclarationDir: true
    }),
    rollupPluginJson(),
    rollupPluginBabel({
      extensions: ['.js', '.mjs', '.ts']
    })
  ]
};

const cliConfig: RollupOptions = {
  input: 'src/bin/cli.ts',

  plugins: [
    rollupPluginHashbang(),
    rollupPluginNodeResolve(),
    rollupPluginCommonjs(),
    rollupPluginTypescript({
      tsconfig: 'src/tsconfig.json',
      tsconfigOverride: {
        compilerOptions: {
          declaration: false  // declarations are handled by the js config.
        }
      }
    }),
    rollupPluginJson(),
    rollupPluginBabel({
      extensions: ['.js', '.mjs', '.ts']
    }),
    rollupPluginCopy([
      {
        files: '**/*.d.ts',
        dest: joinPath(process.cwd(), 'dist'),
        options: {
          cwd: joinPath(process.cwd(), 'src'),
          parents: true
        }
      }
    ])
  ]
};

function setConfigOutput(
  config: RollupOptions,
  outPath: string,
  format: RollupOptions['output']['format']
): RollupOptions {
  switch (format) {
    case 'esm':
      return {
        ...config,
        output: {
          ...config.output,
          entryFileNames: `${outPath}/[name].mjs`,
          chunkFileNames: 'common/[hash].mjs',
          format
        }
      };

    case 'cjs':
      return {
        ...config,
        output: {
          ...config.output,
          entryFileNames: `${outPath}/[name].js`,
          chunkFileNames: 'common/[hash].js',
          format
        }
      };

    default:
      // tslint:disable-next-line: no-throw
      throw new Error(`Config is not set up to handle the format "${format}"`);
  }
}

// Copy the template files.
const cliConfigCopyPlugin = rollupPluginCopy([
  {
    files: 'templates/**/*',
    dest: joinPath(process.cwd(), 'dist'),
    options: {
      cwd: joinPath(process.cwd(), 'src'),
      parents: true
    }
  }
]);

const jsConfigEsm = setConfigOutput(jsConfig, '.', 'esm');
const jsConfigCjs = setConfigOutput(jsConfig, '.', 'cjs');

const jsConfigs = [
  jsConfigEsm,
  jsConfigCjs
];

const cliConfigEsm = setConfigOutput(cliConfig, 'bin', 'esm');
const cliConfigCjs = setConfigOutput(cliConfig, 'bin', 'cjs');

const cliConfigEsmWithCopy = {
  ...cliConfigEsm,
  plugins: [
    ...cliConfigEsm.plugins,
    cliConfigCopyPlugin
  ]
};

// Only one of these plugins need the copy plugin.
const cliConfigs = [
  cliConfigEsmWithCopy,
  cliConfigCjs
];

export default [
  ...jsConfigs,
  ...cliConfigs
];
