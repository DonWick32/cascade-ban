# Cascade Ban

*(Click the image below to play the demo video)*<br/>
[![Cascade Ban Demo](https://img.youtube.com/vi/L9yDxKsjcrI/maxresdefault.jpg)](https://www.youtube.com/watch?v=L9yDxKsjcrI)

> **Synchronize ban and unban decisions across a cluster of allied subreddits natively in Devvit.**

Cascade Ban is a powerful moderation tool designed for communities that work together. It allows a network of subreddits to seamlessly share bans and unbans, reducing the administrative burden on moderators while keeping bad actors out. 

It supports the existing ModMail command workflow, native Reddit ban/unban actions, and a custom-post dashboard for reviewing links and pending cascade requests from a unified UI.

---

## 📸 Screenshots & Workflow

### Full UI Dashboard
![Full UI](docs/full_ui.png)

### Mod Menu Integration
![Mod Menu Action](docs/mod_menu_cascade_ban.png)

### Dashboard Access Point
![Dashboard Access Point](docs/dashboard_access_point.jpg)

### Subreddit Links Management
![Subreddit Links](docs/subreddit_links.jpg)

### Mod Note Integration
![Mod Note Example](docs/mod_note_example.png)

### Banned User Example
![Banned User](docs/banned_user_reddit_screenshot.jpg)

### ModMail Communication
![ModMail Communication](docs/mod_mail_communication.jpg)

### Audit Logs
![Audit Logs](docs/audit.png)

---

## ✨ Features

- **Dashboard Post**: Open a private CascadeBan dashboard from the subreddit menu to manage links, pending ban/unban requests, failures, and recent activity.
- **Cluster Linking**: Request, approve, pause, or reactivate subreddit links from the dashboard. ModMail commands (`!link r/Subreddit`, `!approve-link r/Subreddit`) continue to work.
- **Native Reddit Ban Support**: Bans and unbans performed through Reddit's normal moderator UI create dashboard-visible cascade requests for linked subreddits.
- **ModMail Approval Flow**: Linked subreddits still receive ModMail requests and can approve with `!approve-ban u/username` or `!approve-unban u/username`.
- **Cross-Subreddit UI Actions**: Use the post/comment menu to ban a user or add mod notes across the current subreddit and approved linked subreddits.
- **Audit Trail**: Dashboard activity records link changes, request approvals, rejections, applied actions, and failures.

---

## 🏗️ Architecture & Workflows

### 1. Linking Handshake
This workflow demonstrates how two subreddits establish a connection to share ban/unban requests.

```mermaid
sequenceDiagram
    participant SubA as Subreddit A
    participant SubB as Subreddit B
    
    SubA->>SubB: Initiates Link Request (UI or !link)
    Note over SubB: Request appears in Dashboard<br/>and as ModMail
    SubB->>SubA: Approves Link (UI or !approve-link)
    Note over SubA,SubB: Link Established
    SubA-->>SubB: Ban/Unban Events Synchronized
    SubB-->>SubA: Ban/Unban Events Synchronized
```

### 2. Cascade Ban Workflow
When a moderator bans a user in one subreddit, the action propagates to allied subreddits.

```mermaid
flowchart TD
    A[Mod bans user in Subreddit A] --> B{Action Source}
    B -->|Native Reddit Ban| C[Devvit Trigger Detects Ban]
    B -->|Mod Menu Action| D[Devvit Action Handler]
    
    C --> E[Log Ban Event]
    D --> E
    
    E --> F[Fetch Linked Subreddits]
    F --> G{Is Link Active?}
    G -->|Yes| H[Send Cascade Request to Sub B]
    G -->|No| I[End]
    
    H --> J{Sub B Config}
    J -->|Auto-ban enabled| K[Execute Ban in Sub B]
    J -->|Manual approval required| L[Queue in Sub B Dashboard]
    
    L --> M[Mod B Approves via UI/ModMail]
    M --> K
```

### 3. Cascade Unban Workflow
Similarly, unbanning a user propagates the reversal to the linked subreddits.

```mermaid
flowchart TD
    A[Mod unbans user in Subreddit A] --> B[Devvit Trigger / Action Handler]
    B --> C[Fetch Linked Subreddits]
    C --> D{Is Link Active?}
    D -->|Yes| E[Send Cascade Unban to Sub B]
    D -->|No| F[End]
    
    E --> G{Sub B Config}
    G -->|Auto-unban enabled| H[Execute Unban in Sub B]
    G -->|Manual approval required| I[Queue in Sub B Dashboard]
    
    I --> J[Mod B Approves]
    J --> H
```

---

## 🚀 Local Setup & Development

To run this app locally in your own testing subreddit:

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Install Devvit CLI**:
   ```bash
   npm install -g @devvit/cli
   ```
3. **Login to Devvit**:
   ```bash
   devvit login
   ```
4. **Playtest**:
   ```bash
   devvit playtest
   ```

---

## ⚙️ App Settings

After installing, configure the following options in the app's settings:

- **Default Ban Subreddits**: Subreddits to ban from by default via the UI.
- **Default Mod Note Subreddits**: Subreddits to receive mod notes by default via the UI.
- **Default Mod Note Label**: Label used when adding manual mod notes.
- **Default User Message**: Message sent to users when banned. Supports placeholders: `{{author}}`, `{{subreddit}}`, `{{kind}}`, `{{originSubreddit}}`, `{{url}}`, and `{{actioningMod}}`.

---

## 🛠️ Commands

Moderators can use the following commands in ModMail to manage the cascade network:
- `!link r/Subreddit`: Propose a link to another subreddit.
- `!approve-link r/Subreddit`: Approve a pending link request.
- `!approve-ban u/username`: Approve a cascade ban request triggered by an allied subreddit.
- `!approve-unban u/username`: Approve a cascade unban request triggered by an allied subreddit.
