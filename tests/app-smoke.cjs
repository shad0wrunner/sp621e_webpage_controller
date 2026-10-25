"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class ElementStub {
  constructor() {
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.style = {};
    this.children = [];
    this.classList = { add() {}, remove() {}, toggle() {} };
  }

  addEventListener() {}
  setAttribute() {}
  prepend(item) { this.children.unshift(item); }
  replaceChildren() { this.children = []; }
  get lastElementChild() { return this.children.at(-1); }
  remove() {}
}

const elements = new Map();
const getElement = (id) => {
  if (!elements.has(id)) elements.set(id, new ElementStub());
  return elements.get(id);
};
const writes = [];
const delays = [];
const characteristicListeners = new Map();
const characteristic = {
  properties: { notify: false },
  addEventListener(type, listener) { characteristicListeners.set(type, listener); },
  removeEventListener(type, listener) {
    if (characteristicListeners.get(type) === listener) characteristicListeners.delete(type);
  },
  async writeValueWithoutResponse(value) { writes.push(Buffer.from(value)); },
};
const service = { async getCharacteristic() { return characteristic; } };
const server = { async getPrimaryService() { return service; } };
const deviceListeners = new Map();
let disconnectCalls = 0;
const device = {
  name: "SP621E",
  addEventListener(type, listener) { deviceListeners.set(type, listener); },
  removeEventListener(type, listener) {
    if (deviceListeners.get(type) === listener) deviceListeners.delete(type);
  },
  gatt: {
    connected: true,
    async connect() { this.connected = true; return server; },
    disconnect() { disconnectCalls += 1; this.connected = false; },
  },
};

let timerId = 0;
const context = vm.createContext({
  console,
  navigator: { bluetooth: { async requestDevice() { return device; } } },
  document: {
    getElementById: getElement,
    createElement: () => new ElementStub(),
    querySelectorAll: () => [],
  },
  window: {
    setTimeout(callback, milliseconds) {
      delays.push(milliseconds);
      queueMicrotask(callback);
      return ++timerId;
    },
    clearTimeout() {},
  },
  Uint8Array,
  Promise,
});

const source = fs.readFileSync(path.join(__dirname, "..", "dist", "app.js"), "utf8");
vm.runInContext(source, context, { filename: "app.js" });

function hex(value) {
  return Buffer.from(value).toString("hex").toUpperCase();
}

(async () => {
  await context.connectDevice();
  assert.equal(hex(writes.shift()), "A07000", "connection must query state");

  context.parseStatus(Uint8Array.from([1, 0, 74, 2, 129, 4, 98, 255, 0, 0, 1, 16]));
  getElement("colorInput").value = "#ff0000";
  getElement("colorValue").value = "128";

  await context.writeCurrentColor();
  assert.deepEqual(writes.splice(0).map(hex), ["A06301BE", "A06904FF000080"]);
  assert.ok(delays.includes(180), "dynamic-to-solid transition must include the settle interval");

  await context.writeCurrentColor();
  assert.deepEqual(writes.splice(0).map(hex), ["A06904FF000080"], "solid mode must not be reselected for every color");

  await context.applyEffect(75);
  await context.writeCurrentColor();
  assert.deepEqual(writes.splice(0).map(hex), ["A063014B", "A06301BE", "A06904FF000080"]);

  context.disconnectDevice();
  assert.equal(disconnectCalls, 1, "disconnect must close the browser GATT connection");
  assert.equal(device.gatt.connected, false, "the GATT connection must be released");
  assert.equal(getElement("connectionText").textContent, "Not connected");
  assert.equal(getElement("disconnectButton").disabled, true);
  assert.equal(characteristicListeners.has("characteristicvaluechanged"), false, "notification listener must be removed");
  assert.equal(deviceListeners.has("gattserverdisconnected"), false, "disconnect listener must be removed");

  process.stdout.write("app BLE transition and disconnect smoke test: OK\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
