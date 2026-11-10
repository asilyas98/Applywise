# Offer Desk for iOS

The Offer Desk job-application app as a native iPhone app: application pipeline, career assistant chatbot, AI fit score, cover letters, resume tweaks and interview prep. The included Codemagic workflow builds and uploads to TestFlight from Windows. An App Store Connect API key, Apple signing assets, a registered app, and production service configuration are still required before the first signed upload.

| Piece | What it does |
|---|---|
| `index.html`, `src/` | The app UI (Vite). Runs on iPhone inside Capacitor, and also works as a website. |
| `ios/` | Native Xcode project (Capacitor 8, Swift Package Manager, no CocoaPods). |
| `netlify/functions/ai.mjs` | `/api/ai`. Checks the user's Supabase login, applies a daily limit, builds the prompt **on the server**, and streams Claude's answer back. |
| `netlify/functions/delete-account.mjs` | `/api/delete-account`. Apple requires in-app account deletion. |
| `supabase/schema.sql` | Tables plus Row Level Security, so each user sees only their own data. |
| `codemagic.yaml` | Builds the IPA and uploads it to TestFlight. |
| `privacy.html` | Privacy policy, served at `https://YOUR-SITE.netlify.app/privacy.html`. |

---

## 1. Supabase (new project)

1. Create a **new** Supabase project, e.g. `offer-desk`.
2. In **SQL Editor**, paste in `supabase/schema.sql` and run it.
3. Under **Authentication → Sign In / Providers → Email**, make sure Email is enabled. "Confirm email" can stay on: users confirm from their inbox, then sign in in the app.
4. Under **Authentication → Email Templates → Reset Password**, the app resets passwords with a code typed in the app, not a link. Replace the template body with something like:
   ```html
   <h2>Reset your Offer Desk password</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   ```
5. Under **Authentication → URL Configuration**, set **Site URL** to your Netlify site URL (step 2). Email-confirmation links land there.
6. Copy these from **Project Settings → API**: the Project URL, the `anon` public key and the `service_role` key. The service_role key is secret and goes only into Netlify.

## 2. Netlify (AI and account-deletion functions)

1. Push this folder to a GitHub repo and import it in Netlify. Drag-and-drop also works, but functions need either a Git deploy or `netlify deploy`.
2. Under **Site settings → Environment variables**, add:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your key from console.anthropic.com |
| `SUPABASE_SERVICE_ROLE_KEY` | The service_role key from step 1 |
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_API_BASE` | This site's URL, e.g. `https://offer-desk.netlify.app` (no trailing slash) |
| `AI_DAILY_LIMIT` | *(optional)* AI calls per user per day. Default `40`. |
| `ANTHROPIC_MODEL` | *(optional)* Default `claude-sonnet-5-5` |
| `ANTHROPIC_FAST_MODEL` | *(optional)* Used to fill in job details. Default `claude-haiku-5-5` |

3. Deploy. Open `https://YOUR-SITE.netlify.app`: the same app runs on the web, which makes testing easy. Sign up and try a fit score there before building for iOS.
4. Before launch, edit `privacy.html` and replace `[YOUR SUPPORT EMAIL]` with a monitored support address. Also provide a real support URL in App Store Connect.

**Cost control:** every AI request goes through your Anthropic key. The function only runs Offer Desk's own prompts (clients can't send arbitrary prompts), it requires a signed-in user, and it caps each user at `AI_DAILY_LIMIT` calls a day. You can watch spend in the Anthropic console.

## 3. App Store Connect

1. Go to **Certificates, IDs & Profiles → Identifiers** and register the App ID `com.simpleai.offerdesk`. To use a different ID, change it in `capacitor.config.json`, `codemagic.yaml` and `ios/App/App.xcodeproj/project.pbxproj`.
2. In **App Store Connect → Apps → +**, create the app named "Offer Desk" (or another name if that one is taken), with the bundle ID above and SimpleAI LLC as the seller.
3. Copy the app's **Apple ID** (a number, under App Information) into `APP_STORE_APPLE_ID` in `codemagic.yaml`.

## 4. Build on Codemagic

1. In **Codemagic → Teams → Integrations → Developer Portal**, add an App Store Connect API key (App Store Connect → Users and Access → Integrations → Keys, with the App Manager role). Name it `SimpleAI ASC Key`, or change `integrations.app_store_connect` in `codemagic.yaml` to match the name you use.
2. Under **Code signing identities → iOS certificates**, generate or upload an Apple Distribution certificate. Codemagic fetches the provisioning profile automatically through `ios_signing`.
3. Add the repo as a Codemagic app and choose **codemagic.yaml** as the configuration.
4. Under **Environment variables**, create a group called `offer_desk` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE` and `APP_STORE_APPLE_ID`. Use the same Supabase and API values as in Netlify. `APP_STORE_APPLE_ID` is the numeric Apple ID shown in App Store Connect → App Information (not the bundle ID).
5. Confirm the signing certificate/profile is available to Codemagic and that all values above are real. Start the `ios-testflight` workflow, or push to `main`. It checks its required configuration, builds the web app, syncs it into `ios/`, bumps the build number, signs the app and uploads it to TestFlight.

### Release status

- The source includes the native iOS project, app icon, privacy and account-deletion flows, and TestFlight automation.
- The AI assistant is available from the desktop navigation and iPhone tab bar. It uses the signed-in user's profile and saved job summaries, requires AI consent, and does not save chat messages to the account.
- The source is not a signed IPA. Codemagic produces that after Apple Developer signing, App Store Connect setup, and environment configuration are complete.
- Before App Review, finish the support email and URL, App Privacy answers, screenshots, age rating, description/keywords, and reviewer test account. Apple reviews the submitted binary and metadata; this project cannot guarantee approval.

## 5. App Store review checklist

Already handled in the app:
- **Account deletion** (Guideline 5.1.1(v)): Account → Delete my account.
- **Third-party AI disclosure and consent** (Guideline 5.1.2(i)): users must tap Allow before any data goes to Claude, and they can turn it off in Account.
- **Privacy policy:** linked on the sign-in screen and in Account.
- **Encryption export:** `ITSAppUsesNonExemptEncryption = false` is set, so there's no compliance prompt.
- **iPhone only, portrait.** You only need iPhone screenshots.

You fill in yourself:
- **App Privacy** questionnaire. Data collected and linked to the user: Contact Info → Email; User Content → Other User Content (resume, notes, letters). Used for App Functionality. Not used for tracking.
- **Review notes:** give the reviewer a test account with email and password, and mention that AI results take 10–30 seconds.
- **Screenshots** at 6.9" (1320×2868 or 1290×2796). Run the website in Chrome DevTools at iPhone size, or take them from a TestFlight install.
- **Support URL:** your Netlify site works.

## Local development

```bash
npm install
cp .env.example .env      # then fill it in
npm run dev               # web version at http://localhost:5173
```
`npm run dev` doesn't run the Netlify functions. Use `npx netlify dev` to run the site and the functions together.

After changing the app icon (`assets/icon-only.png`) or splash images, run `npm run assets`, then commit `ios/`.
