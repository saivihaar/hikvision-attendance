# Hikvision Terminal Password Reset — Quick Steps

Device: Hikvision DS-K1T320EFWX face terminal, IP `192.168.0.144`, on the office/home LAN.
Goal: reset the admin password so we can finish setting up attendance.

## What you need
- Your phone
- 5 minutes at the PC where the SADP tool is open (or ask to have it opened —
  it's at `C:\Program Files (x86)\SADP\SADP\SADPTool.exe`)

## Steps

1. **On your phone:** Install the **"Hik-Partner Pro"** app (App Store / Google Play,
   official Hikvision app). Open it and sign up / log in with any email you want —
   it does *not* need to match the device's old account.

2. **On the PC:** In the SADP window, find the device `192.168.0.144` in the list,
   click it once to select it.

3. **On the PC:** Click **"Forgot Password"** (bottom-right of the SADP window).

4. **On the PC:** In the popup that appears, click **"Generate QR Code"**. A QR code
   image will show on screen.

5. **On your phone, in Hik-Partner Pro:** Find the scan/reset option (usually a QR
   scan icon, sometimes under a "Tools" or "Device" menu) and scan the QR code on
   the PC screen.

6. **On your phone:** The app will show a verification code after scanning.

7. **On the PC:** Type that verification code into the SADP popup and click
   **Confirm**.

8. **On the PC:** SADP will say the password reset to a temporary value, then
   immediately ask you to set a **new admin password**. Type a new password of
   your choosing (needs a mix of upper/lower/number, 8+ characters) and confirm it.

9. **Done** — message back "reset done" (no need to share the password) so the
   rest of the setup can continue.

If any screen looks different from this description, take a screenshot and send
it back rather than guessing.
