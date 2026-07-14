import { arrowFunctionRewrite, babelRewrite, bunMinify, classRewrite, hoistAllFunctions, inlineConstantComputedKeys, pipelineBuild, stringDedupe } from ".";
import { arrowFunctionSingle } from "./src/optimizers/babelRewriters/arrowFunctionSingle";

await pipelineBuild({
    entrypoints: ["./example.ts"],
}, [
    bunMinify(),
    babelRewrite(
        stringDedupe(),
        arrowFunctionRewrite(),
        hoistAllFunctions(),
        arrowFunctionSingle(),
        classRewrite(),
        inlineConstantComputedKeys()),
    bunMinify(),
]);

