# Jarvis Mobile 2.2 — Assistant guide

Everything on this page is optional. Data stays in this app's local storage on
the phone; tokens are sent only to the service you configure. Open
**Settings > ASSISTANT 2.2** for the panels.

## Personality and writing voice

- **Style**: Jarvis (calm, witty, "sir"), Professional, Friendly, Concise,
  Mentor, Creative, or Custom.
- **Custom instruction**: a plain-language rule such as "Roman Urdu mein short
  sentences, no jokes".
- **Learn my voice**: paste a paragraph you wrote. Jarvis keeps the last five
  samples and matches that tone in drafts (it does not copy facts from them).
- **Feedback**: short notes such as "zyada formal mat raho" are applied to later
  drafts.
- **Reset** clears the style, samples and feedback.

Voice commands: *"show my personality"*, *"be more concise"*, *"learn my
writing: ..."*.

## Calendar

Jarvis keeps a local calendar and can also open the real Android calendar.

- Add: *"kal 3 baje Ali se meeting"*, *"meeting tomorrow 5 pm"*,
  *"2027-01-05 09:30 dentist"*, *"in 2 hours call"*.
- List: *"what's on my calendar"*, *"aaj ka schedule"*, *"this week"*.
- Update / reschedule / delete by title or id; the panel also lists events.
- **Copy .ics** exports every local event as iCalendar text to the clipboard.
- **Phone calendar** (toggle in the panel) opens Android's standard event screen
  with title, time, location and notes filled in. Android's own **Save** button
  finishes it. Jarvis never writes the calendar database silently, so no
  calendar permission is requested.

## Routines

- *"routine add 07:30: news sunao"*, *"list routines"*,
  *"routine delete news"*.
- Routines fire while the app is open or its foreground service is alive. A
  force-stopped app or a killed process cannot run them; Android does not allow
  a WebView timer to survive that.

## Work tools

Supported services and what Jarvis can do with your own token:

| Service | Read | Write |
|---------|------|-------|
| GitHub | open issues / PRs in `owner/name` | create an issue |
| Slack | latest messages in a channel | post a message |
| Notion | search, read page blocks | append a paragraph |
| Linear | assigned issues | create an issue (team id required) |
| Jira | assigned issues | create a task (project key required) |

Add the token (and repo / channel / team / project / Jira URL + email) in
**Work tools**. Tokens are stored only in local storage and are never shown
again after saving. Every write first returns a confirmation prompt; say
**"confirm"** to run it or **"cancel"** to drop it.

## MCP (Model Context Protocol)

Jarvis Mobile is an MCP **client** over streamable HTTP.

- Add a server name and its `https://` URL, plus a bearer token if needed.
- **List tools** performs `initialize` then `tools/list`.
- **Call tool** sends `tools/call` with a JSON arguments object.

Honest limits:

- A phone cannot host a local **stdio** MCP server for other apps, so only
  remote HTTP servers are supported.
- The native bridge cannot read response headers yet, so servers that require an
  `mcp-session-id` header may reject requests. The error message says so.
- Responses may be JSON or `text/event-stream`; both are parsed.

The PC Jarvis exposes its memory as the `jarvis-memory` MCP server. Jarvis Mobile
does not host that server itself.

## Page reading and summaries

With **Phone automation** on, Jarvis can read the visible text of the current
screen and answer questions about it, or summarise it.

- *"read this page"*, *"summarize this page"*, *"summarize this article: ..."*.
- Text is trimmed before it is sent to Gemini, and the page text is never stored
  as a memory.

## Dictation

Global dictation turns speech into text for the focused field.

- *"start dictation"* begins; *"stop dictation"* ends it.
- With Phone automation on, text is appended to the focused editable field.
  Without it (or if the field cannot be edited), the whole buffer goes to the
  clipboard so you can paste it.
- Spoken edits: *"scratch that"* / *"delete last sentence"*, *"delete last
  word"*, *"new line"*, *"new paragraph"*, *"comma"*, *"period"*, *"question
  mark"*, *"exclamation mark"*, *"capitalize that"*.
- Dictation is foreground: it uses the microphone while Jarvis is running. It is
  not a system keyboard replacement.

## Privacy

- Personality samples, calendar events, routines, work tokens and MCP settings
  live in this app's local storage.
- Tokens are sent only to the service you configured; page text is sent only to
  Gemini for the summary you requested.
- No analytics server, no keystore or token is committed to this repository.
