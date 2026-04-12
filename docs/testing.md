# Manual Testing Checklist — AutoScore Live

Run these tests after a fresh deploy or before a show. Open the app at
**https://calvaryagkc.app** in a modern browser with devtools available.

---

## 1. Infrastructure

- [ ] `https://calvaryagkc.app` loads without certificate warnings
- [ ] `http://calvaryagkc.app` redirects to `https://calvaryagkc.app`
- [ ] `https://www.calvaryagkc.app` redirects to `https://calvaryagkc.app`
- [ ] `http://www.calvaryagkc.app` redirects to `https://calvaryagkc.app`
- [ ] `GET /api/health` returns `{"ok":true,...}` with status 200
- [ ] Browser devtools → Network → no `X-Powered-By` response header
- [ ] Browser devtools → Network → `Server` header does not reveal nginx version

---

## 2. Home Page

- [ ] Background car image loads
- [ ] "Go to Admin" button navigates to `/admin` (shows login form, not dashboard)
- [ ] "Go to Judging" button navigates to `/judge`

---

## 3. Admin Login

- [ ] Correct username + password grants access to the dashboard
- [ ] Wrong password shows "Invalid username or password" error
- [ ] Wrong username shows the same error (no username enumeration)
- [ ] Submitting empty form is blocked by required field validation
- [ ] After login, refreshing the page stays logged in (sessionStorage token)
- [ ] "Sign out" button returns to the login form and clears the session
- [ ] After sign out, pressing browser Back does not restore the dashboard

---

## 4. Admin — Events Tab

- [ ] Existing events are listed with correct name and date
- [ ] Dates display correctly (e.g. "November 25th, 2025" — not a day early)
- [ ] "Add Event" dialog opens, fills, and submits — new event appears in list
- [ ] "Set as Current" marks the selected event and unmarks the previous current
- [ ] "Delete" shows a confirmation dialog before deleting
- [ ] Deleting an event removes it from the list and the event selector
- [ ] Event selector in the header updates when events are added/deleted

---

## 5. Admin — Cars Tab

- [ ] Cars for the selected event load and are sorted by registration ID
- [ ] Search box filters by reg ID, make, model, year, owner, and color
- [ ] "Add Car" dialog opens, fills, and submits — new car appears in the list
- [ ] "Edit Car" (pencil icon) pre-fills the form with the car's current data
- [ ] Editing and saving a car updates the row immediately
- [ ] Deleting a car removes it from the list
- [ ] Adding a car with a duplicate registration ID shows a "Duplicate" error
- [ ] **Export CSV**: clicking "Export CSV" downloads a `.csv` with correct columns (Reg ID, Owner Info, Make, Model, Year, Color)
- [ ] **Import CSV**: uploading the exported file to a different event imports all cars with a success toast
- [ ] Importing a CSV with a duplicate reg ID reports the conflict without stopping the rest

---

## 6. Admin — Judges Tab

- [ ] Judges for the selected event load correctly
- [ ] "Add Judge" fills name, email, password — judge appears in list
- [ ] "Edit Judge" updates name/email; password field left blank leaves existing password unchanged
- [ ] Deleting a judge removes them from the list

---

## 7. Admin — Overview Tab

- [ ] Each car row shows correct `X / Y Scored` progress
- [ ] "Completed" badge appears once all judges have scored a car
- [ ] "Pending" badge shows for partially or unscored cars
- [ ] Clicking a row opens a detail dialog showing each judge's score and notes
- [ ] "Show only uncompleted cars" switch filters the list correctly
- [ ] "Export to CSV" downloads a file with reg ID, owner, make, model, year, color, total score, and one column per judge

---

## 8. Admin — Leaderboard Tab

- [ ] Only fully scored cars appear by default
- [ ] Ranks are assigned correctly (highest total score = rank 1)
- [ ] Tied cars share the same rank number
- [ ] "Show partial" toggle reveals partially scored cars — they appear dimmed with a `2/5` style judge badge and no rank number
- [ ] Switching events updates the leaderboard
- [ ] "Export to CSV" downloads rank, reg ID, owner, make, model, year, total score
- [ ] Dates in the subtitle display correctly (not a day early)

---

## 9. Judge App

- [ ] Page loads and auto-selects the current event
- [ ] Event selector allows switching to a different event
- [ ] Judge selector lists all judges for the selected event
- [ ] Selecting a judge opens the password dialog
- [ ] Wrong password shows an error and keeps the dialog open
- [ ] Correct password logs in and shows the car grid
- [ ] Each car card shows make, model, year, registration ID
- [ ] "Score Car" button opens the scoring sheet (slider 0–10, notes field)
- [ ] Saving a score closes the sheet and the card updates to show "Edit Score"
- [ ] "Edit Score" re-opens the sheet with the previously saved values
- [ ] "Show unscored only" switch hides already-scored cars
- [ ] Search box filters by reg ID, make, and model
- [ ] "Log Out" returns to the judge/event selector

---

## 10. Real-Time Sync

Run these with two browser windows open simultaneously.

- [ ] **Score → Overview**: score a car in the Judge App → the Overview tab in Admin reflects the updated progress count without a page refresh
- [ ] **Add car → Judge**: add a car in Admin → the new car appears in the Judge App car grid without a refresh
- [ ] **Add judge → Judge**: add a judge in Admin → the judge appears in the Judge App selector without a refresh
- [ ] **Set current event**: change the current event in Admin → the Judge App auto-selects the new current event on next load

---

## 11. Backup Health Endpoint

```bash
# Should return 401
curl "https://calvaryagkc.app/api/health/backup?secret=wrongsecret"

# Should return {"ok":true,...} if a backup ran in the last 25 hours
curl "https://calvaryagkc.app/api/health/backup?secret=YOUR_HEALTH_SECRET"
```

- [ ] Wrong secret returns 401
- [ ] Correct secret returns `{"ok":true}` with `lastBackup` and `ageHours` fields
- [ ] `ageHours` is less than 25 (meaning the most recent backup is current)

---

## 12. Manual Backup

```bash
bash /home/ubuntu/autoscore/backup.sh
```

- [ ] Script runs without errors
- [ ] Ends with `Done. s3://ywa-db-backups/autoscore/backups/autoscore_TIMESTAMP.sql.gz`
- [ ] File is visible in S3: `aws s3 ls s3://ywa-db-backups/autoscore/backups/`

---

## 13. Auto-Deploy (Webhook)

- [ ] Push a trivial commit to `main` (e.g. add a blank line to README)
- [ ] `tail -f /home/ubuntu/.pm2/logs/deploy.log` shows the deploy running
- [ ] Deploy log ends with `=== Deploy complete ===`
- [ ] App is still reachable after deploy completes

---

## Pre-Show Day Checklist

Quick pass before running an event:

- [ ] SSL cert is valid and not expiring soon: `sudo certbot certificates`
- [ ] App is running: `pm2 status` → autoscore should show `online`
- [ ] Database is reachable: `curl http://localhost:3000/api/health`
- [ ] Most recent backup is current: check `/api/health/backup` endpoint
- [ ] Correct event is marked as current in the Events tab
- [ ] All cars are entered for the event
- [ ] All judges are entered with passwords they know
- [ ] Test a judge login end-to-end with a real device (phone)
