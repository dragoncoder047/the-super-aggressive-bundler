import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";

export function inlineConstantComputedKeys(): BabelRewriter {
    return ast => {

        traverse(ast, {
            ObjectProperty(path) {
                const prop = path.node;
                if (!prop.computed) return;
                var newKey;

                if (t.isStringLiteral(prop.key)) {
                    newKey = t.isValidIdentifier(prop.key.value)
                        ? t.identifier(prop.key.value)
                        : t.stringLiteral(prop.key.value);
                }
                else if (t.isBigIntLiteral(prop.key)) {
                    newKey = t.stringLiteral(prop.key.value.toString());
                }
                else if (t.isNumericLiteral(prop.key)) {
                    newKey = t.numericLiteral(prop.key.value);
                }
                else if (t.isTemplateLiteral(prop.key) && prop.key.expressions.length === 0) {
                    const cooked = prop.key.quasis[0].value.cooked!;
                    newKey = t.isValidIdentifier(cooked) ? t.identifier(cooked) : t.stringLiteral(cooked);
                }

                if (newKey) {
                    prop.key = newKey;
                    prop.computed = false as true; // STUPID!
                }
            }
        });

        return ast;
    }
}

