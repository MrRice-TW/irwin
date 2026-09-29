// Some sandbox desktops have no working OS clipboard, even for Set-Clipboard.
// Always verify the app's actual write payload. Never label that a native pass.
export async function prepareClipboardCheck(app) {
  return app.evaluate(async ({ clipboard }) => {
    const probe = "irwin-test-clipboard-preflight";
    await clipboard.writeText(probe);
    const nativeAvailable = (await clipboard.readText()) === probe;
    globalThis.irwinTestClipboardText = undefined;
    const write = clipboard.writeText.bind(clipboard);
    clipboard.writeText = async (text) => {
      await write(text);
      globalThis.irwinTestClipboardText = text;
    };
    return nativeAvailable;
  });
}
export async function copiedText(app, nativeAvailable) {
  return nativeAvailable
    ? app.evaluate(({ clipboard }) => clipboard.readText())
    : app.evaluate(() => globalThis.irwinTestClipboardText);
}
