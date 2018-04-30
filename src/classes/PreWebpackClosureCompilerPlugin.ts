// Libraries.
import { generate } from 'escodegen';
import { parseScript } from 'esprima';
import { Node } from 'estree';
import * as webpack from 'webpack';
import { RawSource } from 'webpack-sources';

/**
 * Process the webpack output before handing it off to the WebpackClosureCompilerPlugin.
 */
export default class PreWebpackClosureCompilerPlugin {
  private entries: Array<{ start: number, end: number, replacementCode: string }>;

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
   * @param compiler - The webpack compiler
   */
  public apply(compiler: webpack.Compiler) {
    compiler.plugin('compilation', (compilation: webpack.compilation.Compilation) => {
      compilation.plugin('optimize-chunk-assets', (chunks: webpack.compilation.Chunk[], done: () => void) => {
        for (const chunk of chunks) {
          for (const file of chunk.files) {
            let source = compilation.assets[file].source();
            parseScript(source, {}, this.processNode.bind(this));
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
   * @param node - An esprima node object
   * @param meta - Metadata about the node
   */
  public processNode(node: Node, meta: any) {
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
                `class ${className} extends ${superClassVar} ${generate(
                  classBody
                )}`
            });
          }
        }
      }
    }
  }
}
