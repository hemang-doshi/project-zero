# Zero Desktop

Electron + React + TypeScript cockpit for the local Project Zero runtime. The daemon remains authoritative; this app is a client.

## Development

Requires Node.js 22+ and npm. From this directory:

```sh
npm ci
npm run dev
```

The app expects a compatible local runtime at `~/Library/Application Support/ProjectZero/zero.sock` on macOS. Start the runtime separately and use isolated development data.

## Checks and builds

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

`npm run build` creates an unsigned development bundle. Release signing/notarization requires owner-managed Apple credentials and is not configured in public CI. The Electron package version (`package.json`) is managed separately from the runtime manifest.
