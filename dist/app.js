"use strict";

const SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
const CHARACTERISTIC_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";
const EFFECTS = { 74: "Red Stars", 75: "Green Stars", 190: "Solid Color" };
const CHIP_ORDERS = ["RGB", "RBG", "GRB", "GBR", "BRG", "BGR"];

const elements = Object.fromEntries(
  [
    "connectionDot", "connectionText", "connectButton", "broadScanButton", "disconnectButton", "powerButton",
    "powerLabel", "refreshButton", "heroTitle", "heroCopy", "statusEffect",
    "statusBrightness", "statusSpeed", "statusOrder", "colorInput", "colorHex",
    "colorValue", "colorValueOutput", "colorPreview", "effectSelect", "speedInput",
    "speedOutput", "compatibilityMessage", "packetLog", "clearLogButton", "toast"
  ].map((id) => [id, document.getElementById(id)])
);

let bluetoothDevice = null;
let characteristic = null;
let connected = false;
let knownPower = null;
let currentEffect = null;
let writeQueue = Promise.resolve();
let pendingMessage = null;
let colorWriteTimer = null;
let speedWriteTimer = null;

function hex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(" ").toUpperCase();
}

function logPacket(direction, bytes, label = "") {
  const item = document.createElement("li");
  item.className = direction.toLowerCase();
  const time = new Date().toLocaleTimeString();
  item.textContent = `${time}  ${direction.padEnd(5)} ${hex(bytes)}${label ? `  · ${label}` : ""}`;
  elements.packetLog.prepend(item);
  while (elements.packetLog.children.length > 80) elements.packetLog.lastElementChild.remove();
}

function logError(error) {
  const item = document.createElement("li");
  item.className = "error";
  item.textContent = `${new Date().toLocaleTimeString()}  ERROR ${error.message || error}`;
  elements.packetLog.prepend(item);
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function command(opcode, payload = []) {
  return Uint8Array.of(0xA0, opcode, payload.length, ...payload);
}

function controlsEnabled(value) {
  [elements.powerButton, elements.refreshButton, elements.colorInput, elements.colorValue,
    elements.effectSelect, elements.speedInput].forEach((element) => { element.disabled = !value; });
  document.querySelectorAll(".swatch").forEach((element) => { element.disabled = !value; });
  elements.disconnectButton.disabled = !value;
}

function setConnectionState(state, detail = "") {
  connected = state === "connected";
  elements.connectionDot.className = `status-dot ${state}`;
  elements.connectionText.textContent = state === "connected" ? "Connected" : state === "connecting" ? "Connecting…" : "Not connected";
  elements.connectButton.disabled = state === "connecting" || connected;
  elements.broadScanButton.disabled = state === "connecting" || connected;
  controlsEnabled(connected);
  elements.heroTitle.textContent = connected ? "Lamp is within reach." : state === "connecting" ? "Opening Bluetooth…" : "Ready when you are.";
  elements.heroCopy.textContent = detail || (connected
    ? "Commands go directly from this browser to the SP621E."
    : "Choose your SP621E from Android Chrome’s Bluetooth picker. BanlanX must be closed.");
}

async function connectDevice(acceptAll = false) {
  if (!navigator.bluetooth) {
    toast("Web Bluetooth is not available in this browser.");
    return;
  }
  setConnectionState("connecting");
  try {
    const options = acceptAll
      ? { acceptAllDevices: true, optionalServices: [SERVICE_UUID] }
      : { filters: [{ services: [SERVICE_UUID] }] };
    bluetoothDevice = await navigator.bluetooth.requestDevice(options);
    bluetoothDevice.addEventListener("gattserverdisconnected", onDisconnected);
    const server = await bluetoothDevice.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    characteristic.addEventListener("characteristicvaluechanged", onNotification);
    if (characteristic.properties.notify) await characteristic.startNotifications();
    setConnectionState("connected", `Connected to ${bluetoothDevice.name || "SP621E"}.`);
    await write(command(0x70), "query state");
  } catch (error) {
    logError(error);
    setConnectionState("disconnected", error.name === "NotFoundError" ? "No device selected." : error.message);
  }
}

function disconnectDevice() {
  if (bluetoothDevice?.gatt?.connected) bluetoothDevice.gatt.disconnect();
  onDisconnected();
}

function onDisconnected() {
  characteristic = null;
  currentEffect = null;
  knownPower = null;
  setConnectionState("disconnected", "Disconnected. Reconnect when the lamp is free.");
}

function write(bytes, label = "") {
  const operation = writeQueue.then(async () => {
    if (!characteristic || !bluetoothDevice?.gatt?.connected) throw new Error("Lamp is not connected");
    logPacket("TX", bytes, label);
    if (typeof characteristic.writeValueWithoutResponse === "function") {
      await characteristic.writeValueWithoutResponse(bytes);
    } else {
      await characteristic.writeValue(bytes);
    }
    return true;
  });
  writeQueue = operation.catch(() => undefined);
  return operation.catch((error) => {
    logError(error);
    toast(error.message || "Bluetooth write failed");
    return false;
  });
}

function onNotification(event) {
  try {
    const value = new Uint8Array(event.target.value.buffer, event.target.value.byteOffset, event.target.value.byteLength);
    logPacket("RX", value, "notification");
    const payload = assembleNotification(value);
    if (payload) parseStatus(payload);
  } catch (error) {
    pendingMessage = null;
    logError(error);
    toast("Could not decode the controller status");
  }
}

function assembleNotification(packet) {
  if (packet.length <= 5 || packet[0] !== 0x53 || packet[1] !== 0x43) return packet;
  const packetNumber = packet[2];
  const messageLength = packet[3];
  const fragmentLength = packet[4];
  const fragment = packet.slice(5);
  if (fragment.length !== fragmentLength) throw new Error("Malformed notification fragment");
  if (packetNumber === 1) pendingMessage = { messageLength, nextPacket: 2, bytes: Array.from(fragment) };
  else if (pendingMessage && packetNumber === pendingMessage.nextPacket && messageLength === pendingMessage.messageLength) {
    pendingMessage.bytes.push(...fragment);
    pendingMessage.nextPacket += 1;
  } else {
    pendingMessage = null;
    throw new Error("Notification fragments arrived out of sequence");
  }
  if (pendingMessage.bytes.length < pendingMessage.messageLength) return null;
  const result = Uint8Array.from(pendingMessage.bytes.slice(0, pendingMessage.messageLength));
  pendingMessage = null;
  return result;
}

function parseStatus(data) {
  if (data.length < 12) return;
  knownPower = data[0] === 1;
  const effect = data[2];
  currentEffect = effect;
  elements.powerLabel.textContent = knownPower ? "On" : "Off";
  elements.powerButton.classList.toggle("on", knownPower);
  elements.powerButton.setAttribute("aria-pressed", String(knownPower));
  elements.statusEffect.textContent = EFFECTS[effect] ? `${EFFECTS[effect]} · ${effect}` : String(effect);
  elements.statusBrightness.textContent = String(data[4]);
  elements.statusSpeed.textContent = String(data[5]);
  elements.statusOrder.textContent = CHIP_ORDERS[data[3]] || String(data[3]);
  if (effect === 74 || effect === 75) {
    elements.effectSelect.value = String(effect);
    elements.speedInput.value = String(data[5]);
    elements.speedOutput.value = String(data[5]);
  }
  elements.colorInput.value = rgbToHex(data[7], data[8], data[9]);
  elements.colorHex.value = elements.colorInput.value.toUpperCase();
  elements.colorValue.value = String(data[4]);
  elements.colorValueOutput.value = String(data[4]);
  updateColorPreview();
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function colorBytes() {
  const raw = elements.colorInput.value.slice(1);
  return [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16));
}

function renderedColor() {
  const level = Number(elements.colorValue.value);
  return colorBytes().map((component) => Math.floor((component * level + 127) / 255));
}

function updateColorPreview() {
  elements.colorHex.value = elements.colorInput.value.toUpperCase();
  elements.colorValueOutput.value = elements.colorValue.value;
  elements.colorPreview.style.background = rgbToHex(...renderedColor());
}

function scheduleColorWrite() {
  updateColorPreview();
  window.clearTimeout(colorWriteTimer);
  colorWriteTimer = window.setTimeout(async () => {
    const rgb = colorBytes();
    const level = Number(elements.colorValue.value);
    if (currentEffect !== 0xBE) {
      if (!await write(command(0x63, [0xBE]), "solid color mode")) return;
      currentEffect = 0xBE;
    }
    await write(command(0x69, [...rgb, level]), `color ${rgbToHex(...renderedColor()).toUpperCase()}`);
  }, 90);
}

function scheduleSpeedWrite() {
  elements.speedOutput.value = elements.speedInput.value;
  window.clearTimeout(speedWriteTimer);
  speedWriteTimer = window.setTimeout(() => write(command(0x67, [Number(elements.speedInput.value)]), "effect speed"), 90);
}

elements.connectButton.addEventListener("click", () => connectDevice(false));
elements.broadScanButton.addEventListener("click", () => connectDevice(true));
elements.disconnectButton.addEventListener("click", disconnectDevice);
elements.refreshButton.addEventListener("click", () => write(command(0x70), "query state"));
elements.powerButton.addEventListener("click", async () => {
  const next = !knownPower;
  if (!await write(command(0x62, [next ? 1 : 0]), next ? "power on" : "power off")) return;
  knownPower = next;
  elements.powerLabel.textContent = next ? "On" : "Off";
  elements.powerButton.classList.toggle("on", next);
});
elements.colorInput.addEventListener("input", scheduleColorWrite);
elements.colorValue.addEventListener("input", scheduleColorWrite);
elements.effectSelect.addEventListener("change", async () => {
  const effect = Number(elements.effectSelect.value);
  if (await write(command(0x63, [effect]), elements.effectSelect.selectedOptions[0].textContent)) currentEffect = effect;
});
elements.speedInput.addEventListener("input", scheduleSpeedWrite);
elements.clearLogButton.addEventListener("click", () => { elements.packetLog.replaceChildren(); });

document.querySelectorAll(".swatch").forEach((swatch) => {
  swatch.addEventListener("click", () => {
    elements.colorInput.value = swatch.dataset.color;
    scheduleColorWrite();
  });
});

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".mode-tab").forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".control-panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== tab.dataset.panel));
  });
});

elements.compatibilityMessage.textContent = navigator.bluetooth
  ? "Web Bluetooth detected. Use Android Chrome and keep BanlanX closed while connected."
  : "Web Bluetooth was not detected. Open this site in Chrome on Android or a supported desktop browser.";
setConnectionState("disconnected");
updateColorPreview();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(logError);
