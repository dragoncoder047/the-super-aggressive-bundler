import traverse, { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";

export function hoistAllFunctions(): BabelRewriter {
    return ast => {

        const blocksToFunctions = new Map<NodePath<t.BlockStatement | t.Program>, t.FunctionDeclaration[]>();

        traverse(ast, {
            FunctionDeclaration(path) {
                const blockParent = path.findParent(p => p.isBlockStatement() || p.isProgram()) as null | NodePath<t.BlockStatement | t.Program>;
                if (!blockParent) return;
                if (!blocksToFunctions.has(blockParent)) blocksToFunctions.set(blockParent, []);
                blocksToFunctions.get(blockParent)!.push(path.node);
                path.remove();
            }
        });

        for (var [blockPath, fns] of blocksToFunctions) {
            for (var fn of fns) {
                blockPath.unshiftContainer("body", fn);
            }
        }

        return ast;
    }
}
