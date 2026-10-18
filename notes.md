-

# Waypoint Scratch Pad Tracing Example



# Line Word Directive
Change example points to `L0,B0 C20,B3 R0,B0` as it should be rooted to the bottom, not the top of the word box, also with a tension of `1`.


# Oxmarkdown Colors
We need a way to bring color definitions into Oxmarkdown.

I think this should be defined by the front matter, but now that we have `include-ox` we can make a file called `_theme.md` that contains the front matter for the theme.

But, since this is front matter specific, maybe we need a directive that supports just front matter? What are your recommendations on this.



# Wavy Directive
We have the `waypoint` but did we ever build the `wavy` directive?

`::wavy{waypoints="p1, p2, p3}` where p1 would refer to the `::waypoint{id="p1"}` within the file.

## Props
- thickness: 1px by default
- color: Let's have it reflect 

We should have line colors



# Directive Templates
The ability to let files include content:


abc.md:
```
# ABC Oxmarkdown

This file includes an Oxmarkdown template.

Oxmarkdown templates use the file extension `.o.md`.

:::directive{template="xyz"}
  # This is content it can ingest
  So I can put whatever oxmarkdown content here.
:::
```

xyz.o.md
```
# XYZ Oxmarkdown Template
This could be plain oxmarkdown.

:::directiveContent{}
```

The `:::directiveContent{}` is the placeholder for the content from the `:::directive{}`.



# Server Directive
This would be an `o.ts` or `o.tsx` file. Why have this? What value does a server side component acchieve?
