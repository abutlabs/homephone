// Product metadata for `pad` (polkadot-app-deploy). Published as dotNS text
// records on homephone.dot when we deploy. See packages/product/README.md.
export default {
  domain: "homephone.dot",
  displayName: "Homephone",
  description: "A homephone for the internet age: a classic phone that rings the whole house.",
  icon: { path: "./icon.png", format: "png" },
  executables: [{ kind: "app", path: "./site", appVersion: [0, 1, 0] }],
};
