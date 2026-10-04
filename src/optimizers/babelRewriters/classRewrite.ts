import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";

export function classRewrite(): BabelRewriter {
    return (ast, verbose) => {
        var count = 0;
        if (verbose) console.log("starting classRewrite");
        traverse(ast, {
            ClassDeclaration(path) {
                const node = path.node as t.ClassDeclaration;
                if (!node.id) return;
                const { id, body, superClass, decorators } = node;
                path.replaceWith(t.variableDeclaration("var", [t.variableDeclarator(id, t.classExpression(id, superClass, body, decorators))]))
                count++;
            }
        });

        if (verbose) console.log("finished classRewrite by fixing", count, "classes"); 
        return ast;
    }
}
