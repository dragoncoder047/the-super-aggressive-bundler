import generate from "@babel/generator";
import * as babel from "@babel/parser";
import * as t from "@babel/types";
import { PipelineStage } from "../../types";
export type BabelRewriter = (ast: t.File) => t.File;

export function babelRewrite(...rewriters: BabelRewriter[]): PipelineStage {
    return async (source, sourcemap) => {
        var ast = babel.parse(source, { sourceType: "module" }) as t.File;

        for (var rewriter of rewriters) ast = rewriter(ast);

        const { code, map } = generate(ast, {
            sourceMaps: true,
            sourceFileName: "foo.js",
            inputSourceMap: sourcemap,
        }, source);

        return [code, JSON.stringify(map)];
    }
}

export * from "./arrowFunctionRewrite";
export * from "./arrowFunctionSingle";
export * from "./classRewrite";
export * from "./hoistAllFunctions";
export * from "./inlineConstantComputedKeys";
export * from "./stringDedupe";

