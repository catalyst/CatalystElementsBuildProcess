# Catalyst Elements' Build Process

[![Travis](https://img.shields.io/travis/catalyst/CatalystElementsBuildProcess/master.svg?style=flat-square)](https://travis-ci.org/catalyst/CatalystElementsBuildProcess)
[![David](https://img.shields.io/david/catalyst/CatalystElementsBuildProcess.svg?style=flat-square)](https://david-dm.org/catalyst/CatalystElementsBuildProcess)
[![David](https://img.shields.io/david/dev/catalyst/CatalystElementsBuildProcess.svg?style=flat-square)](https://david-dm.org/catalyst/CatalystElementsBuildProcess?type=dev)
[![npm (scoped)](https://img.shields.io/npm/v/@catalyst-elements/build-process.svg?style=flat-square)](https://www.npmjs.com/package/@catalyst-elements/build-process)

The build process for catalyst elements and other such components.

## Installation

Install with npm:

```sh
npm install --save-dev @catalyst-elements/build-process
```

Install with yarn:

```sh
yarn add --dev @catalyst-elements/build-process
```

## Usage

The tasks provided by this project are designed to be used with [NodeJs](http://nodejs.org).

### Step 1. Create a build-config.json file

Example `build-config.json` file:

```json
{
  "componenet": {
    "name": "my-element"
  },

  "src": {
    "entrypoint": "element.mjs",
    "template": {
      "markup": "markup.html",
      "style": "style.scss"
    }
  }
}
```

### Step 2. Set up your package.json

Example `package.json` file:

```json
{
  "name": "my-element",
  "scripts": {
    "analyze": "catalyst-elements analyze",
    "build": "catalyst-elements build",
    "build-docs": "catalyst-elements buildDocs",
    "clean": "catalyst-elements clean",
    "lint": "catalyst-elements lint",
    "test": "catalyst-elements test",
    "dry-publish": "npm run lint && npm run build && npm run test && catalyst-elements publishDry",
    "do-publish": "npm run lint && npm run build && npm run test && catalyst-elements publish",
    "postinstall": "catalyst-elements fixDependencies",
    "prepublishOnly": "echo \"Error: use the 'do-publish' script to publish.\"; exit 1"
  },
  "devDependencies": {
    "@polymer/test-fixture": "^3.0.0-pre.1",
    "web-component-tester": "^6.5.0"
  }
}
```

### Step 3. Use it

```sh
npm run build
```

## Contributions

Contributions are most welcome.

Please read our [contribution guidelines](./CONTRIBUTING.md).
