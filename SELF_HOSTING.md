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
docker compose up -d --build
docker compose ps
curl -I http://127.0.0.1:8088/
```

The Compose file binds only to the server's loopback interface. Put an HTTPS
reverse proxy in front of `http://127.0.0.1:8088`.

Example Caddy site using an ordinary trusted certificate:

```caddyfile
lamp.example.com {
    reverse_proxy 127.0.0.1:8088
}
```

LAN-only Caddy example:

```caddyfile
lamp.home.arpa {
    tls internal
    reverse_proxy 127.0.0.1:8088
}
```

For the LAN-only form, export Caddy's local root CA and install it as a trusted
CA on every phone or computer that will use the controller. Merely clicking
through an invalid-certificate warning is not sufficient for Web Bluetooth.

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
