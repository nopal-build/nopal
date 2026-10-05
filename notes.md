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


# WIP: Circular References
Circular references, how are we handling that potential? There isn't a use case where a.md includes b.md and b.md includes a.md.

These are not allowed:
`a -> a`
`a -> b -> a`
`a -> b -> ... -> a`

What can happen: `a` includes `b` which includes `c` & `a` includes `c`

In this case C was included in two different files in the same markdown but they never reference `a`