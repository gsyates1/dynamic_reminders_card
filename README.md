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

## Requirements

The [Reminders integration](https://github.com/gsyates1/reminders_integration)
must be installed and set up. The card reads `sensor.dynamic_reminders` and
changes reminders through the integration's actions.

## Configuration

Add the card from the dashboard card picker ("Dynamic Reminders Card").
`sensor.dynamic_reminders` is picked for you, and the visual editor's entity
list only shows entities whose `reminders` attribute holds dynamic reminders
(it falls back to all sensors when none do). In YAML:

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

### Reminders disappear after leaving the page

New reminders show straight away, but the list then shows what the
configured entity reports. If they vanish after you leave and come back, the
card is pointed at an entity that isn't the integration's dynamic reminders
sensor. A common cause: the old template sensor wasn't deleted before the
integration was added, so the old `sensor.dynamic_reminders` is left as
"unavailable" and the integration's sensor became
`sensor.dynamic_reminders_2`. Either change the card's entity, or delete the
old entity and rename the new one (see the integration's install steps). The
card shows a warning under the list when its entity has no dynamic reminders
attribute.

## Data model

The sensor's `reminders` attribute is a dictionary keyed by the reminder ID,
which the integration generates:

```python
{
  "a3f9c21e": {"reminder": "Change the furnace filter",
               "next_trigger_time": "2026-12-01 09:00:00-05:00",
               "repeat_frequency": 30, "nag": False},
}
```

| Attribute           | Meaning                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `reminder`          | Reminder text                                                    |
| `next_trigger_time` | Date and time with a UTC offset, e.g. `2026-10-31 11:33:10.095534-04:00` |
| `repeat_frequency`  | Repeat interval in days; `0` = one-time                          |
| `nag`               | `true` / `false`                                                 |

`next_trigger_time` is shown in the browser's local time zone. When you save,
the date and time you pick are sent in the browser's local time with its UTC
offset (e.g. `2026-11-02 09:30:00-05:00`), so the stored time is the moment
you picked even if Home Assistant uses a different time zone.

## Actions called

| Card action | Integration action        | Data sent                                                        |
| ----------- | ------------------------- | ---------------------------------------------------------------- |
| Add         | `reminders.add_dynamic`   | `reminder`, `next_trigger_time`, `repeat_frequency`, `nag`        |
| Edit        | `reminders.update_dynamic`| `id` plus only the fields you changed (nothing is sent if none changed) |
| Delete      | `reminders.delete_dynamic`| `id`                                                             |

`repeat_frequency` is sent as an integer (an empty "Repeat every" field sends
`0`) and `nag` as a boolean. The new reminder's ID comes back in the
`add_dynamic` response. Until it arrives (normally a fraction of a second) the
new row's edit and delete buttons do nothing.

If the integration rejects a call (for example an unknown ID, or the
integration isn't loaded), the card shows its error message under the list and
leaves the reminders as they were. Unlike the old events, actions don't need an
administrator user.

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
