// The wrapped arm at a million slots needs about 5 GB of heap: `npm run bench` sets it; `BENCH_SLOTS=100000` for a smaller run.
import {describe, expect, it} from "vitest";
import {createApp, defineComponent, h, nextTick, reactive, type Component} from "vue";
import {live} from "../src";

const SLOTS = Number(process.env.BENCH_SLOTS ?? 1_000_000);

interface Slot { row: number; col: number; width: number; }

function makeLayout(): Slot[] {
    const slots: Slot[] = [];
    for (let i = 0; i < SLOTS; i++) slots.push({row: i % 1000, col: Math.floor(i / 1000), width: 10});
    return slots;
}

class TacetView {
    @live public count = 0;
    public layout = makeLayout();
    public bump(): void { this.count++; }
    public sumWidths(): number { let sum = 0; for (const slot of this.layout) sum += slot.width; return sum; }
}

class PlainView {
    public count = 0;
    public layout = makeLayout();
    public bump(): void { this.count++; }
    public sumWidths(): number { let sum = 0; for (const slot of this.layout) sum += slot.width; return sum; }
}

type View = TacetView | PlainView;

const makeCountTemplate = (view: View): Component => defineComponent({render: () => h("p", String(view.count))});
const makeLayoutTemplate = (view: View): Component => defineComponent({render: () => h("p", `${view.count} ${view.sumWidths()}`)});

function measureHeap(): number {
    (globalThis as {gc?: () => void}).gc?.();
    return process.memoryUsage().heapUsed;
}

function takeMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

async function measureRedraw(name: string, view: View, template: (view: View) => Component): Promise<{mount: number; redraw: number; heap: number; stray: number}> {
    const before = measureHeap();
    const root = document.createElement("div");
    const start = performance.now();
    const app = createApp(template(view));
    app.mount(root);
    const mount = performance.now() - start;
    const after = measureHeap();
    const redraws: number[] = [];
    for (let i = 0; i < 10; i++) {
        const t = performance.now();
        view.bump();
        await nextTick();
        redraws.push(performance.now() - t);
    }
    expect(root.textContent).toContain(String(view.count));
    const text = root.textContent;
    view.layout[0].width = 99;
    await nextTick();
    const stray = root.textContent !== text ? 1 : 0;
    app.unmount();
    const result = {mount, redraw: takeMedian(redraws), heap: (after - before) / 1_048_576, stray};
    console.log(`${name.padEnd(36)} mount ${result.mount.toFixed(1)} ms   one redraw ${result.redraw.toFixed(2)} ms   heap after mount ${result.heap >= 0 ? "+" : ""}${result.heap.toFixed(0)} MB   write into the layout redraws: ${stray ? "yes" : "no"}`);
    return result;
}

describe.skipIf(!process.env.BENCH)("the redraw cost", () => {
    it("reads the count: Tacet and reactive(view)", async () => {
        await measureRedraw("reads the count / Tacet", new TacetView(), makeCountTemplate);
        await measureRedraw("reads the count / reactive(view)", reactive(new PlainView()), makeCountTemplate);
    }, 120_000);

    it("walks the layout: Tacet and reactive(view)", async () => {
        const tacet = await measureRedraw("walks the layout / Tacet", new TacetView(), makeLayoutTemplate);
        const wrapped = await measureRedraw("walks the layout / reactive(view)", reactive(new PlainView()), makeLayoutTemplate);
        expect(tacet.stray).toBe(0);
        expect(wrapped.redraw).toBeGreaterThan(tacet.redraw);
    }, 300_000);
});
