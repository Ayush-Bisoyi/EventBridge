# EventBridge submission checklist

Complete the small deployment-specific fields below privately before submitting. Do not put secrets in this file.

## Repository

- [ ] Repository is private until the recruitment team permits public visibility.
- [ ] Repository contains the full source tree, including `README.md`, `DESIGN.md`, and `LEARNING.md`.
- [ ] No `.env`, password, API key, or webhook secret is committed.
- [ ] GitHub Actions CI is green.
- [ ] Commits are incremental and have descriptive messages.

## Deployment

- [ ] Public application URL: `________________________________________`
- [ ] Deployment health check returns `{"ok":true,"database":"up"}`.
- [ ] PostgreSQL is a managed/persistent database, not an ephemeral local file.
- [ ] `ADMIN_PASSWORD` is configured in the hosting provider.
- [ ] `WEBHOOK_SECRET` is configured in the hosting provider.
- [ ] `SESSION_SECRET` is configured in the hosting provider.
- [ ] The deployed URL works from a fresh browser session.

## Private submission details

Share these through the official submission channel, never in the public README:

- Public deployment URL: `________________________________________`
- Webhook header name: `X-Webhook-Secret`
- Webhook secret: `________________________________________`
- Viewer password: `________________________________________`
- GitHub repository URL: `________________________________________`

## Demo evidence

- [ ] Screenshot or recording shows two browser windows receiving the same live event.
- [ ] Screenshot or recording shows a successful event becoming `Completed`.
- [ ] Screenshot or recording shows a failed event with a stored failure reason.
- [ ] Screenshot or recording shows a retry changing the event to `Completed`.
- [ ] Screenshot or recording shows duplicate delivery does not create a second row.

