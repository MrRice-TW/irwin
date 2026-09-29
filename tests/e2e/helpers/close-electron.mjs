export async function closeElectronWindowNormally(app) {
  const child = app.process();
  const assertNormalExit = () => {
    if (child.exitCode !== 0 || child.signalCode)
      throw new Error(
        `Electron exited abnormally (pid=${child.pid}, exitCode=${child.exitCode}, signal=${child.signalCode})`,
      );
  };
  if (child.exitCode !== null || child.signalCode) {
    assertNormalExit();
    return;
  }

  const windowsClosed = Promise.all(
    app
      .windows()
      .filter((page) => !page.isClosed())
      .map((page) => page.waitForEvent("close", { timeout: 10000 })),
  ).catch((cause) => {
    throw new Error(
      `Electron windows did not close normally (pid=${child.pid})`,
      { cause },
    );
  });
  let closeRequestError;
  await Promise.all([
    windowsClosed,
    app
      .evaluate(({ app, BrowserWindow }) => {
        // Release the inspector from the normal quit lifecycle. Once Node is
        // waiting for debugger disconnect, another evaluate(app.quit) RPC can
        // no longer complete. A prevented window close never reaches will-quit.
        app.once("will-quit", () => {
          process.getBuiltinModule("node:inspector").close();
        });
        for (const window of BrowserWindow.getAllWindows()) window.close();
      })
      .catch((error) => {
        closeRequestError = error;
      }),
  ]);
  // Quitting can close the evaluation transport before it returns its result.
  if (
    closeRequestError &&
    !/Target page, context or browser has been closed|Target closed/.test(
      String(closeRequestError),
    )
  )
    throw closeRequestError;
  if (child.exitCode !== null || child.signalCode) {
    assertNormalExit();
    return;
  }

  let onExit;
  const exited = new Promise((resolve) => {
    onExit = resolve;
    child.once("exit", onExit);
  });
  let timeout;
  try {
    // All windows have closed normally; release Playwright's Node inspector so
    // Electron does not remain at "Waiting for the debugger to disconnect".
    await Promise.race([
      Promise.all([app.close(), exited]),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                `Electron did not exit after debugger disconnect (pid=${child.pid}, exitCode=${child.exitCode})`,
              ),
            ),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    child.removeListener("exit", onExit);
  }
  assertNormalExit();
}
