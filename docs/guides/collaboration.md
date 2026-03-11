# Collaboration

Share maps, invite collaborators, and discuss with comment threads.

## Quick Reference

| Role | View | Comment | Edit | Manage |
|------|------|---------|------|--------|
| Viewer | Yes | No | No | No |
| Commenter | Yes | Yes | No | No |
| Editor | Yes | Yes | Yes | No |
| Owner | Yes | Yes | Yes | Yes |

Owner is not a role — it's determined by who created the map. Owners can do everything editors can, plus manage collaborators and delete the map.

## Inviting Collaborators

1. Open the **Collaborators** panel (toolbar icon)
2. Enter the user's email and select a role (viewer, commenter, or editor)
3. Click **Invite**

The invited user sees the map in their "Collaborating" section on the dashboard.

**Changing roles:** The owner can change any collaborator's role from the dropdown next to their name.

**Removing:** The owner can remove collaborators.

## Share Links

Share a read-only link with anyone, even without an account:

1. Click the **Share** icon in the toolbar
2. A public link is generated (e.g. `/share/abc123`)
3. Copy the link or the embed iframe snippet
4. Click "Remove link" to revoke access

Anyone with the link can view the map and leave comments (with a display name, no account needed).

## Embedding

The share dialog provides an HTML iframe snippet:

```html
<iframe src="https://your-domain/embed/abc123" width="800" height="600"></iframe>
```

The embed view shows only the map canvas and legend — no toolbar, layer panel, or side panels.

## Comments

Open the **Comments** panel (toolbar icon).

- **Create:** Type in the text area and click Post
- **Resolve:** Click the resolve button to mark a comment as handled (strikethrough)
- **Delete:** Authors can delete their own comments
- **Guest comments:** Anyone with a share link can comment by entering a display name

Comments are a flat list (not threaded). For threaded discussion, use annotations with replies.

## Activity Feed

Open the **Activity** panel (toolbar icon) to see a chronological log of actions:
- Map created, updated, cloned
- Viewport saved
- Layers imported
- Collaborators invited/removed
- Share links created/deleted

## API Keys

For programmatic access:

1. Go to your account settings
2. Create a new API key with a descriptive name
3. Copy the key immediately — it's shown only once
4. Use as a Bearer token: `Authorization: Bearer flk_...`

API keys have the same permissions as your user account.
