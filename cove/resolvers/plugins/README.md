# Resolver plugins

Drop a `.py` file here (or in `$COVE_RESOLVER_PLUGINS`) that defines a subclass of
`cove.resolvers.base.Resolver`:

```python
from cove.resolvers.base import Resolver

class MyHostResolver(Resolver):
    name = "myhost"
    def matches(self, url: str) -> bool:
        return "myhost." in url
    def resolve(self, url: str) -> str | None:
        # Return a concrete .m3u8 / .mp4 URL, or None.
        ...
```

Plugins are tried before Cove's generic headless-browser fallback. Cove intentionally
ships **no** per-host deobfuscation resolvers (see `docs/adr/0001-streamhoster-resolution.md`);
supply your own here.
