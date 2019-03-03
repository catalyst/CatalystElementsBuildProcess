# Catalyst Elements Dev Utils

[![Travis](https://img.shields.io/travis/catalyst/CatalystElementsDevUtils/master.svg?style=flat-square)](https://travis-ci.org/catalyst/CatalystElementsDevUtils)
[![David](https://img.shields.io/david/catalyst/CatalystElementsDevUtils.svg?style=flat-square)](https://david-dm.org/catalyst/CatalystElementsDevUtils)
[![David](https://img.shields.io/david/dev/catalyst/CatalystElementsDevUtils.svg?style=flat-square)](https://david-dm.org/catalyst/CatalystElementsDevUtils?type=dev)
[![npm (scoped)](https://img.shields.io/npm/v/@catalyst-elements/dev-utils.svg?style=flat-square)](https://www.npmjs.com/package/@catalyst-elements/dev-utils)

This repository contains utilities that are helpful for developing custom web components. It is only intended to be uses as dev dependency.

## Installation

```sh
# Install with npm:
npm install --save-dev @catalyst-elements/dev-utils

# Install with yarn:
yarn add -D @catalyst-elements/dev-utils
```

## Usage

### Cli

This package contains an executable script called `catalyst-elements` which can preform various [tasks](#tasks).

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

## Tasks

### Build

Build the component from the source files.

**cli task name:** build  
**js api function:** build  

### Build Docs

Build the documentation for the component.

Documentation should be in contained in the file `analysis.json` at the top level of the repository of the component being build.

See [Automatic Analysis Generation](#automatic-analysis-generation) for details on creating the `analysis.json` file.

**cli task name:** build-docs  
**js api function:** buildDocs  

### Lint

Run linting on the source code.

TypeScript files (`*.ts`) are linted with [TSLint](https://palantir.github.io/tslint/).

Sass files (`*.scss`) are linted with [stylelint](https://stylelint.io/).

**cli task name:** lint  
**js api function:** lint  

### Test

Run the tests for the component.

Tests are run using [web component tester](https://www.npmjs.com/package/web-component-tester).

**cli task name:** test  
**js api function:** test  

### Automatic Analysis Generation

Generates an analysis of the component (`auto-analysis.json`) from its distribution code. An analysis is needed for the component's documentation.

Note: The analysis created by this task is often not fully complete by it acts as a good starting point. Manual editing of the automatically generated analysis is recommended.

**cli task name:** generate-auto-analysis  
**js api function:** analyze  

## Configuration

A config file can be specified with the `--config` flag.

The config file should be a JavaScript file that has a default export of type `UserConfig`; see [src/config/userConfig.ts](src/config/userConfig.ts) for details.

Note: A TypeScript file can be given instead if the script is run through [ts-node](https://github.com/TypeStrong/ts-node) instead of node.

## Contributions

Contributions are most welcome.

Please read our [contribution guidelines](./CONTRIBUTING.md).
