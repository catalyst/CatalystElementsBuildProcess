export default (() => {
  // tslint:disable-next-line: no-any
  const presets: ReadonlyArray<string | [string, any]> = [
    [require.resolve('@babel/preset-env'), {
      useBuiltIns: 'usage'
    }],
    require.resolve('@babel/preset-typescript')
  ];
  const plugins: ReadonlyArray<string> = [
    require.resolve('@babel/plugin-syntax-dynamic-import'),
    require.resolve('babel-plugin-unassert')
  ];

  const retainLines = false;
  const comments = false;
  const minified = true;

  return {
    comments,
    minified,
    retainLines,
    presets,
    plugins
  };
})();
