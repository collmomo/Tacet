import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {transformTacetFile} from "../src/files";
import Box from "./fixtures/Box.tacet";
import {BoxView} from "./fixtures/BoxView";

describe("a .tacet file, rewritten", () => {
    it("adds setup to the script and turns ref into a call on the view's field", () => {
        const result = transformTacetFile(`<template>\n  <div ref="view.box"></div>\n  <canvas ref='view.manager.canvas'></canvas>\n  <p ref="plain"></p>\n</template>\n<script lang="ts">\nimport {V} from "./V";\nconst view = new V();\n</script>`, "/a.tacet");
        expect(result?.code).toBe(`<template>\n  <div :ref="__tacetRef(view, 'box')"></div>\n  <canvas :ref='__tacetRef(view.manager, "canvas")'></canvas>\n  <p ref="plain"></p>\n</template>\n<script setup lang="ts">\nimport {setRef as __tacetRef} from "tacet";\n\nimport {V} from "./V";\nconst view = new V();\n</script>`);
    });

    it("leaves a script that already has setup, and a file with nothing to do", () => {
        expect(transformTacetFile(`<template><p ref="x"></p></template>\n<script setup>\nconst a = 1;\n</script>`, "/a.tacet")).toBeNull();
        const result = transformTacetFile(`<template><p ref="view.x"></p></template>\n<script setup>\nconst view = {};\n</script>`, "/a.tacet");
        expect(result?.code).toContain(`<script setup>\nimport {setRef as __tacetRef} from "tacet";`);
    });

    it("warns when a ref names a view but there is no script", () => {
        const result = transformTacetFile(`<template><p ref="view.x"></p></template>`, "/a.tacet");
        expect(result?.warnings).toEqual([`/a.tacet: ref="view.box" needs a <script> block that holds \`view\`.`]);
    });
});

describe("a .tacet component, mounted", () => {
    it("reads the view, follows its marks and hands the element to the field", async () => {
        const view = new BoxView();
        const wrapper = mount(Box, {props: {view}});
        expect(wrapper.find(".box").text()).toBe("hello");
        expect(view.box).toBe(wrapper.find(".box").element);
        expect(wrapper.find(".shown").exists()).toBe(false);

        view.setLabel("bye");
        await nextTick();
        expect(wrapper.find(".box").text()).toBe("bye");

        await wrapper.find("button").trigger("click");
        expect(wrapper.find(".shown").exists()).toBe(true);
        expect(view.box).toBe(wrapper.find(".box").element);

        wrapper.unmount();
        expect(view.box).toBeNull();
    });
});
