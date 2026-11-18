# Set up LiveKit Cloud (free)

LiveKit carries the call audio. Its cloud service has a free tier of about 5,000 participant-minutes a month: a 10-minute call between two devices uses 20. That's plenty for testing a few phones.

You only need this when a real Pi joins, or for calls between homes. The Docker laptop test runs its own LiveKit and needs no account.

1. Go to <https://cloud.livekit.io> and sign up (GitHub or Google sign-in works).
2. Create a project. Name it anything, for example `hearthline`.
3. Open **Settings → API keys** and create a key. You see three values:
   * **WebSocket URL**, like `wss://hearthline-abc123.livekit.cloud`
   * **API key**, like `APIxxxxxxxx`
   * **API secret**: a long random string. It's shown once, so copy it now.
4. In your copy of this repo, run `cp .env.example .env` and fill in:
   ```
   LIVEKIT_URL=wss://hearthline-abc123.livekit.cloud
   LIVEKIT_API_KEY=APIxxxxxxxx
   LIVEKIT_API_SECRET=...
   ```
5. Start the ringing server on your laptop:
   ```sh
   python -m venv .venv && . .venv/bin/activate
   pip install -e ".[server]"
   set -a; . ./.env; set +a
   hearthline-server run
   ```
   It prints a link like `http://localhost:8080/?key=…&household=laptop`. Open it and click **Start test phone**.

Keep the secret safe:

* `.env` is in `.gitignore`. Never commit it, paste it in chat, or put it on the Pi. The Pi only ever gets a short-lived token for one call.
* If it leaks, delete the key in LiveKit Cloud and create a new one.

Usage is on the LiveKit Cloud dashboard. If the free tier runs out, the options are a paid plan or self-hosting LiveKit (about €5–10 a month on a small server); see [ROADMAP.md](../ROADMAP.md).
