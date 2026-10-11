# BCIS Desktop

Electron desktop client for the BCIS Subscription Billing and Collection System.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

Install dependencies and run desktop scripts from the repository root. Use `npm run dev:desktop` for the renderer/main development server and `npm run build --workspace=@bcis/desktop` for a desktop build. See the root README for environment setup and the complete workspace commands.

## Authentication

The login screen uses the existing API endpoints `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, and `POST /api/v1/auth/logout` at `http://127.0.0.1:3000`. The renderer invokes only these fixed operations through preload IPC; the Electron main process sends requests with `net.fetch` and `credentials: 'include'` using the default Electron session. This allows Chromium to retain and send the API's HttpOnly session cookie without exposing it to renderer code or persistent web storage. The API must be running locally for authentication to succeed.
