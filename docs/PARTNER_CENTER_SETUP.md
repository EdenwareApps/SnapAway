
# Microsoft Partner Center Setup - SnapAway

## Current Status

- [x] App registered in Partner Center.
- [x] IAP product `SnapAwayPro` created as Durable.
- [x] IAP listing content configured (EN/PT), pricing configured, and submission prepared.
- [x] IAP listing preenchido nos 10 idiomas da listagem do app (`hi` incluído, 26/10/2026).
- [x] Local build completed successfully (`npm run build`).
- [x] Project version set to `0.9.0` for first private app-parent submission.

## Release Strategy (Approved)

1. Submit app parent version `0.9.0` as private/non-public release.
2. After app parent is published, submit/publish IAP `SnapAwayPro`.
3. Submit app parent version `1.0.0` as public release with Store IAP enabled.
4. Keep Edenware license-key Pro flow as fallback (already working).

## Store name conflict (product name not available)

If you see â€œThe name is not availableâ€ when creating the product (Store listing name already reserved), you must:

- Choose a different product name (e.g., "SnapAway Pro", "SnapAway (Beta)", "SnapAway - Privacy")
- Or, if you believe the name is reserved for you, contact Microsoft at **reportapp@microsoft.com** to request release/claim of the name.

This is a common Store restriction: the store listing name must be unique across the entire Microsoft Store.

## Next Required Steps

- [ ] Complete Partner Center tax profile (required for paid products).
- [ ] Complete Partner Center payout profile (required for paid products).
- [ ] Publish app parent `0.9.0` (private/manual publish flow).
- [ ] After app parent publish, submit IAP `SnapAwayPro` to Store certification.
- [ ] Verify IAP purchase in sandbox with at least one test user.
- [ ] Update signing certificate thumbprint in `src/config/store-products.json` (if changed in Partner Center).
- [ ] Confirm manifest/publisher identity values are aligned with Partner Center before final public release.
- [ ] Submit app parent `1.0.0` for public launch.

## IAP Product Definition (Keep As-Is)

- Partner Center Product ID: `SnapAwayPro`
- Store ID: `9NNLVZPCLLTZ` (use this value in app StoreContext requests)
- Type: Durable
- Title: SnapAway Pro Lifetime
- Description: Lifetime access to all Pro features
- Markets: **240 mercados** (o plano original de BR/US/CA está obsoleto — o add-on já foi ampliado)
- Price: base **US$ 14,99** definida em 26/10/2026 (antes US$ 29,99 com promoção eterna de 60%). O
  preço por mercado foi preenchido junto na mesma rodada. As duas únicas vendas do histórico saíram
  a US$ 11,99 — a base de 29,99 nunca foi paga e criava um penhasco de +150% no fim da promoção.
- Listing: 10 idiomas (`en-us`, `hi`, `pt`, `ar`, `zh`, `fr`, `de`, `ja`, `ko`, `es`).
  O CSV é gerado por `docs/store-listing/optimize-addon-listing.py`
- Preço base (não promocional), definido em 26/10/2026: **US$ 14,99** no grupo Default (236
  mercados). Grupos com preço próprio:

  | Grupo | Moeda | Preço |
  |---|---|---|
  | Brazil (1) | BRL | R$ 24,95 |
  | India (1) | INR | ₹ 244 |
  | Nigeria (1) | NGN | ₦ 2.899 |
  | Philippines (1) | PHP | ₱ 145 |

  O fallback do modal Pro ([ProModal.svelte](../src/renderer/pro/ProModal.svelte), `fallbackStorePrice`)
  acompanha essa base; o valor exibido em cada mercado vem da Store via `getIapProducts`.
- Leitura da Store em 26/10/2026 (`storeedgefd` → products/`9NNLVZPCLLTZ`): app **gratuito** e uma
  promoção de **20%** agendada até **31/10/2026 23:59 UTC** (por isso o preço ao vivo pode aparecer
  abaixo da base).

## Notes

- Only the `SnapAwayPro` product is needed; do not add monthly/annual subscriptions.
- Store listing CSV import accepts only fields present in exported template.
- For `StoreLogo300x300`, use a valid asset reference accepted by Partner Center import.
- All customer-facing product descriptions should remain in English (PT listing can be included where required).

## Temporary alternative (tenant blocked / inactive)

If your current tenant is blocked/inactive and you need to continue publishing:

1. Create a new Azure AD tenant (Entra ID) using **contact@edenware.app** (or another account that works).
2. In the Partner Center, use **Sign in with Microsoft Entra ID** and log in with that account.
3. Publish the app parent (0.9.0) and configure payout/tax profiles under that tenant.
4. Once the original tenant is reactivated (or unblocked), you can migrate or re-create the app/IAP setup there.

This provides a working path forward while you fix the original tenant issue.

---

## Useful Info (saved for reference)

- Tenant (Directory) in use: **Default Directory (contactedenware.onmicrosoft.com)**
- Tenant ID: **a550751c-f9e0-4365-af65-6a932cf492e2**
- Primary user email: **contact@edenware.app**
- Partner Center account status: tenant active, can log in with Entra ID for this user.

## Useful URLs

- Partner Center dashboard: https://partner.microsoft.com/dashboard
- Partner Center app management: https://partner.microsoft.com/dashboard/account/v3/OfferManagement
- Partner Center payouts & tax: https://partner.microsoft.com/dashboard/account/v3/PaymentProfile
- Partner Center in-app products: https://partner.microsoft.com/dashboard/account/v3/OfferManagement/InAppProduct
- Store listing import/export docs: https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/import-and-export-store-listings
- App submission checklist (MS docs): https://learn.microsoft.com/windows/windows-app-certification

---
