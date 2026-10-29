import {deep, live} from "../../src";

export type Filter = "all" | "open" | "done";

export class Todo {
    public readonly id: string;
    @live public text = "";
    @live public isDone = false;
    public plainNote = "";
    constructor(id: string) { this.id = id; }
}

export class Manager {
    @deep public todos: Todo[] = [];
    @deep public layout = {columns: [{width: 10}], theme: {dark: false}};
    @live public tags: readonly string[] = [];
    @live public config: {readonly size: number} = {size: 1};
    @live public bounds = {min: 0, max: 1} as const;
    @live public settings: Readonly<{dark: boolean}> = {dark: false};
    @live public now = new Date(0);
    @live public unused = 0;
    public readonly limit = 10;
    public readonly byName: ReadonlyMap<string, Todo> = new Map();
    public plainCount = 0;

    public count(): number { return this.todos.length; }
    public readWidth(index: number): number { return this.layout.columns[index].width; }
}

export function sum(numbers: readonly number[]): number {
    return numbers.reduce((total, n) => total + n, 0);
}

const halve = (n: number): number => n / 2;

export const FILTERS = ["all", "open", "done"] as const;

export class Player {
    public currentTime = 0;
}

export class GoodView {
    @live public filter: Filter = "all";
    @live public date = new Date(0);
    public readonly manager: Manager;
    public readonly player = new Player();
    public box: HTMLDivElement | null = null;
    public runs = 0;

    constructor(manager: Manager) { this.manager = manager; }

    @live public get shown(): Todo[] {
        this.runs++;
        if (this.filter === "all") return this.manager.todos;
        return this.manager.todos.filter(todo => todo.isDone === (this.filter === "done"));
    }

    @live public get summary(): string {
        const {todos, limit} = this.manager;
        const widths = this.manager.layout.columns.map(column => column.width);
        const first = this.manager.todos[0]?.text ?? "";
        const names = this.manager.tags.join(",");
        for (const todo of todos) if (todo.text === "") return "";
        return `${this.manager.count()}/${limit} ${first} ${sum(widths)} ${halve(this.manager.readWidth(0))} ${names} ${this.manager.config.size} ${this.manager.bounds.max} ${this.manager.settings.dark} ${FILTERS[0]} ${this.manager.now.getTime()} ${this.manager.layout.theme.dark} ${Object.keys(this.manager.layout).length} ${this.plainToggle()} ${this.helperCount}`;
    }

    @live public get stamp(): number {
        return Math.max(this.date.getTime(), new Date(this.date.getTime()).getTime());
    }

    @live public get time(): number {
        return this.player.currentTime as live;
    }

    public get helperCount(): number {
        return this.manager.todos.length + this.manager.byName.size;
    }

    public setFilter(filter: Filter): void {
        this.filter = filter;
    }

    private plainToggle(): boolean {
        return this.manager.todos.some(todo => todo.isDone);
    }
}
