# RoomSun SP621E Controller

A buildless Web Bluetooth prototype for the BanlanX SP621E. The deployed Site
is private. BLE communication happens directly between the browser and the
controller; the Site has no backend or telemetry.

## Supported

- connect/disconnect and status query;
- power on/off;
- static RGB plus the controller's separate value byte;
- explicit dynamic-to-solid transition with a controller settle interval;
- selectable effect IDs 1 through 142, with verified shortcuts for Red Stars
  (74) and Green Stars (75);
- effect speed;
- experimental effect length from 1 through 150;
- notification reassembly and a local packet log.

The main connection button uses a broad browser chooser because the tested
SP621E was not found by Chrome's advertised-service filter. `FFE0` is still
declared as an optional service so the page can access it after selection.

See `SELF_HOSTING.md` for Ubuntu/Docker and Nginx Proxy Manager deployment. See the workspace-level
`protocol/` directory and `docs/protocol-notes.md` for the platform-neutral
protocol record and evidence labels.

Overview of the UI (note how it is simpler than BanlanX's one... :)
<img width="767" height="981" alt="image" src="https://github.com/user-attachments/assets/93f32fb7-d4e8-42ac-a8a2-e6298f6085a8" />