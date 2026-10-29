# Tacet

A way to build a screen with plain classes.

Nothing moves unless you marked it.

## The idea

The screen is a picture of your objects. It reads them and calls them. It owns nothing.

Your logic lives in classes you write the way you always did: fields at the top, one public method per thing a user can do. No store, no watchers, no special object to extend, no function to call to make it work.

You mark the few fields the screen reads. Everything else is plain: never watched, never walked, never wrapped. A class can hold a million-row table in a plain field and the framework will never know it is there.

Two marks. That is the whole surface on a class.

## The marks

`@live` on a field: the screen follows it. Shallow: the value, not what is inside it. A write that does not change the value does nothing.

`@deep` on a field: the screen follows it and the plain objects and arrays inside it, all the way down, stopping at any class. For a tree the template really walks: a list of rows, a set of options. Rare, and on purpose.

No mark: plain. The framework never touches it.

`@live` on a getter: the result is kept until something it read changes. A getter with no mark is a plain getter and runs on every read; it can be slower, never wrong. A method never needs a mark.

In one sentence: `@live` tracks assignment, `@deep` tracks mutation. `items.push(x)` under `@live` tells no one; `items = [...items, x]` does. Under `@deep`, the push is enough.

Three rules keep the marks honest:

- **A `@live` getter may read only what can be followed.** Its result is kept until something it read changes, so everything it read that can change must be able to say so. The build checks that, path by path:
  - A hop that can change needs a mark on its own class. In `this.object.other.value`: `object` if this class can assign another one, `other` in `object`'s class if it can be replaced, `value` in `other`'s class if it moves.
  - A hop that cannot change needs nothing: a `readonly` field, or a plain object under a `@deep` field, which is followed already. In most classes the chain is readonly down to the one field that moves, so one mark is enough.
  - The getter may read other `@live` getters, and call what the build can see through: this class's own methods, the module's functions, an arrow function written inside it, `filter`, `trim`, `Math.round`. The build follows those bodies and checks their reads the same way.
  - The build refuses, naming the place: a hop that can change with no mark, a hop it cannot see through (`any`, `unknown`), a call it cannot see through (a method on an interface, a function passed by reference, a library's method on an object that can change). A refusal is a build error, never a stale value on the screen.
  - The marked reads are tracked at run time wherever they happen; the build only hunts the plain ones.
- **A class with no marks is a value.** A library's object, a Date, a range, a chart, has no surface to mark. Hold it in a marked field and replace it when it changes; the getter follows the field. Its own insides tell no one.
- **`@deep` stops at a class.** It walks plain objects and arrays all the way down and never enters a class instance. A class always decides its own surface with its own marks, so marking one field of it never changes what its other fields do, wherever the object sits.

Tacet is written for TypeScript and works in plain JavaScript. In JavaScript the marks are comment tags that the build reads, and the build already exists because the one-file components need it:

```js
/** @live */ draft = "";
/** @deep */ todos = [];
```

## The shape of an app

- **entities**: a thing with its fields and what it can do to itself. A `Todo`.
- **managers**: holds many of them, keeps and reads them, the rules across them. A `TodoStorage`.
- **views**: what one screen needs. One public method per user action. The marked fields. A `TodoView`.
- **components**: the one-file pages and pieces, `.tacet` files. Template, script, style together. The script is the imports and the view, nothing else.

A view can hold another view, an entity or a manager, and read its marked fields through it. Where shared state lives is your design: a third view, composition, inheritance. The framework stays out of it.

## The rules

- The template is a projection. It reads a view and calls it. It never owns state and never writes a field: a change goes through a method, the same method a test or a tool would call.
- A view is a plain class. One public method per user action. No base class.
- Nothing is walked unless it is marked.
- A value that has not changed is never written. A marked setter compares first.
- Entities and managers never know the screen exists. A test drives a view with no browser.
- No stores. State lives on the object that owns it.

## A todo app

TypeScript, five small files. The same code runs as plain JavaScript with the marks as comment tags: drop the types, keep the shape.

**The entity and the manager** (`entities/Todo.ts`, `managers/TodoStorage.ts`). The entity marks what the screen follows on it, since `@deep` on the view's list tracks the list and stops at the class:

```ts
export class Todo {
    public readonly id: string;
    @live public text: string;
    @live public isDone = false;

    constructor(text: string, id = crypto.randomUUID()) {
        this.id = id;
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
        const rows: {id: string; text: string; isDone: boolean}[] = JSON.parse(localStorage.getItem(TodoStorage.KEY) ?? "[]");
        return rows.map(row => {
            const todo = new Todo(row.text, row.id);
            todo.isDone = row.isDone;
            return todo;
        });
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
    @live public get shownTodos(): Todo[] {
        if (this.filter === "all") return this.todos;
        return this.todos.filter(todo => todo.isDone === (this.filter === "done"));
    }

    public typeDraft(text: string): void {
        this.draft = text;
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
  <input :value="view.draft" @input="view.typeDraft($event.target.value)" @keydown.enter="view.addTodo()" placeholder="What needs doing?">
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
  import {TodoView, type TodoFilter} from "../views/TodoView";
  import {TodoStorage} from "../managers/TodoStorage";

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
view.typeDraft("milk");
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

What is not there: `ref()`, computed, watch, stores, emits, a base class, a call to make things live, a place to register views. The template reads the view and calls it. The view is a class you can use from a test, from a script, or from anything else.

## An element of the DOM

When a view needs a DOM element, the template hands it over. Point `ref` at a field of the view: Tacet puts the element there when it is drawn and `null` when it is removed, and writes it only when it differs.

```html
<div ref="view.box">
```

```ts
private box: HTMLDivElement | null = null;   // plain: never marked, never walked
```

No variable in the script, no method for it, nothing kept in the template. The element lives in a plain field of the view, which is the only place a DOM node should ever be.

## What stays from Vue, and what goes

Kept, because they are the good part: the template syntax (`v-for`, `v-if`, `:class`, `@click`, `:key`, slots), props as the way a parent hands a component what it needs (a view, an object), and the lifecycle hooks (`onMounted` and its family) for the component that must act when it is drawn or removed.

Gone, because the view does their job: `ref()` in the script, `reactive`, `computed`, `watch`, `watchEffect`, `provide`, `inject`, stores, `emit`. The `ref` attribute in a template stays: it is how an element reaches a view. A computed is a getter on the class. A watch is a method called where the change happens. A child does not emit upward, it calls a method on the view it was given.

## What Tacet is, and is not

Tacet mounts a component and keeps the marked fields live. That is its whole job. It does not know what a view is.

It borrows a renderer first. The one-file layout and the template syntax stay what they are, because they are the good part. Its own words are the marks and the rules above. What draws the DOM underneath can change later without the user noticing.

It is not a store, not a state manager, not a way to organise components. The shape of your app is yours.

## What it costs, measured

One view holding a plain array of 1,000,000 slot objects in an unmarked field, and a template that walks it. Vue 3.5, the same view, two ways: through Tacet's marks, and wrapped the Vue way with `reactive(view)`.

| | One redraw | Memory after mount | A write into the layout redraws? |
|---|---|---|---|
| Tacet | 35 ms | +0 MB | no |
| `reactive(view)` | 4,964 ms | +1,009 MB | yes |

The wrapped view is 140 times slower and holds a gigabyte of proxies. Vue wraps lazily, so the cost is not the wrapping: it is the first reader that walks the layout through the wrapper, and every redraw after it. Tacet walks nothing it was not told to. A template that reads only a counter costs the same either way, under a millisecond.

A marked field costs 13.5 nanoseconds a read in the benchmark, against 0.9 for a plain field: fifteen times, and still nothing a screen can feel. The measurements and how to run them are in RESEARCH.md.

## Why it is useful

- **The screen never stalls on data it does not show.** A view can hold the whole model, a grid of a million cells, a layout, a document, and the framework stays out of it. Only the marked fields cost anything.
- **Less to write.** No refs, no computed, no watchers, no stores, no wiring between them. A class with two marks and a template that reads it.
- **The same code runs without a screen.** A view is a plain class: a test drives it with no browser, a script drives it, a model can drive it through the same methods a button calls. In Valorum, the chat model got 490 actions from the existing methods because they were already there.
- **Nothing to learn twice.** The template is the one you know. The class is the one you would write anyway. The marks are two words.
- **A renderer that gets better on its own.** Tacet sits on Vue's renderer. When Vue's next renderer ships, the one without the virtual tree, a `.tacet` file runs on it unchanged, and it has been tried.

## Why

Deep reactivity by default is the mistake. A framework that watches everything reachable will one day walk something enormous and you will not know why the screen stopped moving. Marking the few fields a screen reads is cheaper to write, cheaper to run, and says what you meant.

Classes with one method per action are the second half. A screen built that way can be driven by a test, by a script, or by a model, with the same calls a person makes through the buttons. Nothing has to be added later to make that possible. It is already the shape.
