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

Below is an example using [Gulp](https://gulpjs.com/):

### Step 1. Configure your gulpfile.js

Example `gulpfile.js` file:

```js
const gulp = require('gulp');
const buildProcess = require('@catalyst-elements/build-process');

// Get the config for the tasks.
const config = buildProcess.getConfig({
  componenet: {
    // The name of the component
    name: 'catalyst-componenet'
  },

  src: {
    // Paths are relative to src.path
    entrypoint: 'componenet.js',
    template: {
      html: 'template.html',
      css: 'style.css'
    }
  }
});

// Register all the exported tasks.
for (const [name, func] of Object.entries(buildProcess.tasks)) {
  gulp.task(name, func(name, config));
}
```

### Step 2. Set up your package.json

Example `package.json` file:

```json
{
  "name": "my-element",
  "scripts": {
    "analyze": "./node_modules/.bin/gulp analyze",
    "build-docs": "./node_modules/.bin/gulp build-docs",
    "build": "./node_modules/.bin/gulp build",
    "clean": "./node_modules/.bin/gulp clean",
    "do-dry-publish": "./node_modules/.bin/gulp lint && ./node_modules/.bin/gulp build && ./node_modules/.bin/gulp test && ./node_modules/.bin/gulp publishDry",
    "do-publish": "./node_modules/.bin/gulp lint && ./node_modules/.bin/gulp build && ./node_modules/.bin/gulp test && ./node_modules/.bin/gulp publish",
    "lint": "./node_modules/.bin/gulp lint",
    "postinstall": "./node_modules/.bin/gulp fix-dependencies",
    "prepublishOnly": "echo \"Error: use the 'do-publish' script to publish.\" && exit 1",
    "test": "./node_modules/.bin/gulp test"
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
