# Self-hosting on Ubuntu

This is a completely static application. Bluetooth access happens on the
phone or computer running the browser, not inside the web-server container.
The container therefore does not need privileged mode, host networking, USB
access, or access to `/var/run/dbus`.

## Important: HTTPS is required

Web Bluetooth is available only in a secure browser context. `localhost` is a
special exception, but opening `http://192.168.x.x:8088` on a phone is not.
Serve the controller through HTTPS with a certificate trusted by the phone.

Good options are:

1. an existing public or private domain and your normal HTTPS reverse proxy;
2. a LAN hostname behind Caddy with `tls internal`, after installing Caddy's
   root certificate on the phone;
3. a VPN/private domain whose reverse proxy already provides a trusted
   certificate.

## Docker Compose

Copy this directory to the Ubuntu server, then run:

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
curl -I http://192.168.1.106:8088/
```

The default remains the safer loopback binding `127.0.0.1:8088`. The supplied
`.env.example` changes it to `192.168.1.106:8088`, matching a setup where an
Nginx Proxy Manager container reaches other services through the server's LAN
address. Change that IP if the server address changes. Keep port 80 and 443 for
NPM itself; the controller should use an unused host port such as 8088.

### Nginx Proxy Manager

Create a Proxy Host with:

- **Domain Names:** your controller hostname, for example `lamp.example.com`
- **Scheme:** `http`
- **Forward Hostname / IP:** `192.168.1.106`
- **Forward Port:** `8088`
- **Websockets Support:** not required
- **SSL:** request/select a valid certificate and enable **Force SSL**

NPM terminates HTTPS and forwards ordinary HTTP to the container. Web Bluetooth
cares about the HTTPS origin visible to the phone; the internal NPM-to-app hop
may remain HTTP.

If NPM reports a gateway error, first run `curl -I
http://192.168.1.106:8088/` on the server. Then test the same address from the
NPM container or verify that the host firewall accepts the Docker bridge. Since
your other Proxy Hosts already use this LAN-IP pattern, the same routing should
work here.

### Shared Docker network alternative

If preferred, attach this service and NPM to the same user-defined Docker
network and use `sp621e-controller` with port `80` as the Forward Hostname and
Port. In that arrangement, remove the `ports` section entirely. The LAN-IP
configuration above deliberately matches the existing setup described here.

## Plain static hosting

Docker is optional. Copy the contents of `dist/` into any HTTPS virtual host.
For a quick server-side check only:

```bash
python3 -m http.server 8088 --directory dist --bind 127.0.0.1
```

Keep the process behind the same HTTPS reverse proxy. Do not expose the Python
development server directly to the internet.

## Updating

Replace this directory with the new version and run:

```bash
docker compose up -d --build
```

The service worker may require one extra reload after an upgrade. If an old UI
persists, close the tab and reopen it.

## Future server-side Bluetooth mode

A later server-controlled version will be a separate architecture: an Ubuntu
service can use BlueZ (for example through Python `bleak`) and expose an
authenticated HTTP/WebSocket API to the browser. That service must enforce a
single BLE command queue, reconnect and state-query behavior, and strict
network authentication. The protocol files in the workspace are already
structured for reuse in that backend.
