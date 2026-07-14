import remapping from "@ampproject/remapping";
import { PipelineStage } from "../types";

export function bunMinify(): PipelineStage {
    return async (contents, sourcemap) => {
        const result = await Bun.build({
            entrypoints: ["__file__.js"],
            minify: true,
            sourcemap: "external",
            format: "esm",
            files: { ["__file__.js"]: contents },
        });
        const stuff = await Promise.all([result.outputs[0].text(), result.outputs[1].text()]);
        return [stuff[0], JSON.stringify(remapping([stuff[1], sourcemap], () => null))];
    }
}
