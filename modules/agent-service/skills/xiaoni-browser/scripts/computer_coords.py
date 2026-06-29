"""Coordinate mapping for the computer_20251124 tool over the host-Chrome bridge.

The model is told it sees a FIXED display (DECLARED_W x DECLARED_H). We always
deliver screenshots resized to exactly that, so the model's coordinate space is
constant regardless of the real window size or devicePixelRatio. Every action
coordinate the model returns is in DECLARED space and must be mapped back to the
live page's CSS pixels before we hand it to Playwright's page.mouse (which takes
CSS px, not device px).

    model space (DECLARED_W x DECLARED_H)          live page (CSS innerWidth x innerHeight, DPR d)
        (x, y)  ──────────────────────────────►  cssX = x * innerW/DECLARED_W
                                                  cssY = y * innerH/DECLARED_H
        screenshot: page.screenshot() is captured at innerW*d x innerH*d device px,
        then resized to DECLARED_W x DECLARED_H before it goes to the model. The
        resize (done by the image lib on the bridge) absorbs both DPR and window
        size; this module only owns the action-coordinate direction.

Per-axis linear scaling is used. To avoid distortion the bridge SHOULD pick a
DECLARED aspect ratio close to the live viewport (see choose_declared); when they
match, x and y scale by the same factor.
"""

from __future__ import annotations

# Fallback declared size only — the live path receives display_width_px/height_px
# from agent-loop (COMPUTER_USE_DISPLAY_*) and passes them explicitly to map_point,
# so these constants are not used when the bridge is driven normally. Kept in sync
# with agent-loop: ~2.03:1 to match Xiaoni's Chrome viewport (native 2561x1263 @
# DPR2), well under Anthropic's ~1280 long-edge guidance to cut image tokens.
DECLARED_W = 1024
DECLARED_H = 506


def choose_declared(live_w: int, live_h: int, long_edge: int = 1280) -> tuple[int, int]:
    """Pick a DECLARED size matching the live aspect ratio, capped at long_edge.

    Keeping the declared aspect ratio equal to the live viewport means x and y
    share one scale factor, so there is no distortion. Falls back to the live
    size itself when it is already smaller than long_edge.
    """
    if live_w <= 0 or live_h <= 0:
        return DECLARED_W, DECLARED_H
    if max(live_w, live_h) <= long_edge:
        return live_w, live_h
    if live_w >= live_h:
        w = long_edge
        h = max(1, round(live_h * long_edge / live_w))
    else:
        h = long_edge
        w = max(1, round(live_w * long_edge / live_h))
    return w, h


def _clampi(v: float, lo: int, hi: int) -> int:
    iv = int(round(v))
    if iv < lo:
        return lo
    if iv > hi:
        return hi
    return iv


def map_point(
    x: float,
    y: float,
    live_w: int,
    live_h: int,
    declared_w: int = DECLARED_W,
    declared_h: int = DECLARED_H,
) -> tuple[int, int]:
    """Map a model-space (x, y) to live CSS pixels, rounded and clamped in-bounds.

    Clamps to [0, live_w-1] x [0, live_h-1] so a click is always inside the page
    (the model occasionally returns a coordinate one past the edge).
    """
    if declared_w <= 0 or declared_h <= 0:
        raise ValueError("declared dimensions must be positive")
    css_x = x * (live_w / declared_w)
    css_y = y * (live_h / declared_h)
    return _clampi(css_x, 0, max(0, live_w - 1)), _clampi(css_y, 0, max(0, live_h - 1))


def map_region(
    region: list[float],
    live_w: int,
    live_h: int,
    declared_w: int = DECLARED_W,
    declared_h: int = DECLARED_H,
) -> tuple[int, int, int, int]:
    """Map a zoom region [x1, y1, x2, y2] (model space) to live CSS px.

    Normalizes corner order so x1<=x2, y1<=y2. Used to crop the live screenshot
    for the `zoom` action before resizing the crop back to the declared display.
    """
    if len(region) != 4:
        raise ValueError("region must be [x1, y1, x2, y2]")
    x1, y1 = map_point(region[0], region[1], live_w, live_h, declared_w, declared_h)
    x2, y2 = map_point(region[2], region[3], live_w, live_h, declared_w, declared_h)
    return (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))
