# Catalyst Elements' Build Process

[![David](https://img.shields.io/david/catalyst/catalyst-elements-build-process.svg?style=flat-square)](https://david-dm.org/catalyst/catalyst-elements-build-process)
[![David](https://img.shields.io/david/dev/catalyst/catalyst-elements-build-process.svg?style=flat-square)](https://david-dm.org/catalyst/catalyst-elements-build-process?type=dev)
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

### Step 1. Configure your gulpfile.js

Example `gulpfile.js` file:

```js
const gulp = require('gulp');
const buildProcess = require('@catalyst-elements/build-process');

// Set the config for my componenet.
buildProcess.setConfig('./package.json', {
  componenet: {
    name: 'catalyst-componenet'   // name of the component
  },

  src: {
    entrypoint: 'componenet.js',  // relative to ./src
    template: {
      html: 'template.html',      // relative to ./src
      css: 'style.css'            // relative to ./src
    }
  }
});

// Register all the exported tasks.
for (const [name, func] of Object.entries(buildProcess.tasks)) {
  gulp.task(name, func(gulp));
}
```

### Step 2. Run gulp tasks

```sh
node node_modules/.bin/gulp build
node node_modules/.bin/gulp clean
```

## Contributions

Contributions are most welcome.

Please read our [contribution guidelines](./CONTRIBUTING.md).
