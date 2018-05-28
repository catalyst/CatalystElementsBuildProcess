// Libraries.
import { generate } from 'escodegen';
import { parseScript } from 'esprima';
import { Node } from 'estree'; // tslint:disable-line:no-implicit-dependencies
import * as webpack from 'webpack';
import { RawSource } from 'webpack-sources';

/**
 * Process the webpack output before handing it off to the WebpackClosureCompilerPlugin.
 */
export class PreWebpackClosureCompilerPlugin {
  /**
   * Contains the new segments of code to replace original code with in the source code.
   *
   * Can't be done without a mutable array due to the implementation of `parseScript`
   */
  // tslint:disable-next-line:readonly-array
  private readonly codeReplacements: {
    readonly start: number;
    readonly end: number;
    readonly replacementCode: string;
  }[];

  /**
   * Construct this plugin.
   */
  public constructor() {
    this.codeReplacements = [];
  }

  /**
   * Apply this plugin.
   *
   * @param compiler - The webpack compiler
   */
  public apply(compiler: webpack.Compiler): void {
    compiler.plugin(
      'compilation',
      (compilation: webpack.compilation.Compilation) => {
        compilation.plugin(
          'optimize-chunk-assets',
          (
            chunks: ReadonlyArray<webpack.compilation.Chunk>,
            done: () => void
          ) => {
            chunks.map(chunk => {
              chunk.files.map(file => {
                const source = compilation.assets[file].source() as string;

                // Parse the source with the delegate to generate the replacement information.
                parseScript(source, {}, this.processNode.bind(this));

                // Update the source code with the replacements.
                const updatedSource = this.codeReplacements.reduce(
                  (code, codeUpdate) => {
                    return (
                      code.slice(0, codeUpdate.start) +
                      codeUpdate.replacementCode +
                      code.slice(codeUpdate.end)
                    );
                  },
                  source
                );

                // Replace the file's source code with the modified version.
                // tslint:disable-next-line:no-object-mutation
                compilation.assets[file] = new RawSource(updatedSource);
              });
            });
            done();
          }
        );
      }
    );
  }

  /**
   * Process a node.
   *
   * @param node - An esprima node object
   * @param meta - Metadata about the node
   */
  private processNode(node: Node, meta: any): void {
    if (node.type === 'ClassDeclaration') {
      if (
        node.id !== null &&
        node.superClass != null &&
        node.superClass.type === 'MemberExpression'
      ) {
        const className = node.id.name;
        const classBody = node.body;
        const superClassVar = `${className}_SuperClass_${Math.random()
          .toString(16)
          .substring(2)}`;
        if (node.superClass.computed) {
          if (node.superClass.object.type === 'Identifier') {
            const object = node.superClass.object.name;
            const property =
              node.superClass.property.type === 'Literal'
                ? `"${node.superClass.property.value}"`
                : node.superClass.property.type === 'Identifier'
                  ? `${node.superClass.property.name}`
                  : null;

            if (property !== null) {
              this.codeReplacements.push({
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
}
