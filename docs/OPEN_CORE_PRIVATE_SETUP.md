# SnapAway Open Core: Private Provider Local Setup

This project supports an optional local premium provider kept outside the public repository.

## Location

Create one of the files below on your local machine (do not commit):

- private/premium-provider.js
- private/snapaway-premium-provider.js

## Contract

The module must export a function named getCapabilities.

Example:

```js
module.exports = {
  getCapabilities(context = {}) {
    return {
      mode: 'official',
      license: {
        available: true,
        reason: 'private-license-provider-loaded'
      },
      billing: {
        available: true,
        reason: context.isStoreInstall ? 'store-billing-enabled' : 'web-billing-enabled',
        isStoreInstall: !!context.isStoreInstall
      },
      telemetry: {
        available: true,
        reason: 'private-telemetry-provider-loaded'
      },
      diagnostics: {
        environment: process.env.NODE_ENV || 'development'
      }
    };
  }
};
```

## Context Input

The main process may provide the following values to getCapabilities(context):

- iapAvailable: boolean
- isStoreInstall: boolean
- storeContext: object
- isPro: boolean

## Fallback behavior

If no private provider exists, SnapAway runs in community mode:

- mode: community
- license.available: false
- billing.available: true only when native IAP is available
- telemetry.available: true through public telemetry module

## Validation

Use these IPC endpoints to verify runtime state in UI/devtools:

- get-iap-status
- get-pro-status
- get-premium-capabilities

get-iap-status and get-pro-status include premiumCapabilities in payloads, and get-premium-capabilities returns the capability snapshot directly.

## Community gate

Use these commands before publishing changes:

- npm run verify:open-core
- npm run verify:community

The repository also runs Community Mode Gate on GitHub Actions via .github/workflows/community-mode.yml.

Manual smoke checklist:

- docs/COMMUNITY_SMOKE_CHECKLIST.md

## IAP smoke checks

Quick local smoke (without native rebuild):

- npm run test:iap:quick

Expected behavior in this script context:

- getProducts, getLicenseInfo and checkOwnership should return structured results.
- requestPurchase may return a UI-thread error because the test runs without a purchase dialog window handle; this is treated as expected for smoke diagnostics.
