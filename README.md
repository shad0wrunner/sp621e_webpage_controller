# RoomSun SP621E Controller

A buildless Web Bluetooth prototype for the BanlanX SP621E. The deployed Site
is private. BLE communication happens directly between the browser and the
controller; the Site has no backend or telemetry.

## Supported in the first prototype

- connect/disconnect and status query;
- power on/off;
- static RGB plus the controller's separate value byte;
- verified Red Stars and Green Stars effects;
- effect speed;
- notification reassembly and a local packet log.

Only commands verified against the owner's hardware are enabled. See the
workspace-level `protocol/` directory and `docs/protocol-notes.md` for the
platform-neutral protocol record.

