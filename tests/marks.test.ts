import {describe, expect, it} from "vitest";
import {promoteScriptToSetup, readMarkName} from "../src/marks";

describe("the shared helpers", () => {
    it("promotes the script tag before the content, and says when there is none", () => {
        const source = `<template></template>\n<script lang="ts">\nconst a = 1;\n</script>`;
        const content = source.indexOf("\nconst a");
        expect(promoteScriptToSetup(source, content)).toBe(`<template></template>\n<script setup lang="ts">\nconst a = 1;\n</script>`);
        expect(promoteScriptToSetup("const a = 1;", 0)).toBeUndefined();
    });

    it("knows the two marks and nothing else", () => {
        expect(readMarkName("live")).toBe("live");
        expect(readMarkName("deep")).toBe("deep");
        expect(readMarkName("lvie")).toBeUndefined();
    });
});
