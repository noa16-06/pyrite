import test from "node:test";
import assert from "node:assert/strict";

// platform.js sets the OS marker at import time; these tests do not mount an editor.
globalThis.document = { documentElement: { dataset: {}, style: {} }, createElement: () => ({ style: {} }) };
const { TauriTransport } = await import("../src/intelligence.js");
const { api } = await import("../src/api.js");

test("initialize includes the project workspace folder without changing other parameters", async (t) => {
  for (const [uri, name] of [
    ["file:///tmp/project%20one", "project one"],
    ["file:///C:/Projects/caf%C3%A9", "café"],
    ["file:///", "/"],
  ]) {
    const sent = [];
    t.mock.method(api, "lspSend", async (id, message) => sent.push({ id, message: JSON.parse(message) }));
    const transport = new TauriTransport({});
    transport.id = 7;
    const request = { jsonrpc: "2.0", id: 1, method: "initialize", params: {
      rootUri: uri, capabilities: { workspace: { configuration: true } }, processId: null,
    } };
    transport.send(JSON.stringify(request));
    await transport.queue;
    assert.deepEqual(sent, [{ id: 7, message: {
      ...request, params: { ...request.params, workspaceFolders: [{ uri, name }] },
    } }]);
    t.mock.restoreAll();
  }
});

test("other LSP messages and an explicit workspace list are preserved", async (t) => {
  const sent = [];
  t.mock.method(api, "lspSend", async (_id, message) => sent.push(message));
  const transport = new TauriTransport({});
  transport.id = 7;
  const messages = [
    { jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: "file:///tmp/a.py" } } },
    { jsonrpc: "2.0", id: 2, result: null },
    { jsonrpc: "2.0", id: 3, method: "initialize", params: { rootUri: null } },
    { jsonrpc: "2.0", id: 4, method: "initialize", params: { rootUri: "file:///tmp", workspaceFolders: [] } },
  ].map(JSON.stringify);
  for (const message of messages) transport.send(message);
  await transport.queue;
  assert.deepEqual(sent, messages);
});
