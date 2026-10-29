import {live} from "../../src";

export class LocalsView {
    public plain = 0;
    @live public rows: {n: number}[] = [];
    @live public count = 0;

    @live public get throughArrow(): number {
        const sum = () => this.plain + this.rows.map(row => row.n).length;
        return sum();
    }

    @live public get throughClosure(): number {
        const rows = this.rows;
        const readLength = () => rows.map(row => row.n).length;
        return readLength();
    }

    @live public get throughFunction(): number {
        const rows = this.rows;
        function readLength(): number { return rows.length; }
        return readLength();
    }

    @live public get throughMarkedArrow(): number {
        const twice = () => this.count * 2;
        return twice();
    }
}
