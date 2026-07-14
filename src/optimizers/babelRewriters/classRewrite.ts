import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";

export function classRewrite(): BabelRewriter {
    return ast => {

        traverse(ast, {
            ClassDeclaration(path) {
                const node = path.node as t.ClassDeclaration;
                if (!node.id) return;
                const { id, body, superClass, decorators } = node;
                path.replaceWith(t.variableDeclaration("var", [t.variableDeclarator(id, t.classExpression(id, superClass, body, decorators))]))
            }
        });

        return ast;
    }
}
