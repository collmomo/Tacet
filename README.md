# Tacet

A way to build a screen with plain classes.

Nothing moves unless you marked it.

## The idea

The screen is a picture of your objects. It reads them and calls them. It owns nothing.

Your logic lives in classes you write the way you always did: fields at the top, one public method per thing a user can do. No store, no hooks, no special object to extend, no function to call to make it work.

You mark the few fields the screen reads. Everything else is plain: never watched, never walked, never wrapped. A class can hold a million-row table in a plain field and the framework will never know it is there.

Two marks. That is the whole surface on a class.

## The marks

`@live` on a field: the screen follows it. Shallow: the value, not what is inside it. A write that does not change the value does nothing.

`@deep` on a field: the screen follows it and everything inside it. For a tree the template really walks: a list of rows, a set of options. Rare, and on purpose.

No mark: plain. The framework never touches it.

A getter that reads marked fields is cached, and refreshed only when one of them changes.

Tacet is written for TypeScript and works in plain JavaScript. In JavaScript the marks are comment tags that the build reads, and the build already exists because the one-file components need it:

```js
/** @live */ draft = "";
/** @deep */ todos = [];
```

## The shape of an app

- **entities**: a thing with its fields and what it can do to itself. A `Todo`.
- **managers**: holds many of them, keeps and reads them, the rules across them. A `TodoStorage`.
- **views**: what one screen needs. One public method per user action. The marked fields. A `TodoView`.
- **components**: the one-file pages and pieces, `.tacet` files. Template, script, style together. The script is one line.

A view can hold another view, an entity or a manager, and read its marked fields through it. Where shared state lives is your design: a third view, composition, inheritance. The framework stays out of it.

## The rules

- The template is a projection. It reads a view and calls it. It never owns state.
- A view is a plain class. One public method per user action. No base class.
- Nothing is walked unless it is marked.
- A value that has not changed is never written. A marked setter compares first.
- Entities and managers never know the screen exists. A test drives a view with no browser.
- No stores. State lives on the object that owns it.

## A todo app

TypeScript, three files. The same code runs as plain JavaScript with the marks as comment tags: drop the types, keep the shape.

**The entity and the manager** (`entities/Todo.ts`, `managers/TodoStorage.ts`):

```ts
export class Todo {
    public readonly id: string;
    public text: string;
    public isDone = false;

    constructor(text: string) {
        this.id = crypto.randomUUID();
        this.text = text;
    }

    public toggle(): void {
        this.isDone = !this.isDone;
    }
}
```

```ts
export class TodoStorage {
    private static readonly KEY = "todos";

    public readTodos(): Todo[] {
        const rows: {text: string; isDone: boolean}[] = JSON.parse(localStorage.getItem(TodoStorage.KEY) ?? "[]");
        return rows.map(row => Object.assign(new Todo(row.text), row));
    }

    public writeTodos(todos: Todo[]): void {
        localStorage.setItem(TodoStorage.KEY, JSON.stringify(todos));
    }
}
```

**The view** (`views/TodoView.ts`):

```ts
export type TodoFilter = "all" | "open" | "done";

export class TodoView {
    @live public draft = "";
    @live public filter: TodoFilter = "all";
    @deep public todos: Todo[] = [];
    private readonly storage: TodoStorage;

    constructor(storage: TodoStorage) {
        this.storage = storage;
        this.todos = storage.readTodos();
    }

    /** The rows the filter keeps */
    public get shownTodos(): Todo[] {
        if (this.filter === "all") return this.todos;
        return this.todos.filter(todo => todo.isDone === (this.filter === "done"));
    }

    public addTodo(): void {
        const text = this.draft.trim();
        if (text === "") return;
        this.todos.push(new Todo(text));
        this.draft = "";
        this.storage.writeTodos(this.todos);
    }

    public toggleTodo(id: string): void {
        this.todos.find(todo => todo.id === id)?.toggle();
        this.storage.writeTodos(this.todos);
    }

    public removeTodo(id: string): void {
        this.todos = this.todos.filter(todo => todo.id !== id);
        this.storage.writeTodos(this.todos);
    }

    public setFilter(filter: TodoFilter): void {
        this.filter = filter;
    }
}
```

**The component** (`components/Todos.tacet`, the same three blocks a `.vue` file has, compiled by the borrowed compiler):

```html
<template>
  <input :value="view.draft" @input="view.draft = $event.target.value" @keydown.enter="view.addTodo()" placeholder="What needs doing?">
  <ul>
    <li v-for="todo in view.shownTodos" :key="todo.id" :class="{done: todo.isDone}">
      <input type="checkbox" :checked="todo.isDone" @change="view.toggleTodo(todo.id)">
      {{ todo.text }}
      <button @click="view.removeTodo(todo.id)">×</button>
    </li>
  </ul>
  <button v-for="f in filters" :key="f" :class="{picked: view.filter === f}" @click="view.setFilter(f)">{{ f }}</button>
</template>

<script lang="ts">
  const view = new TodoView(new TodoStorage());
  const filters: TodoFilter[] = ["all", "open", "done"];
</script>

<style>
  .done { text-decoration: line-through; }
  .picked { font-weight: bold; }
</style>
```

**Starting it** (`main.ts`):

```ts
createApp(Todos).mount("#app");
```

The root component makes its own objects. A child gets its view as a prop, or reaches it through the object its parent gave it. Tacet never holds a view and never asks you to register one.

**A test, no browser:**

```ts
const view = new TodoView(new FakeStorage());
view.draft = "milk";
view.addTodo();
expect(view.shownTodos.map(todo => todo.text)).toEqual(["milk"]);
view.setFilter("done");
expect(view.shownTodos).toEqual([]);
```

**The same view in plain JavaScript:**

```js
export class TodoView {
    /** @live */ draft = "";
    /** @live */ filter = "all";
    /** @deep */ todos = [];
    storage;
    // the rest as above, without the types
}
```

What is not there: refs, computed, watch, stores, emits, a base class, a call to make things live, a place to register views. The template reads the view and calls it. The view is a class you can use from a test, from a script, or from anything else.

## What stays from Vue, and what goes

Kept, because they are the good part: the template syntax (`v-for`, `v-if`, `:class`, `@click`, `:key`, slots), props as the way a parent hands a component what it needs (a view, an object), and the lifecycle hooks (`onMounted` and its family) for the component that must act when it is drawn or removed.

Gone, because the view does their job: `ref`, `reactive`, `computed`, `watch`, `watchEffect`, `provide`, `inject`, stores, `emit`. A computed is a getter on the class. A watch is a method called where the change happens. A child does not emit upward, it calls a method on the view it was given.

## What Tacet is, and is not

Tacet mounts a component and keeps the marked fields live. That is its whole job. It does not know what a view is.

It borrows a renderer first. The one-file layout and the template syntax stay what they are, because they are the good part. Its own words are the marks and the rules above. What draws the DOM underneath can change later without the user noticing.

It is not a store, not a state manager, not a way to organise components. The shape of your app is yours.

## Why

Deep reactivity by default is the mistake. A framework that watches everything reachable will one day walk something enormous and you will not know why the screen stopped moving. Marking the few fields a screen reads is cheaper to write, cheaper to run, and says what you meant.

Classes with one method per action are the second half. A screen built that way can be driven by a test, by a script, or by a model, with the same calls a person makes through the buttons. Nothing has to be added later to make that possible. It is already the shape.
