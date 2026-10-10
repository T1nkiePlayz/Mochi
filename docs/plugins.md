# Plugins (experimental)

Turn on **Settings → Experimental → Plugins**, then enable each plugin under **Settings → Plugins**. Plugins are off until you enable them one by one. Only install plugins you trust: the sandbox is best-effort.

## Layout

Each plugin lives in its own folder inside the plugins folder (**Open plugins folder** in Settings):

```
plugins/
  hello/
    plugin.json
    main.js
```

The folder name must match the plugin `id` (`a-z`, `0-9`, `-`, `_`, up to 40 characters). Limits: 50 plugins, `plugin.json` up to 32 KB, `main.js` up to 256 KB. Symlinks are ignored.

## plugin.json

```json
{
  "id": "hello",
  "name": "Hello",
  "version": "1.0.0",
  "description": "Says hello.",
  "permissions": ["notify", "games.read"],
  "commands": [{ "id": "hi", "title": "Say hello", "keywords": ["greet"] }]
}
```

Permissions: `notify` (show a notification, at most 5 a minute) and `games.read` (game ids, names and tags only; no paths or notes).

## main.js

```js
mochi.command("hi", async () => {
  const games = await mochi.games();
  await mochi.notify("Hello", `You have ${games.length} games.`);
});
```

Commands appear in the command palette under **Plugins**. A command that runs longer than 10 seconds stops the plugin.

## Sandbox

Plugins run in a Web Worker with `fetch`, `XMLHttpRequest`, `WebSocket`, storage and nested workers removed, and the app's content security policy blocks network access from workers. Permissions are enforced by Mochi, not by the plugin. Works the same on Linux and macOS.
