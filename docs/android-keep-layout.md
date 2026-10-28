# Android Keep layout

The Android overview and editor now share one layout across Light, Dark, OLED,
E-Ink and Doodle (and the system/dynamic-color options). Theme choice changes
colors, ink and surfaces, rather than moving tools around.

- One search capsule contains navigation, search, grid/list and account options.
  Search exposes type/color/person filters; active extra filters have a reset action.
- Phones show two masonry columns. List mode shows the same full note cards in one
  column, including images, checklists and labels. Cards have quiet outlines.
- The create menu offers text, list, image, drawing and audio capture. A stationary
  long press selects a note; dragging retains manual reordering. Selection offers
  pin, labels, archive, delete and an overflow for move/share/duplicate.
- The editor has Back, pin, reminder and archive above the note. Add, color/background,
  formatting and More sit below it. The title, body and attachments scroll together;
  the toolbar follows the keyboard. Existing labels/reminders appear as chips.
  Label entry, formatting and extras open only when requested.
- Back keeps the existing save-on-close/draft behavior. Archive first saves content
  and then toggles archive on the persisted id. A failed archive retains that id so
  retrying cannot create the note twice. Ordinary edits preserve archived state.

Reference: [Google's Android capture/edit instructions](https://support.google.com/keep/answer/2888246?co=GENIE.Platform%3DAndroid&hl=en)
and [official app views](https://play.google.com/store/apps/details?id=com.google.android.keep).
No Google branding or proprietary graphic assets are included in the application.

`KeepLayoutRenderTest` exercises the production Compose screens with synthetic
state under Robolectric's Android/native graphics implementation. It writes PNGs
into `app/build/keep-layout/` while checking layout and tool callbacks. JVM rendering
covers themes and narrow/large-text layouts; it does not validate a physical
keyboard, system IME/insets, camera/audio permissions, device scrolling or frame timing.
Build/install/device checks use the Android Builder MCP.

Motion stays with the existing card press feedback, navigation transitions and
Material menu/sheet transitions. No new decorative animation or custom transition
framework is introduced; the main change is the static hierarchy and usable space.

Validated with Android Builder: 374 tests, zero failures/errors/skips, and 27
rendered frames. Screens cover the five themes, 390dp and 320dp widths, 1.3× text,
full-card list mode, search, editor tools, checklists, More and label sheets.
The selected physical device `192.168.1.131:35023` remains unavailable (connect:
`No route to host`; install: device not found). APK versionCode 34 is a debug build;
no physical installation or on-device screen/IME/performance result is claimed.
