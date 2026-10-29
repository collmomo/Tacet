import {defineConfig} from "vite";
import {fileURLToPath} from "node:url";
import {tacet} from "./src/vite";

export default defineConfig({
    root: "example",
    resolve: {alias: {tacet: fileURLToPath(new URL("./src/index.ts", import.meta.url))}},
    plugins: tacet(),
    test: {
        root: ".",
        include: ["tests/**/*.test.ts", "bench/**/*.test.ts"],
        environment: "jsdom",
    },
});
