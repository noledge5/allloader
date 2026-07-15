# Cove is LAN-reachable with no access control

Cove runs on the user's Windows PC and its GUI is a headline "media-center" surface
meant to be used from a phone, tablet, or TV browser on the same home network.

**Decision.** Bind the server to the local network (`0.0.0.0`) so any device on the LAN
can reach it, with **no authentication** — no token, PIN, or login.

**Why it's recorded.** A future reader will see a downloader that spends real Claude API
credit and controls a NAS, exposed on the network with no auth, and reasonably ask "was
this on purpose?" It was: the user chose convenience on a trusted home network over
access control.

**Consequences / risk.** Anything on the LAN — including a compromised IoT device — can
queue and cancel downloads, browse the **Catalog**, and trigger **Intake**/**Triage**,
which cost the user's API credit. This is acceptable only on a fully trusted network. A
shared token or PIN is a small, self-contained add if the posture ever needs tightening;
the code should keep the request-handling layer auth-ready so adding it later is a middle
ware change, not a rewrite.
