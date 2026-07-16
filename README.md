# The Cozy Nook Landingpage

Statische Landingpage mit Cloudflare Pages Function fuer Newsletter-Anmeldungen.

## Newsletter API

Das Formular sendet an `/api/subscribe`. Die Cloudflare Function erledigt:

- Cloudflare Turnstile Server-Validierung
- Rate Limit: 10 Requests pro 15 Minuten pro IP
- Mailchimp Anmeldung mit Double Opt-In (`pending`)

## Cloudflare Setup

1. Turnstile Widget in Cloudflare erstellen.
   In `Hostname Management` alle Domains freigeben, auf denen die Seite laeuft,
   z.B. `landingpage-djv.pages.dev` und spaeter die produktive Custom Domain.
2. Den oeffentlichen Site Key in `index.html` ersetzen:

```html
data-sitekey="REPLACE_WITH_TURNSTILE_SITE_KEY"
```

3. KV Namespace fuer das Rate Limit erstellen und als Pages Binding verbinden:

```text
Binding name: SUBSCRIBE_RATE_LIMIT
```

4. In Cloudflare Pages unter `Settings > Variables and Secrets` setzen:

```text
TURNSTILE_SECRET_KEY      Secret
MAILCHIMP_API_KEY        Secret
MAILCHIMP_AUDIENCE_ID    Variable
MAILCHIMP_SERVER_PREFIX  Variable, optional wenn der API-Key auf "-us21" endet
MAILCHIMP_TAGS           Variable, optional, z.B. "Landing Page, Coming Soon"
```

`wrangler.example.toml` zeigt die passende KV-Binding-Struktur, falls du die Konfiguration ueber Wrangler pflegen willst.

## Mailchimp

Die Function nutzt die Mailchimp Marketing API 3.0. Neue oder erneut anmeldende Kontakte werden mit `status: "pending"` gesetzt, damit Mailchimp die Double-Opt-In-Mail verschickt. Bereits abonnierte oder noch nicht bestaetigte Kontakte werden als Erfolg behandelt, ohne den Status unnoetig zu veraendern.

## Lokale Entwicklung

Secrets nicht committen. Fuer lokale Tests mit Wrangler kannst du eine `.dev.vars` anlegen:

```text
TURNSTILE_SECRET_KEY=...
MAILCHIMP_API_KEY=...
MAILCHIMP_AUDIENCE_ID=...
MAILCHIMP_SERVER_PREFIX=us21
MAILCHIMP_TAGS=Landing Page
```
