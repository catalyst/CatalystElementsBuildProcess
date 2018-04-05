/* eslint-env node */

const gulp = require('gulp');
const buildProcess = require('.');

gulp.task('lint', buildProcess.tasks.lint(gulp));
gulp.task('prepublish', buildProcess.tasks.prepublish(gulp));
