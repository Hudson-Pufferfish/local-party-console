# Server

The process stores room slots and relays frames. It does not step physics. It does not open an `RTCPeerConnection`.

## Dev HTTPS

The host display may be an external monitor on the Kensington K33621NA dock. A TV is not required. The mkcert steps below are unchanged.

Install mkcert on the Mac. Then trust the local root on the Mac:

```sh
mkcert -install
```

`mkcert -install` on the Mac does not trust the phone. Install the same root on each phone. The copy-paste steps are below and in the root [README](../README.md#phone-trust).

Create the cert from the repo root. Replace `<lan-ip>` with the LAN IPv4 from `GET /api/host`:

```sh
mkcert -key-file certs/dev-key.pem -cert-file certs/dev.pem localhost 127.0.0.1 <lan-ip>
```

The QR host must be a name on that cert. If it is not, `/api/host` still returns the address. The screen shows `CERT // HOST NOT IN SAN`.

Start the server:

```sh
corepack pnpm --filter @server dev
```

The process listens on `0.0.0.0`. The port is the `PORT` value, or `8443` when `PORT` is unset. The process refuses to start when `certs/dev.pem` or `certs/dev-key.pem` is missing.

## Phone CA

On the Mac, find the file:

```sh
mkcert -CAROOT
```

The file in that folder is `rootCA.pem`. The phone and the Mac must be on the same Wi-Fi. Serve it:

```sh
cd "$(mkcert -CAROOT)" && python3 -m http.server 8080
```

On the phone, open `http://<lan-ip>:8080/rootCA.pem`. Use the LAN IP from the cert, not `localhost`. Press Ctrl+C in that terminal when the download has finished.

Open the host screen in a normal Chrome window. Incognito has no saved host token, so `/screen/` shows `HOST // TOKEN MISSING` and the QR stays empty.

### iPhone

1. Open the downloaded profile. If iOS only saves the file, go to Settings → General → VPN & Device Management and install the profile.
2. Go to Settings → General → About → Certificate Trust Settings. Turn on full trust for the mkcert root.

Chrome on iPhone uses that system trust. Full trust is required. Proceed on the certificate warning does not trust `wss`.

### Samsung and Android

On One UI: Settings → Security and privacy → More security settings → Encryption and credentials → Install a certificate → CA certificate.

Confirm the install warning and choose `rootCA.pem`.

Chrome and Samsung Internet are separate apps. Install the CA, then scan the QR in the app that has that trust. Proceed on the page does not trust `wss`.

## Tests

```sh
corepack pnpm --filter @server test
```

The tests bind port `0`. They do not read the cert files.
