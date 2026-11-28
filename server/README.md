# Server

The process stores room slots and relays frames. It does not step physics. It does not open an `RTCPeerConnection`.

## Dev HTTPS

Create `certs/dev.pem` and `certs/dev-key.pem` from the repo root before you start the server. Follow the macOS and Windows setup steps in the root [README](../README.md#quick-start--setup).

The QR host must be a name on that cert. If it is not, `GET /api/host` still returns the address. The screen shows `CERT // HOST NOT IN SAN`.

Start the server:

```sh
corepack pnpm --filter @server dev
```

The process listens on `0.0.0.0`. The port is the `PORT` value, or `8443` when `PORT` is unset. The process refuses to start when `certs/dev.pem` or `certs/dev-key.pem` is missing.

Open the host screen in a normal Chrome window. Incognito has no saved host token, so `/screen/` shows `HOST ACCESS MISSING — OPEN IN THE ORIGINAL BROWSER WINDOW` and the QR stays empty.

## Phone CA

`mkcert -install` trusts the host computer only. Follow the macOS, Windows, iPhone, and Android steps in the root [README](../README.md#4-install-certificate-on-phones-one-time) to install `rootCA.pem` on each phone.

## Tests

```sh
corepack pnpm --filter @server test
```

The tests bind port `0`. They do not read the cert files.
