# Dynamic Reminders Card

A Home Assistant Lovelace card to view, add, edit and delete dynamic reminders.
It uses the active Home Assistant theme so it matches the native cards in both
light and dark mode.

The card only manages the reminder data. It does not announce reminders or
handle nagging; your own automations do that.

## Installation

### HACS (custom repository)

1. In HACS, open the menu → **Custom repositories**, add
   `https://github.com/gsyates1/dynamic_reminders_card` with type **Dashboard**.
2. Install **Dynamic Reminders Card** and reload the browser.

### Manual

1. Copy `dynamic-reminders-card.js` to `<config>/www/dynamic-reminders-card.js`.
2. Go to **Settings → Dashboards → ⋮ → Resources** and add
   `/local/dynamic-reminders-card.js` as a **JavaScript module**.
3. Reload the browser.

## Configuration

Add the card from the dashboard card picker ("Dynamic Reminders Card"). The
first entity with a `reminders` attribute is picked for you, and the visual
editor's entity list only shows entities that have one (it falls back to all
sensors when none do). In YAML:

```yaml
type: custom:dynamic-reminders-card
entity: sensor.dynamic_reminders
title: Reminders   # optional
```

| Option   | Required | Description                                              |
| -------- | -------- | -------------------------------------------------------- |
| `entity` | yes      | Sensor whose `reminders` attribute holds the reminders.  |
| `title`  | no       | Header shown above the list.                             |

In a masonry view the list grows up to 400px tall and then scrolls. In a
sections view it fills the card's grid height.

## Data model

The sensor's `reminders` attribute is a dictionary keyed by the reminder's
`unique_id` (a GUID):

```python
{
  "3": {"reminder": "this is a test also", "next_trigger_time": "2026-10-20T08:57:25.000Z",
        "repeat_frequency": 30, "nag": False},
  "1": {"reminder": "this is a test", "next_trigger_time": "2026-10-20T14:35:00.000Z",
        "repeat_frequency": 0, "nag": True},
}
```

| Attribute           | Meaning                                                         |
| ------------------- | --------------------------------------------------------------- |
| `reminder`          | Reminder text                                                   |
| `next_trigger_time` | `YYYY-MM-DDTHH:MM:SS.000Z`. The trailing `Z` is read as UTC.    |
| `repeat_frequency`  | Repeat interval in days; `0` = one-time                         |
| `nag`               | `true` / `false`                                                |

`next_trigger_time` is shown in the browser's local time zone. When you save,
the date and time you pick (local time) are converted to UTC in the same
format. When you edit a reminder without changing its date or time, the
existing value is sent back unchanged.

## Events fired

| Action | Event type                | Event data                                                                   |
| ------ | ------------------------- | ---------------------------------------------------------------------------- |
| Add    | `add_dynamic_reminder`    | `unique_id` (new GUID), `reminder`, `next_trigger_time`, `repeat_frequency`, `nag` |
| Edit   | `update_dynamic_reminder` | `unique_id` plus all four fields (unchanged fields carry their existing value) |
| Delete | `delete_dynamic_reminder` | `unique_id`                                                                  |

`repeat_frequency` is sent as an integer (an empty "Repeat every" field sends
`0`) and `nag` as a boolean.

Events are fired through the Home Assistant WebSocket API (`fire_event`), which
**requires an administrator user**. For a non-admin user, the card shows an
error under the list and leaves the reminders as they were.

## Display

Each reminder takes two lines:

```
<reminder text>
<Today|Tomorrow|In N days> at <h:mm AM/PM>[, repeat every N days][, nag]
```

Past-due reminders are shown as `Yesterday` or `N days ago`, in the theme's
warning color. Reminders are sorted by next trigger time. Changes appear
straight away and are replaced by the sensor's data once the sensor updates.
If the sensor hasn't updated after 30 seconds, the list goes back to showing
what the sensor reports.
