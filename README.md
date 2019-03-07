# This is a work in progress that is not ready to be used yet

# Catalyst Elements' Development Utilities

[![Travis](https://img.shields.io/travis/catalyst/CatalystElementsDevUtils/rebuild.svg?style=flat-square)](https://travis-ci.org/catalyst/CatalystElementsDevUtils)
[![David](https://img.shields.io/david/catalyst/CatalystElementsDevUtils.svg?style=flat-square)](https://david-dm.org/catalyst/CatalystElementsDevUtils)
[![David](https://img.shields.io/david/dev/catalyst/CatalystElementsDevUtils.svg?style=flat-square)](https://david-dm.org/catalyst/CatalystElementsDevUtils?type=dev)
[![npm (scoped)](https://img.shields.io/npm/v/@catalyst-elements/dev-utils.svg?style=flat-square)](https://www.npmjs.com/package/@catalyst-elements/dev-utils)

This package contains opinionated utilities that are helpful for developing
custom web components.

Many of the utilities this package contains make assumptions about the structure
of the repository they are working on as well as the technologies used. Use the
same technologies and follow the same repository structure that the Catalyst
Elements use for best results.

Please note this package is only intended to be uses as dev dependency.

## Installation

```sh
# Install with npm:
npm install --save-dev @catalyst-elements/dev-utils

# Install with yarn:
yarn add -D @catalyst-elements/dev-utils
```

## Usage

### Cli

This package contains an executable script called `catalyst-elements` which can
preform various [tasks](#tasks).

Example of using `catalyst-elements` in `package.json`'s `scripts`:

```json
{
  "name": "my-element",
  "scripts": {
    "build": "catalyst-elements build",
    "build-docs": "catalyst-elements build-docs",
    "generate-auto-analysis": "catalyst-elements generate-auto-analysis",
    "lint": "catalyst-elements lint",
    "test": "catalyst-elements test"
  },
  "devDependencies": {
    "@catalyst-elements/dev-utils": "*"
  }
}
```

### JS API

This package can be used in JavaScript to preform various [tasks](#tasks).

Example of using `catalyst-elements` to build a component:

```js
import * as catalystElements from '@catalyst-elements/dev-utils';

async function run() {
  const options = catalystElements.loadOptions();
  const config = await catalystElements.loadConfig(options);

  await catalystElements.build(options, config);
}

run()
  .then(() => {
    console.log('The build has finished.');
  })
  .catch(() => {
    console.log('Something when wrong.');
  });
```

## Tasks

### Build

Build the component from the source files.

**cli task name:** build  
**js api function:** build

### Build Docs

Build the documentation for the component.

Documentation should be contained in the file `analysis.json` which should be
located at the root of the repository of the component being build.

See [Automatic Analysis Generation](#automatic-analysis-generation) for details
on creating the `analysis.json` file.

**cli task name:** build-docs  
**js api function:** buildDocs

### Lint

Run linting on the source code.

TypeScript files (`*.ts`) are linted with
[TSLint](https://palantir.github.io/tslint/).

Sass files (`*.scss`) are linted with [stylelint](https://stylelint.io/).

**cli task name:** lint  
**js api function:** lint

### Test

Run the tests for the component.

Tests are run using [web component
tester](https://www.npmjs.com/package/web-component-tester).

**cli task name:** test  
**js api function:** test

### Automatic Analysis Generation

Generates an analysis of the component (`auto-analysis.json`) from its
distribution code. An analysis is needed for the component's documentation.

Note: The analysis created by this task is often not fully complete by it acts
as a good starting point. Manual editing of the automatically generated analysis
is recommended.

**cli task name:** generate-auto-analysis  
**js api function:** analyze

## Configuration

The cli, a config file can be specified with the `--config` flag. With the JS
api, pass an object into the function `loadOptions()` with the key `configFile`
and value of the path to the config file.

The config file should be a JavaScript file that has a default export of type
`UserConfig`; see the [type definition](src/lib/config/userConfig.ts) for
details.

Note: A TypeScript file can be given instead if the script is run through
[ts-node](https://github.com/TypeStrong/ts-node) instead of node.

## Utility Functions

| Function                 | Description                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `glob(pattern, options)` | Uses [node-glob](https://github.com/isaacs/node-glob) to do glob matching but with a promise-based interface and support for multiple patterns. |

## Contributions

Contributions are most welcome.

Please read our [contribution guidelines](./CONTRIBUTING.md).
