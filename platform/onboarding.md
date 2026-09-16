# Onboarding without SMS or email

Getting somebody from stranger to authenticated, reachable user of a Qbix site through Instagram, Messenger or Telegram — with no phone number and no email address anywhere in the flow.

---

## Why bother

Email and SMS both fail in ways you cannot fix from your side. Mail lands in spam, or the sending domain gets throttled, or the provider pauses the account and every transactional message stops at once. SMS costs money per message and carriers filter it aggressively. And asking for a phone number is where most signup flows lose the most people, because everybody knows what happens to phone numbers.

There is also the shape of the flow itself. Type an identifier, leave the site, find a code, come back, type the code. Four steps across two apps, and the one in the middle can silently never arrive.

The chat-app route replaces all of it with a tap. The person taps a link, lands in a thread with your brand, and is authenticated and reachable — no code, no shared secret, no number. The notification channel afterwards is an app they already have open, and delivery is the platform's problem.

What it costs you is that this is per-platform. Three integrations to cover an ordinary audience, each with a different shape, different limits, and different approval requirements. Telegram is free and immediate; Meta is neither. Sorting out which parts of that are real constraints and which are avoidable is most of what this document does.

Read it in three passes if you like: the channel comparison and the flow to understand the mechanism, the permissions and review sections before committing to a timeline, and the last section to see how much of it Qbix already handles.

---

## The three channels compared

| | Telegram | Instagram | Messenger |
|---|---|---|---|
| Deep link | `t.me/{bot}?start={token}` | `ig.me/m/{user}?ref={token}` | `m.me/{page}?ref={token}` |
| Token arrives on | `/start` update | `messaging_postbacks` or `messages` | `messaging_postbacks` |
| Returning user | zero tap | zero tap | zero tap |
| New user | zero tap | one tap | one tap |
| Prerequisite | a bot | Icebreakers configured, account published | Get Started button |
| Bot may write first | yes | yes, after the referral | yes, after the referral |
| Messaging window | unlimited | 24h, 7d with HUMAN_AGENT | 24h, 7d with HUMAN_AGENT |
| Account type needed | none | Professional | a Page |
| Approval to launch | none | none for your own account | none for your own Page |
| Delivery guaranteed | yes | mostly | Meta explicitly does not guarantee referrals |

Telegram is the cleanest of the three and needs no approval at all — but it has the smallest install base in most Western audiences. Instagram and Messenger reach far more people and cost more to set up. Offer all three and let people pick the app they already have.

**Telegram's messaging window is unlimited.**: once somebody has started your bot, you can message them a year later. Meta's is 24 hours, extendable to 7 days with the `HUMAN_AGENT` tag. So Telegram is a durable notification channel, while Instagram and Messenger are a *conversation* channel that has to be re-opened. Design for that: use Meta for onboarding and time-bounded exchanges, and don't plan a monthly newsletter around it.

---

## The flow, end to end

Identical in shape on all three platforms.

```
1. Site mints a one-time token          Users.Intent.provision('Users/authenticate', platform)
2. Site builds a deep link              Q.Links.instagramDM(handle, 'intent-' + token)
3. Person taps it (or scans a QR of it)
4. Chat app opens the thread with your bot or account
5. Platform delivers the token to your webhook, signed
6. You verify, resolve the intent, accept it
7. Fetch their profile — name, avatar — and import it
8. The original browser tab is notified over the socket, and is now logged in
```

Steps 5 and 6 are what make this an authentication mechanism rather than a link. The token comes back over a webhook you can verify — `X-Hub-Signature-256` on Meta, a secret token header on Telegram — so nothing between the link and your server can forge it. The person never types anything, and there is no shared secret to phish.

### The two fallbacks you will need

**Desktop.** `ig.me` is not officially supported on Instagram Web, and someone reading your site on a laptop cannot tap into a phone app. Show a QR code of the same deep link. They scan it with the phone that already has the app.

**Referral doesn't fire.** Meta does not guarantee `m.me` referrals — they can fail for some Android users and for georestricted Pages. Fall back to showing the token with a copy button and one instruction: send us this code. The bot matches the pasted token against the intent. Ugly, reliable, and exactly what Telegram bots have always done.

```
Send us this code and we'll connect your account.
[  hebrews-a7k2m9x4  ]  ⧉ Copy
```

**Nobody has any of the three.** Keep email as the floor. Delete nothing — just stop making it the first thing you ask for.

---

## Do bot messages actually notify people?

Yes, on all three, and you can control how loudly.

**Telegram** delivers a normal push notification with your bot's name and avatar, indistinguishable from a message from a person. `disable_notification: true` on `sendMessage` makes it silent — it still arrives and still shows an unread badge, but no sound and no banner.

**Messenger** takes a `notification_type` on the Send API with three values: `REGULAR` (sound and a banner, the default), `SILENT_PUSH` (banner, no sound), and `NO_PUSH` (arrives silently, visible only when they open the app). This is a per-message setting, so a reminder can be loud and a status update quiet.

**Instagram** delivers DMs as standard Instagram notifications — a banner with your account's handle and avatar and a preview of the message. From the recipient's side it looks the same as a DM from a person, which is why it converts and why it should not be abused.

Three constraints shape how you use this.

The notification carries **your brand's name and avatar**, not a generic app name — this is a stronger presence in the notification tray than an SMS from a shortcode.

**Everything is subject to the messaging window.** A notification you cannot send because the window closed is not a notification. On Meta, plan around 24 hours.

And **promotional broadcast is a different product.** Meta gates unsolicited marketing behind Sponsored Messages and Marketing Messages, which are paid and separately approved. The free path is genuinely conversational: reply within the window, or use a message tag that honestly describes what you are sending. Treating the free path as a newsletter is how accounts get restricted.

---

## Refs, link previews, and attribution

### The ref is the join key

The `ref` (Telegram's `start` parameter) is an arbitrary string you put on the link and get back over the webhook. It is doing three jobs at once, and it helps to see them separately:

1. **Authentication** — `intent-{token}` resolves to a `Users_Intent`.
2. **Authorization** — `invite-{token}` resolves to a `Streams_Invite`, so the link both logs them in and joins them to a stream.
3. **Attribution** — anything else is a campaign id.

The Qbix Telegram plugin already uses the first two with an `intent-` / `invite-` prefix convention, and the Instagram and Facebook plugins copy it deliberately so one parser handles all three platforms.

Because it is one string, it is also the join key between two otherwise separate analytics systems. Set your Metrics tracker id and your ad's ref to the same value:

```php
$trackerId = 'hebrews/sunday-2026-09';
// web: every QR and link carries ?sourceId=hebrews/sunday-2026-09
// chat: the ad's ref and the deep link's ref carry the same string
```

Now a person who saw an ad, opened a thread, answered a question and later scanned a QR at the event is one identity across Metrics visits and Meta's referral data. Without the shared key those are unrelated datasets.

Limits to respect: Messenger accepts only alphanumerics plus `-`, `_` and `=`; Instagram allows up to 2,083 characters; Telegram's start parameter is 64 characters of `A-Za-z0-9_-`. The intersection is short and alphanumeric, which the default 16-lowercase-letter intent token satisfies.

### Links inside chats unfurl using your OpenGraph tags

When your bot sends a link, the chat app fetches the page and renders a preview card from its `og:` meta tags — title, description, image. This is the same metadata the Instagram plugin *reads* from post pages, now working in the other direction.

That preview is doing real work. It is the difference between a bare URL and a card with the event photo, the date and a headline. Practically:

- Give every page you send a proper `og:title`, `og:description` and `og:image`. Qbix fires a `Users/metas` event for exactly this.
- `og:image` should be at least 600px wide or the platforms fall back to a small thumbnail.
- Preview generation is **cached aggressively** by every platform. Change a page's OG tags and the old card can persist for days. Vary the URL when you need a fresh card.
- Telegram lets a bot suppress the preview entirely (`disable_web_page_preview`), which is worth doing for utility links where the card is noise.

### What attribution you actually get

| Source | What comes back |
|---|---|
| Deep link with `ref` | your exact string, on the referral or postback event |
| Click-to-Message ad | `ref` plus `ad_id`, plus `ads_context_data` with the ad title and creative |
| Instant form ad | `ad_id`, `adset_id`, `campaign_id` on the lead itself |
| Tracked web link | a Metrics visit, chained across pages by `#v=parentVisitId` |
| Organic tag or mention | nothing but the handle |

The ad referral appears on the **first message only**. Capture it then or lose it.

---

---

## Flows that start on the platform

Everything above starts on your site. These start where the person already is, which means the first touch costs them nothing and you do not have to get them anywhere first.

### Comment on a post

The strongest of them, because it is the only path where the app may initiate contact with someone who has never touched you.

```
they comment "JOIN" on your post
  → comments webhook fires (or you poll)
  → privateReplyToComment() — allowed once per comment, within 7 days,
    and it BYPASSES the 24-hour window: the comment itself is the permission
  → the DM contains a deep link carrying an intent token
  → they tap it, and they are authenticated and reachable
```

The ask is one word typed in a place they are already looking. And it works in the one context Meta refuses to make links tappable — a post caption or a Reel — which is exactly where "link in bio" goes to die.

Worth designing the keyword to be specific rather than generic. `SUNDAY` tells you which post produced the lead; `INFO` across six posts tells you nothing.

### Tag the account or Page

Zero effort, and no reachability — a tag returns a handle, not a messageable id. What it gives you is content and an attested identity, and both are worth something.

```
they tag @hebrews.app in a post
  → syncTaggedMedia imports it
  → the photo goes on the wall
  → reserveIdentity() parks an unclaimed ExternalFrom row against their handle
  → a human can DM them from the app; a bot cannot
```

The parked row does the work here. If that person later arrives through any of the authenticated onramps, the xid matches and the records join, so they inherit the photos already attributed to them rather than starting a second account. "Tagged us in March, opened a thread in April" becomes one history.

### Reward the tag, then convert it

The wall is already the reward — a photo on a screen in front of the room beats points. But the sequence that turns a tag into a user is worth being deliberate about:

```
they tag  →  photo appears on the wall  →  you reshare it to your Story
          →  they see their own photo on your account
          →  that is the moment to reach out
```

A manual DM at that moment converts far better than a cold one, because you are not asking for anything — you are telling them their photo is up. Include the deep link, and the conversation continues automatically from there.

Reward only what Meta attested. A photo with `source: tag`, `channel` or `fb-tag` came from the API; `paste` and `chat` came from a human typing a URL, and a URL is not a claim of authorship. Cap rewards per handle per event so one enthusiastic poster does not take the pool, and gate them behind the invite system's point threshold so a fresh throwaway account earns nothing until somebody vouches.

### Story mention

They mention you in a Story. You get a DM notification with an **Add to your story** button — one tap to reshare, and their friends see their content on your account. Public accounts only, and the whole thing expires in 24 hours.

There is no API path here worth building. Treat it as a manual, high-value, time-boxed prompt.

### DM a keyword

The lowest-friction of all for someone already in your DMs: they send a word, the bot answers. No link, no tap, no form. Worth putting the keyword in your bio, in Icebreakers, and in the pinned comment of every post.

### What these have in common

None of them require the person to leave the app, and none require a phone number or an email address. What they differ in is what you can do next:

| Starts with | Bot can reply | Human can reply | You get |
|---|---|---|---|
| Comment | **yes**, once, 7 days | yes | comment id, handle, a route to a thread |
| DM keyword | **yes**, 24h window | yes | a thread and an id |
| Tag | no | yes | handle, content, an attested identity |
| Story mention | no | yes, 24h | a reshare |

---

## Permissions: what needs review, and what doesn't

I got this wrong in an earlier draft, and the correction matters enough to lead with it.

**Standard Access and Advanced Access answer different questions.** Standard Access is about *whose accounts you may operate on* — your own Page rather than a client's. It says nothing about *which humans may interact with you*. And every member of the public who messages your Page is a third party, even when the Page is entirely yours.

So an app in Development Mode, or with Standard Access, **works only for people who have a role on it** — admins, developers and testers. Not just the API: the Get Started button does not render for anyone else, the welcome screen is invisible to them, and webhooks about them are not delivered.

Which means: **yes, a public-facing Meta bot needs App Review, including for the ref-based authentication flow.** The referral webhook is a webhook, and it is not delivered for non-testers. There is no polling workaround for it either, because there is no endpoint to poll for "somebody just opened a thread with a ref." That gap is real and I should have flagged it instead of listing DMs as review-free.

### What that actually means per platform

**Telegram: genuinely nothing.** No review, no verification, no account type, no Development Mode. BotFather, a token, a webhook URL, and it works for the whole public immediately. Given the above, this is a much larger advantage than it first appears.

**Instagram and Facebook: review required for anything public-facing.** For your own Page and account, the review is a *simpler* one — Business Verification plus a per-permission justification and screencast — but it is not skippable. Typical review times run a few business days per submission, with rejections resetting the clock for the permission that failed. Meta will test the app directly, so it must be live and publicly reachable at submission time.

The one thing that helps: because it is your own brand, you are not asking for Advanced Access to serve *other businesses'* accounts, which is the harder submission. You are asking to serve your own Page's visitors.

### What still works with no review at all

Not nothing, and worth separating out clearly.

| Works at Standard Access | Notes |
|---|---|
| Read your own media, tags, mentions | polling, not webhooks |
| Read comments on your own posts | polling |
| Publish content | your own account |
| Business discovery on public professional accounts | reading, not messaging |
| oEmbed and OpenGraph | no app required at all |
| Everything, for testers | admins, developers and testers of the app |

So the photo wall, tag sync, the channel sync and the whole Tier 0 and Tier 1 read path work without review. It is the **messaging** half — bots, referrals, private replies, authentication through a chat thread — that needs it.

### The human fallback, which needs nothing

Somebody opens the Instagram app or the Page Inbox and types. Zero permissions, zero API, works on day one and works for the public.

This is the only route for the onramps a bot cannot touch anyway — a tag, a Story mention, a comment older than seven days — and it converts better than automation at the moment somebody's photo goes up on your wall.

The cost is labour, so treat it as a tier with a headcount attached and spend it on the handles worth a minute.

### Can the bot take over from the human later? Yes

The **Handover Protocol**, on both Messenger and Instagram Direct. Several apps can sit behind one Page, but only one holds *thread control* at a time. One is the **primary receiver** and has it by default; the rest — including Meta's own Page Inbox and Instagram Inbox — are **secondary receivers**. Roles are set in Page Settings under Messenger Platform, or through the Conversation Routing API on Instagram.

```
bot owns the thread
  → decides a person is needed
  → pass_thread_control to the Page Inbox
  → a human replies from the ordinary inbox, no special tooling
  → the agent hits "Mark as Done"
  → that fires pass_thread_control BACK to your app
  → the bot resumes
```

`take_thread_control` lets the primary receiver reclaim a thread unilaterally, which is useful as a timeout so a conversation a human forgot about does not sit dead. `request_thread_control` lets a secondary ask for it. While you do not own the thread, messages arrive as **standby** events, so the bot keeps listening without replying.

Subscribe to `messaging_handovers` for any of it — which puts it back inside the review requirement.

One related quirk: Meta's own Messenger Lead Ads take thread control while their questioning flow runs and **deliver no webhooks to your app during it**. Control returns when it ends, and `getConversation()` reads what was said in the meantime.

### After approval, the policing continues

Approval is not the end of it. Meta monitors bot behaviour afterwards, and a Page found in violation gets an explanation in its Page Support Inbox and roughly **seven days to correct course** before messaging can be limited. Declaring the right experience type in the App Dashboard — fully automated, human-only, or hybrid — avoids being measured against a responsiveness policy that does not fit what you built. For a hybrid bot, set it in Page Settings under Advanced Messaging.

### The shape I would actually build

**Start on Telegram**, as the production channel for anyone who has it rather than as a prototype. Nothing needs approval, the messaging window is unlimited, and the auth flow is the same shape you will reuse.

**Ship the Meta read path immediately.** The wall, tag sync, channel sync, comment reading by polling. All of it works at Standard Access and none of it waits on anyone.

**Put a human in the Inbox from day one.** It covers the flows a bot could never reach, and it is what converts a tag into a member.

**Submit for review in parallel, not first.** You will have a working product to screencast, which is most of what makes a submission pass. Wire the Handover Protocol so that when approval lands, the bot picks up threads the humans have been carrying.

**Keep email as the floor**, well below the fold. It is what works when somebody has none of the three apps, and what still works if a Meta review goes badly.

---

## Passing App Review: the exact steps

### Are Instagram and Facebook the same review?

**One app, one Business Verification, one submission — but each permission is reviewed individually.**

Instagram and Facebook Page permissions live in the same Meta app and can go in the same submission. What you cannot do is write one justification and record one video covering several permissions. Meta requires a separate written description *and* a separate screen recording for each permission, and explicitly says a video showing multiple permissions across different use cases may be rejected. Both are required: a recording without a description is rejected, and so is a description without a recording.

One structural constraint decides the shape of your submission, and it is easy to misread: **an app uses Facebook Login or Instagram Login, not both.**

That is about how your app obtains tokens. It is **not** a limit on which platforms you can serve, and it has nothing to do with refs. Deep links and their `ref` parameters are independent of the login type entirely.

**Facebook Login for Business gives you both platforms in one app** — a Page access token plus the linked Instagram professional account. Which is why its permission list contains `instagram_manage_messages`, `pages_messaging` and `pages_show_list` side by side: one app, one submission, both inboxes, both `ig.me` and `m.me` refs.

The constraint bites the other way. **Instagram Login gets you only Instagram** — `graph.instagram.com`, no Facebook Page, and therefore no Messenger and no `m.me`. It also cannot access tagging or business_discovery. So it is ruled out here twice over, and the Instagram permissions you request are the `instagram_*` flavour rather than the `instagram_business_*` ones.

### Before you submit — the four things that cause rejection before review begins

These are configuration, not argument, and getting one wrong means the submission is rejected before a human looks at it.

1. **Business Verification, completed first.** Legal business name, address, supporting documents, in Meta Business Manager. An unverified business cannot receive Advanced Access no matter how good the submission is. Start this early — it runs on its own clock, separate from review.
2. **A privacy policy that names the Meta APIs and the specific data collected.** A generic policy is not sufficient and is one of the most common single causes of rejection. It must load fast; a slow page has reportedly been enough to fail.
3. **A Data Deletion Callback URL or Data Deletion Instructions URL.** For apps using Facebook Login for Business that handle Facebook user data this is mandatory, and it is among the most commonly missing requirements.
4. **App settings complete** — icon, category, data use checkboxes. And the app must be **live and publicly testable at submission**, because reviewers will try it. Behind a login wall they cannot pass, on a staging environment, or returning an error, and the whole submission fails.

Then: **test user credentials**. Reviewers need a way into your app to reproduce what the screencast shows.

### The submission itself

In the App Dashboard, App Review → Permissions and Features. Advanced Access is requested **per permission**. You may bundle them into one submission or split them; the per-permission requirements are the same either way.

For hebrews.app the messaging surface needs roughly:

| Permission | What the screencast must show |
|---|---|
| `pages_messaging` | a real person messaging the Page and the app replying |
| `pages_manage_metadata` | subscribing the Page to webhooks, and an event arriving |
| `instagram_manage_messages` | the same round trip on Instagram Direct |
| `instagram_manage_comments` | reading a comment and replying, or a private reply |
| `pages_manage_engagement` | replying to or hiding a comment on a Page post |
| `pages_read_user_content` | reading posts that tagged the Page |

That is six recordings and six justifications. Which argues strongly for **submitting in waves**: request only what the auth flow needs first — `pages_messaging`, `instagram_manage_messages`, `pages_manage_metadata` — get it approved, then add the rest. Fewer permissions is a smaller surface for a reviewer to object to, and a rejection on one does not stall the others.

Only request what you actually use. An app requesting a permission that serves no visible function in the screencast risks the whole submission, and an app that looks like it stores more than the stated use case needs reads as a compliance risk rather than a technical detail.

### What the screencast has to contain

This is the most commonly failed requirement, so be mechanical about it. Meta reviewers do not explore your app; the recording is their primary reference. Three things must be visible for each permission:

1. **Logged out to logged in.** Log out of everything first, then record the entire sign-in including any non-Facebook login your app uses. No skipping ahead.
2. **The consent screen showing that exact scope**, and the person actually granting it. The full authorization flow.
3. **The permission's data doing something visible in your front end.** Not "the API returns this" — the feature working.

Use a **real Business or Creator account**, not a test user. Go slowly enough to follow. And add a visible on-screen annotation at the moment each permission is exercised, naming it: *"pages_messaging — used here to send the reply after the person opens the thread."* That removes the reviewer's need to guess, which is where most rejections originate.

### Timeline and what to expect

Budget weeks, not days. Reports in 2026 put the baseline review cycle at around 20 days, up from about 10 — treat that as directional rather than a promise, but plan on the longer end. A rejection on any single permission requires a corrected resubmission and restarts the clock for that permission.

Most first submissions are rejected. The five reasons, in rough order of frequency: the screencast does not clearly show the permission being exercised; the privacy policy does not mention the Meta APIs; the justification is vague about why *that* permission is the minimum required; the app was not reachable or testable; test credentials were missing.

Draft submissions are not reviewed. It happens.

### After approval

Approval is not the end. Meta monitors behaviour afterwards, and a Page in violation gets an explanation in its Page Support Inbox and roughly **seven days to correct course** before messaging can be limited. Declare the right experience type in the App Dashboard — fully automated, human-only, or hybrid — so you are not measured against a responsiveness policy that does not match what you built. For a hybrid bot, set it in Page Settings under Advanced Messaging.

### The order I would do it in

1. **Start Business Verification today.** It gates everything and runs independently.
2. **Ship the read path and Telegram** while it processes. Neither needs any of this.
3. **Write the privacy policy and the data deletion URL** properly, once. They are reused across every submission you will ever make.
4. **Get the auth flow working for testers.** It works at Standard Access for people with an app role, which is exactly the environment the screencast is recorded in.
5. **Record three screencasts and submit wave one.** You are filming something that already works, which is most of what makes a submission pass.
6. **Add the remaining permissions in wave two** once the first is approved.

---

## What Qbix already does for you

Most of the above is not new work. The framework has the pieces and they were built for exactly this shape.

**`Users_Intent` is the whole mechanism.** An intent is a short-lived token bound to an action, an originating session and a set of instructions. `Users_Intent::newIntent('Users/authenticate', ...)` mints one; `fromToken($token)` resolves it on the other side; `accept()` sets the logged-in user, optionally copying session fields from the originating session; `complete()` marks it used and notifies the originating session over a socket. Duration is config (`Users/intents/actions/Users/authenticate/duration`, 300 seconds by default), and there is a debounce so a hammering client gets the same intent back rather than a hundred rows.

That last property is what makes the browser tab log itself in without polling. The tab that provisioned the intent is listening; the webhook completes it; the socket fires.

**`Users.Intent.provision` and `Users.Intent.start`** are the client half. `provision` reserves a token and caches the capability; `start` either redirects, or shows a QR code and waits — including re-checking on visibility change, so switching to the chat app and back does the right thing. The QR path exists because it was needed for exactly this: authenticate on a laptop using the phone in your pocket.

**`Users_ExternalFrom` is the identity model.** One row per platform, app and xid, with the access token and a JSON extras bag. `Users_ExternalTo` maps the other direction. `Users::authenticate($platform, $appId, $authenticated, $import)` is the shared entry point, and `$import` names the profile fields to pull. The Telegram plugin's `authenticate()` shows the full pattern: verify the payload, open a deterministic session, parse the start parameter into an intent or an invite, then build the `ExternalFrom` row.

**Profile import is already wired.** Fill `Users::$cache['platformUserData']` and the `Streams_after_Users_User_saveExecute` hook populates `Streams/user/firstName`, `lastName`, `username` and `icon`. `Users::importIcon()` takes a set of URLs and produces the sized icons. `Users/import/{platform}` config decides which fields. Nothing platform-specific needs writing beyond a method that returns the platform's field names.

**Notification delivery is generic.** `Users::deliver()` picks a channel; `Users_Device` handles push; `handlePushNotification()` on an `ExternalFrom` subclass lets a platform take delivery itself — which is how a Telegram bot message becomes a Qbix notification without any of the calling code knowing what Telegram is. The Instagram and Facebook plugins implement the same method, so `Streams` subscriptions can deliver over a DM thread with no change to `Streams`.

**Invites already carry access.** `Streams::invite()` mints a token with read, write and admin levels attached, and `subscribe: true` makes the invitee a subscribed participant. Put `invite-{token}` in a deep link's ref and one tap logs them in *and* joins them to the stream *and* subscribes them to its notifications. That is the whole onboarding funnel in one URL.

**Attribution is the Metrics plugin.** Trackers, visits, hits, actions, traits, conversions, and visit chaining through `Metrics/landed`. It has no dependency on Users or Streams, so it works for anonymous arrivals and joins up later.

### What is left to write

Per platform, roughly one class and one webhook handler:

- an `ExternalFrom` subclass with `authenticate()`, `import()`, `icon()` and `handlePushNotification()`
- a webhook handler that verifies the signature and parses the ref into `intent-` or `invite-`
- `Q.Links` helpers for the deep link, on both the PHP and JS sides so server-rendered QR codes and client-rendered buttons produce the same string
- the platform's welcome-screen setup call, where one exists

Telegram is done. Instagram and Facebook have the webhook, the ref parsing, the profile import and the link helpers; what remains on those is the `ExternalFrom` subclass wiring and a live test of the referral delivery path.
