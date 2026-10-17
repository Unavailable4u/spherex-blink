# Shared flags with Firestore (about 10 minutes, free tier)

Without this, flags are saved in each visitor's own browser and the Flag panel says "saved in this browser only". That is honest and works offline.
For a real crowd-sourced demo, connect a free Firestore database:

1. <https://console.firebase.google.com> -> **Add project** (turn Analytics off).
2. **Build -> Firestore Database -> Create database**, production mode, any region.
3. **Rules** tab: paste the contents of `firebase/firestore.rules` and **Publish**. These rules let anyone read flags and add one, forbid edits and deletes,
   and type-check and size-limit every field, so the collection cannot be vandalised or filled with junk.
4. **Project settings (gear) -> General -> Your apps -> Web (`</>`)**: register an app, copy `projectId` and `apiKey`.
5. Put them in `web/js/config.js`:

   ```js
   window.FLAG_CONFIG = { projectId: "your-project-id", apiKey: "AIza..." };
   ```

   A Firebase web API key is not a secret (it only identifies the project); the security rules are what protect the data.
6. Push. The panel now reads **shared with everyone**, flags from other people appear as teal pins and your own as vermilion, and a flag's
   mover-check verdict is stored with it so reviewers can sort real candidates from stars.

Test it: open the site in two browsers, flag something in one, reload the other. If the pill says **offline, saved here**, the rules or keys are wrong:
open the browser console and look at the failed request to `firestore.googleapis.com`.

Exports (CSV / JSON in the Flag panel) include region, frame, band, epoch, RA, Dec, category, verdict, note and time, which is what you would send on to a
follow-up (for example the Minor Planet Center for asteroid candidates).
