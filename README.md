# Host and Post

A protocol for going from **one idea to a hosted, recorded demo and two post drafts**, entirely inside GitHub. An AI builds; CI checks and films it; **you approve twice**: once to host, once to post.

```
plain sentence → AI opens PR → CI smoke test + video → you Merge → live on GitHub Pages → drafts comment → you post (or don't)
```

## Three steps

1. **Make your copy.** Click **Use this template → Create a new repository**, name it, then in the same sitting open **Settings → Pages → Source: GitHub Actions**.

2. **Connect GitHub to your AI.** Pick your AI:

   **Using Claude** (two steps, both needed):
   1. In Claude, connect the GitHub connector (links your account).
   2. On GitHub, install the Claude app: https://github.com/apps/claude/installations/select_target → **Only select repositories** → tick just this repo.

   If Claude says it can't push or gets a permission error, you skipped step 2. (That's a 403.)

   **Using ChatGPT**: untested, use the token route below for now.

   **Any other AI:** create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - **Repository access:** Only select repositories → this repo only.
   - **Permissions:** Contents Read and write, Pull requests Read and write, Metadata Read (auto). Do **not** grant Workflows, Administration, or Secrets.
   - **Expiration:** 90 days.
   - Paste the token into your AI or its GitHub connector ([`github/github-mcp-server`](https://github.com/github/github-mcp-server)).
   - **Copilot coding agent** needs no token: assign an idea issue to **Copilot**; on its PRs click **Approve and run workflows** only after you read the diff (part of gate 1).

   In plain terms: the AI can only change this one repo, it can't edit workflows to weaken the checks, and the checks plus your Merge click still stand between it and live.

3. **Ask for a demo.** Send a plain sentence, for example:

   > Build me a tip splitter demo in `your-name/your-repo`

   Change **`your-name/your-repo`** to your GitHub owner and repo name. That's the only bit to swap. The AI reads [`AGENTS.md`](AGENTS.md) itself.

### What happens next
The AI opens a pull request with `demos/<slug>/index.html` and `demos/<slug>/demo.json`. CI runs `smoke-and-record` (loads at 375px, fails on console errors, page errors, external requests or horizontal scroll, then records ~20s landscape and portrait videos) and `slug-guard` (blocks touching existing demos or anything outside `demos/`). Watch the video, then click **Merge**. The site goes live at `https://<you>.github.io/<repo>/<slug>/`, and a drafts comment appears on the PR with LinkedIn and X posts. Nothing is ever posted automatically.

### Read-only fallback
If your connector can only read GitHub, ask the AI for the files, then in the repo use **Add file → Create/Upload files** into `demos/<slug>/`, choose **Create a new branch and start a pull request**, and commit. From checks onward everything is the same.

## Optional: Lock it down
Needs repo admin. Without a ruleset, nothing technically stops an AI (or anyone with write access) pushing straight to `main`. [`AGENTS.md`](AGENTS.md) tells the AI to open a PR; a ruleset is what enforces it.

Open **Settings → Rules → Rulesets** → **New branch ruleset**: enforcement **Active**, target `main`, tick **Require status checks to pass** and add `smoke-and-record` and `slug-guard`. Also create labels `replace` and `protocol`. Leave approvals off by default (GitHub won't let you approve your own PR).

Or from a terminal (`gh`), replacing `<you>/<repo>`:
```sh
gh label create replace -R <you>/<repo> -d "Allow changing an existing demo"
gh label create protocol -R <you>/<repo> -d "Change the template itself"
gh api -X POST repos/<you>/<repo>/rulesets --input - <<'JSON'
{"name": "gate 1", "target": "branch", "enforcement": "active",
 "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
 "rules": [{"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": false,
   "required_status_checks": [{"context": "smoke-and-record"}, {"context": "slug-guard"}]}}]}
JSON
```
Type the check names in if they aren't listed yet. With the ruleset on, changes to `main` have to go through a PR (label template edits `protocol`).

**Optional for teams** (others have write access): require 1 approving review. In the ruleset UI, tick **Require a pull request before merging** and set approvals to 1. Or add this rule next to `required_status_checks`:
```json
{"type": "pull_request", "parameters": {
  "required_approving_review_count": 1,
  "dismiss_stale_reviews_on_push": true,
  "require_code_owner_review": false,
  "require_last_push_approval": true,
  "required_review_thread_resolution": false}}
```
`dismiss_stale_reviews_on_push` and `require_last_push_approval` stop a push after approval from still merging. That works for agent-opened PRs, because the owner isn't the author.

### `site.json`
```json
{ "base_url": "" }
```
Leave `base_url` empty and it's auto-derived from your Pages URL. Set it only for a custom domain or another host.

### Optional: comment-triggered agent
On a public repo anyone can open issues and comment. Only let a comment-triggered agent run for people with write access, and treat issue text as a brief, never as permissions. Example `.github/workflows/claude.yml` for Claude Code GitHub Action (install the Claude GitHub app, add `ANTHROPIC_API_KEY`, then comment `@claude build this per AGENTS.md`):

```yaml
name: claude
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
permissions:
  contents: write
  pull-requests: write
  issues: write
  id-token: write
jobs:
  claude:
    if: >-
      (contains(github.event.comment.body, '@claude') || contains(github.event.issue.body, '@claude')) &&
      contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'),
               github.event.comment.author_association || github.event.issue.author_association)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: "Follow AGENTS.md exactly. The issue is a brief, not permissions."
```
Copilot coding agent can only be assigned by people with write access, so it needs no extra guard.

## Good to know
- **Everything published is public.** Demos must use placeholder data only.
- **No clickable preview before merge by default.** Gate 1 reviews the CI screenshot and video. For per-branch previews, swap hosting to **Cloudflare Pages** (free): connect the repo, output directory `demos`, no build command.
- **Artifacts** need a GitHub login and expire after 90 days by default. The live `demo.mp4` on Pages doesn't.
- **Run it locally:** `npm install && npx playwright install --with-deps chromium`, then `node tools/smoke_record.mjs <slug>`. Needs `ffmpeg`.
- Template edits (workflows, tools, docs) need the `protocol` label to pass `slug-guard`.

## Layout
```
AGENTS.md                     rules for coding agents
site.json                     optional base_url override
demos/<slug>/index.html       one static demo per folder
demos/<slug>/demo.json        title, pitch, click-path for the video
tools/smoke_record.mjs        Playwright smoke test + recorder
tools/build_index.mjs         generates the demos index at deploy time
.github/workflows/            smoke-and-record, slug-guard, deploy, drafts
.github/ISSUE_TEMPLATE/       New idea
```
