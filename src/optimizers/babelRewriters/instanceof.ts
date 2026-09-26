import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";

export function instanceofRewrite(): BabelRewriter {
    const instanceofName = "__instanceof_" + Math.random().toString(36).slice(2, 10);
    return ast => {
        var count = 0;
        traverse(ast, {
            BinaryExpression(path) {
                if (path.node.operator === "instanceof") {
                    count++;
                }
            },
        });
        if (count < 2) return ast;
        traverse(ast, {
            BinaryExpression(path) {
                const { node: { operator, left, right } } = path;
                if (operator === "instanceof") {
                    path.replaceWith(t.callExpression(t.identifier(instanceofName), [left, right]));
                }
            },
        });
        // Must happen after to prevent itself from being replaced
        traverse(ast, {
            Program(path) {
                path.unshiftContainer("body", t.variableDeclaration("var", [t.variableDeclarator(t.identifier(instanceofName), t.arrowFunctionExpression([t.identifier("obj"), t.identifier("cls")], t.binaryExpression("instanceof", t.identifier("obj"), t.identifier("cls"))))]));
            },
        });

        return ast;
    }
}
