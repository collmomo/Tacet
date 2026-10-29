import {describe, expect, it} from "vitest";
import {isReactive, toRaw} from "vue";
import {deep, live, toDeep} from "../src";
import {follow} from "./helpers";

class Sheet {
    @deep public cells: {value: number; note?: string}[][] = [];
    @deep public byName = new Map<string, {value: number}>();
    @deep public tags = new Set<string>();
    @deep public config: {theme: {dark: boolean}} = {theme: {dark: false}};
}

class Chart {
    public points = 0;
}

describe("@deep", () => {
    it("follows a nested plain object", () => {
        const sheet = new Sheet();
        const watcher = follow(() => sheet.config.theme.dark);
        sheet.config.theme.dark = true;
        expect(watcher.runs).toBe(2);
        sheet.config.theme = {dark: false};
        expect(watcher.runs).toBe(3);
        sheet.config = {theme: {dark: true}};
        expect(watcher.runs).toBe(4);
        expect(watcher.last).toBe(true);
    });

    it("follows a mutation reached through index, iteration and callbacks", () => {
        const sheet = new Sheet();
        sheet.cells = [[{value: 1}, {value: 2}]];
        const byIndex = follow(() => sheet.cells[0][1].value);
        const byForOf = follow(() => { let sum = 0; for (const row of sheet.cells) for (const cell of row) sum += cell.value; return sum; });
        const byMap = follow(() => sheet.cells.map(row => row.map(cell => cell.value).join(",")).join(";"));
        const byReduce = follow(() => sheet.cells[0].reduce((sum, cell) => sum + cell.value, 0));
        const byFind = follow(() => sheet.cells[0].find(cell => cell.value > 5)?.value ?? -1);
        sheet.cells[0][1].value = 7;
        expect(byIndex.last).toBe(7);
        expect(byForOf.last).toBe(8);
        expect(byMap.last).toBe("1,7");
        expect(byReduce.last).toBe(8);
        expect(byFind.last).toBe(7);
        sheet.cells[0].push({value: 10});
        expect(byForOf.last).toBe(18);
        expect(byMap.last).toBe("1,7,10");
        sheet.cells.push([{value: 100}]);
        expect(byForOf.last).toBe(118);
        expect(byIndex.runs).toBe(2);
    });

    it("keeps one identity for one object", () => {
        const sheet = new Sheet();
        const row = [{value: 1}];
        sheet.cells = [row];
        expect(sheet.cells[0]).toBe(sheet.cells[0]);
        expect(toRaw(sheet.cells[0])).toBe(row);
        expect(sheet.cells.includes(sheet.cells[0])).toBe(true);
        expect(sheet.cells.indexOf(row)).toBe(0);
        const same = sheet.cells;
        sheet.cells = same;
        const watcher = follow(() => sheet.cells);
        sheet.cells = sheet.cells;
        sheet.cells = toRaw(sheet.cells);
        expect(watcher.runs).toBe(1);
    });

    it("follows a Map and a Set", () => {
        const sheet = new Sheet();
        const size = follow(() => sheet.byName.size + sheet.tags.size);
        const value = follow(() => sheet.byName.get("a")?.value ?? -1);
        const walked = follow(() => { let sum = 0; for (const [, cell] of sheet.byName) sum += cell.value; sheet.byName.forEach(cell => { sum += cell.value; }); return sum; });
        sheet.byName.set("a", {value: 1});
        sheet.tags.add("x");
        expect(size.last).toBe(2);
        expect(value.last).toBe(1);
        expect(walked.last).toBe(2);
        sheet.byName.get("a")!.value = 5;
        expect(value.last).toBe(5);
        expect(walked.last).toBe(10);
        expect([...sheet.tags]).toEqual(["x"]);
        expect(sheet.tags.has("x")).toBe(true);
        sheet.byName.delete("a");
        expect(value.last).toBe(-1);
    });

    it("stops at a class: an unmarked class inside is a value", () => {
        class Holder {
            @deep public rows: {chart: Chart}[] = [];
        }
        const holder = new Holder();
        const chart = new Chart();
        holder.rows.push({chart});
        expect(holder.rows[0].chart).toBe(chart);
        expect(isReactive(holder.rows[0].chart)).toBe(false);
        const watcher = follow(() => holder.rows[0]?.chart.points);
        chart.points = 3;
        expect(watcher.runs).toBe(1);
        holder.rows[0].chart = new Chart();
        expect(watcher.runs).toBe(2);
    });

    it("stops at a marked class: its own marks decide", () => {
        class Cell {
            @live public value = 0;
            public note = "";
        }
        class Grid {
            @deep public cells: Cell[] = [new Cell()];
        }
        const grid = new Grid();
        const value = follow(() => grid.cells[0].value);
        const note = follow(() => grid.cells[0].note);
        grid.cells[0].value = 1;
        grid.cells[0].note = "n";
        expect(value.runs).toBe(2);
        expect(note.runs).toBe(1);
        expect(isReactive(grid.cells[0])).toBe(false);
    });

    it("a Date is a value", () => {
        class Clock {
            @live public now = new Date(0);
            @deep public stamps: {at: Date}[] = [];
        }
        const clock = new Clock();
        clock.stamps.push({at: new Date(0)});
        expect(isReactive(clock.stamps[0].at)).toBe(false);
        expect(clock.stamps[0].at).toBeInstanceOf(Date);
        const watcher = follow(() => clock.now.getTime());
        clock.now.setTime(5);
        expect(watcher.runs).toBe(1);
        clock.now = new Date(5);
        expect(watcher.runs).toBe(2);
    });

    it("toDeep returns anything that is not plain data as it is", () => {
        const chart = new Chart();
        expect(toDeep(chart)).toBe(chart);
        expect(toDeep(3)).toBe(3);
        expect(toDeep(null)).toBe(null);
        const date = new Date();
        expect(toDeep(date)).toBe(date);
    });
});
