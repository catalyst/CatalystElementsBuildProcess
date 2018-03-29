// Libraries.
const escodegen = require('escodegen');
const esprima = require('esprima');
const RawSource = require('webpack-sources').RawSource;

/**
 * Process the webpack output before handing it off to the WebpackClosureCompilerPlugin.
 */
module.exports = class PreWebpackClosureCompilerPlugin {
  /**
   * Make this object.
   *
   * @public
   */
  constructor() {
    this.entries = [];
  }

  /**
   * Apply this plugin.
   *
   * @public
   * @param {Object} compiler - The webpack compiler
   */
  apply(compiler) {
    compiler.plugin('compilation', compilation => {
      compilation.plugin('optimize-chunk-assets', (chunks, done) => {
        for (const chunk of chunks) {
          for (const file of chunk.files) {
            let source = compilation.assets[file].source();
            esprima.parseScript(source, {}, this.processNode.bind(this));

            const sortedEntries = this.entries.sort((a, b) => {
              return b.end - a.end;
            });

            for (const entry of sortedEntries) {
              source =
                source.slice(0, entry.start) +
                entry.replacementCode +
                source.slice(entry.end);
            }

            compilation.assets[file] = new RawSource(source);
          }
        }
        done();
      });
    });
  }

  /**
   * Process a node.
   *
   * @private
   * @param {Object} node - An esprima node object
   * @param {Object} meta - Metadata about the node
   */
  processNode(node, meta) {
    if (node.type === 'ClassDeclaration') {
      if (
        node.id != null &&
        node.superClass != null &&
        node.superClass.type === 'MemberExpression'
      ) {
        const className = node.id.name;
        const classBody = node.body;
        const superClassVar = `${className}_SuperClass_${Math.random()
          .toString(16)
          .substring(2)}`;
        if (node.superClass.computed === true) {
          if (node.superClass.object.type === 'Identifier') {
            const object = node.superClass.object.name;

            let property;
            if (node.superClass.property.type === 'Literal') {
              property = `"${node.superClass.property.value}"`;
            } else if (node.superClass.property.type === 'Identifier') {
              property = `${node.superClass.property.name}`;
            } else {
              return;
            }

            this.entries.push({
              start: meta.start.offset,
              end: meta.end.offset,
              replacementCode:
                `const ${superClassVar} = ${object}[${property}];\n` +
                `class ${className} extends ${superClassVar} ${escodegen.generate(
                  classBody
                )}`
            });
          }
        }
      }
    }
  }
};
