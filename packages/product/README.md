# homephone.dot

The Homephone Product: what people open in the Polkadot App. For now it's a placeholder page that holds the name.

## Publish (devnet)

You need the Polkadot App **devnet build**, with a fresh test account (not your main one), and Node 24 with `pad`:

```sh
npm i -g @polkadot-community-foundation/polkadot-app-deploy@0.22.1
export DO_NOT_TRACK=1
pad login --env devnet                       # scan the QR with the Polkadot App
pad packages/product/site homephone.dot --env devnet --config packages/product/polkadot-app-deploy.config.mjs
```

`pad` registers the name and uploads the page using its built-in testnet worker, then transfers the name to your App account, so your phone signs nothing. The name costs a refundable 10 PAS deposit and never expires. The page is kept for about two weeks unless renewed.

Open it at `homephone.dot` in the App, or at <https://homephone.dev-dot.li>.
