# Q/swimlane + Q.Tool.mockup + Q.Tool.DOMtoSVG

## Install

```
platform/plugins/Q/web/js/Q/DOMtoSVG.js
platform/plugins/Q/web/js/Q/mockup.js
platform/plugins/Q/web/js/tools/swimlane.js
platform/plugins/Q/web/css/tools/swimlane.css
```

Register alongside `Q/expandable` in `Q.js`:

```js
"Q/swimlane": {
    js:  ["{{Q}}/js/Q/DOMtoSVG.js", "{{Q}}/js/Q/mockup.js",
          "{{Q}}/js/tools/swimlane.js"],
    css: "{{Q}}/css/tools/swimlane.css"
}
```

## Use

```js
Q.activate(Q.Tool.setUpElement('div', 'Q/swimlane', {
    actors:  [{ userId: 'demo-alice', name: 'Alice', color: '#5b6ee1' }],
    moments: [ /* canonical journey shape */ ]
}));
```

Or from a stream, once the Scenarios plugin is installed:

```js
{ publisherId: communityId, streamName: 'Scenarios/timeline/governance-flow' }
```

## Design

The visual grammar is a Lamport space-time diagram, because that is what a
multi-user journey is. Each actor gets a continuous process spine; events
attach to it; arrows between spines are messages. Ordinals are set in tabular
mono because they are clock values, not labels.

### No arrows

There is no arrow layer. In an ordered timeline, position already says that a
moment follows the one above it — a line drawn to say the same thing is
redundant ink, and at three columns of mockups it is the thing you notice
instead of the mockups.

What position does *not* say is **whose action landed here**. That is a mark
on the affected node, not a line between two:

```js
frame.cause = { userId: 'demo-bob',
                type: 'Safebox/action/approved',
                label: 'approved' }        // label defaults to the type's last segment
```

Derived automatically from the moment's primary actor when omitted; set
`cause: false` to suppress, or `showCauses: false` globally. The mark lives in
the node's header rather than on the screen, because it is metadata about the
frame — painted on the mockup it collides with the mockup's own badges.

Below ~190px the label is dropped and the avatar stands alone. At three
columns on a phone a truncated three-character type is worse than nothing, and
the avatar still answers "from whom".

Spines stay.  — arrows carried nothing the layout did not.** One actor's progression
through time is the spine — solid where they are present, faded and dashed
across gaps, with a short S-curve where the cast changed and their column
moved.

When an actor's column jumps most of the way across the layout in almost no
vertical distance, no curve joining those two points looks like continuity —
it looks like a horizontal arrow across the timeline. Past roughly twice the
vertical span, the connector is replaced by two short tails. The lane colour
and the event ticks carry the rest. Arrows are reserved for one actor's action changing another's view.
Deriving same-lane arrows duplicated the spine and was most of the visual
noise; that duplication is gone.

**A denied lane is a feature.** `frame.denied` renders as a deliberate hatched
panel, not an error. It shows access control from the inside, which is
otherwise very hard to demonstrate.

**Every colour comes from the host app's CSS variables.** Switch the page to
dark mode and the mockups follow with no re-render, because `DOMtoSVG` emits
`var()` references read from CSSOM rather than computed colours.

## Motion

One scale, two curves. Eleven ad-hoc durations and three easings read as
eleven unrelated things happening; a shared scale reads as one interface
responding.

```css
--sw-t-fast: 140ms;   /* state flips: hover, press, dim */
--sw-t-base: 260ms;   /* things appearing and disappearing */
--sw-t-slow: 420ms;   /* things travelling across the layout */
--sw-ease:      cubic-bezier(.22, .8, .3, 1);   /* decelerate — arrivals */
--sw-ease-move: cubic-bezier(.5, 0, .18, 1);    /* both ends — travel */
--sw-stagger:   45ms;
```

Nothing in the stylesheet writes a literal duration. Retiming the whole tool
is five values.

### Filter changes move, they do not blink

A crossfade tells the viewer that something changed. It does not tell them
*what* — a person present both before and after simply blinks and reappears
somewhere else, and the eye has to re-find them.

So `filter()` runs FLIP: measure every node, rebuild, transform each survivor
back to where it was, release. Columns visibly rearrange and you can follow
one actor across the change. Only `transform` is animated, so it composites
and never reflows. All survivors are released in the same frame after one
forced read, so the columns start together instead of cascading.

Actors being removed leave a **ghost** — a clone that fades and shrinks from
the old position. Without it a column blinks out with nothing to follow. The
ghost layer is built before `refresh()` and appended after, since `refresh()`
clears the element.

`setJourney()`'s rebuild path flips too.

### Reveal reads in order

Nodes carry `--i` by column, so a three-column moment resolves left to right
rather than in whatever order the IntersectionObserver happened to fire.

### Spines draw

Solid spine paths carry `pathLength="1"`, so a short connector and a long one
take the same time and the layer resolves together. Event ticks scale in.

### One ring, three intensities

Resting, primary, and attended all move `--ring` and `--ring-a` rather than
each inventing its own `box-shadow`. Hover, keyboard focus and the narrated
moment are the same mechanism at different strengths.

### Reduced motion

Every animation above collapses to its end state — verified, not assumed: no
ghosts, no flips, no partially-transparent nodes, correct final layout.

## When the cast exceeds maxSideBySide

Actors are ranked by how much the moment is about them: the one who acted
leads, then frames with something to show, then denied lanes, then idle ones.
The top `maxSideBySide` get columns; **everyone else becomes a `Q/expandable`
below the row** — the same accordion single-column mode uses, so the two cases
behave identically.

`frame.significance` overrides the ranking when you want to pin someone.

## Narration

```js
tool.play();  tool.pause();  tool.seek(ordinal);
```

Frames narrate in turn: the actor who moved, then each other perspective. In
the accordion, a frame's clock starts *after* its expandable finishes opening,
not when it starts — so the viewer has time to see the content.

The scrubber is a census. Each dot carries the colours of whoever is present
at that moment: solid for one actor, a split gradient for several, a diamond
for a fork. The shape of the cast is legible before you scroll anywhere.

## Branching

A moment with `branches` pauses playback and offers the choice. Moments
tagged `branchOf: { ordinal, index }` belong to an arm.

Before anyone chooses, the **first arm shows by default** — a timeline that
looks truncated on arrival reads as broken. The fork interrupts playback, not
the static view. The unchosen arm stays in the data; seeking back to the fork
re-presents the choice.

## The disclaimer

```js
disclaimer: 'Mockups only. Final scope and behaviour are set by contract.',
disclaimerAlways: true
```

Rendered under the timeline **and composed into `exportSvg()` output**, not
appended beside it. An exported file is precisely the artifact that turns up
in a conversation months later without its context, so the caveat travels
inside the document.

```js
tool.exportSvg({ width: 1000 });   // self-contained, colours inlined
tool.download('governance.svg');
```

## Virtualization

Nodes outside the render window have their **screen contents dropped**, while
the wrapper stays in the DOM holding its measured height.

That split is the whole design. Removing the wrapper would move every arrow
anchor and spine point below it, and would change the document height under
the reader's scroll — so the timeline would crawl while you scrolled it. What
is actually expensive is the SVG inside: a mockup runs to roughly eighty
elements, and forty moments across three actors is several thousand.

Measured on a 40-moment, 3-actor journey (120 nodes): **39 mounted at rest, 69
at mid-page, and an identical document height at every scroll position.**

Four things are never dropped, because dropping them is visible:

- the moment currently being narrated
- anything inside an open expandable
- the focused node, and anything containing the focused element
- everything, during `exportSvg()` and before printing — both call
  `mountAll()` first

Tune with `virtualizeMargin` (default `'150%'`) or switch it off with
`virtualize: false`.

## Live updates — `setJourney()`

Built for the case where an AI is editing mockups mid-conversation. A full
`refresh()` there is hostile: scroll jumps to the top, every expandable slams
shut, and the thing the person was looking at moves.

```js
tool.setJourney({ actors, moments, arrows });   // 'patched' | 'rebuilt'
```

The tool compares a **structural signature** — which moments exist, in what
order, with which cast — and takes one of two paths:

- **`patched`** — same structure, different frame state. Only nodes whose
  frame JSON actually changed re-render. Layout is never touched, the DOM
  nodes are the same objects, scroll does not move. This is the common edit.
- **`rebuilt`** — moments added, removed, reordered, or a cast changed.
  Open expandables, playback cursor, and the reader's place are restored
  afterwards.

Scroll restoration anchors to a **node**, not a pixel offset. Insert a moment
above the viewport and the raw offset would be wrong by exactly that node's
height, so content would jump. Measured: inserting one moment above the fold
at scroll 900 restores to 1091 — the anchor node stays visually fixed.

## PDF

```js
tool.exportPdf({ orientation: 'landscape', pageSize: 'A4' });
```

Deliberately not jsPDF. jsPDF cannot place SVG without svg2pdf, and the usual
fallback — rasterize to canvas, embed a PNG — throws away the one property
that makes these mockups worth exporting: they are vector, so they stay sharp
when someone zooms in on a printed page. The browser's own print pipeline
keeps them vector, handles fonts, and is already installed everywhere.

So this composes a clean print document and hands it over. The disclaimer
repeats in the running footer, for the same reason `exportSvg()` composes it
into the file.

## Parallax

Off by default. `parallax: true` gives three depth layers at slightly
different scroll rates — barriers lag, nodes track exactly, arrows lead — so
the arrows read as strung slightly above the screens.

Only `transform` is written, on its own compositor layer, so a scroll never
repaints the nodes underneath. `prefers-reduced-motion` kills it outright.

It is the least valuable thing in the tool and the most able to ruin a demo
on a mid-tier phone. That is why it is opt-in.

## Known gaps

- The email exporter (canvas rasterization plus table layout) is not built.
  `exportSvg()` and `exportPdf()` are.
- `Q.Tool.mockup`'s mechanical default needs `Q.Template` and the tool's CSS
  loaded; tools that build their body in JS after a `Streams.get` will render
  a skeleton. Hand-write `Q.Tool.mockup()` for those.

## One thing not to change

`ResizeObserver` refreshes **only on width change**. Height changes are
self-inflicted — an expandable opening, a branch panel appearing, a mockup
finishing — and rebuilding on those destroys the thing that caused them.
Height changes redraw the spine and arrow layers instead.
