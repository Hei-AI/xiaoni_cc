"""Unit tests for computer_coords — run: python3 -m pytest test_computer_coords.py
or plain: python3 test_computer_coords.py
"""
import computer_coords as cc


def _check(name, got, want):
    assert got == want, f"{name}: got {got!r}, want {want!r}"


# These tests exercise the mapper math against an explicit declared=1280x800 so
# they stay independent of the production DECLARED_* constant (the live path always
# passes display_width_px/height_px explicitly; the constant is only a fallback).
def test_identity_when_live_equals_declared():
    # live viewport == declared -> coords pass through unchanged
    _check("center", cc.map_point(640, 400, 1280, 800, 1280, 800), (640, 400))
    _check("origin", cc.map_point(0, 0, 1280, 800, 1280, 800), (0, 0))


def test_downscale_live_smaller_than_declared():
    # live 640x400, declared 1280x800 -> half on each axis
    _check("full-edge", cc.map_point(1280, 800, 640, 400, 1280, 800), (639, 399))  # full extent, clamped to w-1,h-1
    _check("mid", cc.map_point(640, 400, 640, 400, 1280, 800), (320, 200))


def test_upscale_live_larger_than_declared():
    # live 2560x1600, declared 1280x800 -> x2 on each axis
    _check("double", cc.map_point(640, 400, 2560, 1600, 1280, 800), (1280, 800))


def test_clamp_out_of_bounds():
    # model returns a coord past the edge -> clamped into the page
    _check("past-right", cc.map_point(2000, 400, 1280, 800, 1280, 800), (1279, 400))
    _check("past-bottom", cc.map_point(640, 2000, 1280, 800, 1280, 800), (640, 799))
    _check("negative", cc.map_point(-5, -5, 1280, 800, 1280, 800), (0, 0))


def test_rounding():
    # 1281-wide live, declared 1280 -> 1.000781 scale, rounds to nearest int
    _check("round", cc.map_point(100, 100, 1281, 801, 1280, 800), (100, 100))
    _check("round2", cc.map_point(1000, 500, 1281, 801, 1280, 800), (1001, 501))


def test_choose_declared_keeps_aspect():
    # 1920x1080 (16:9) capped at 1280 long edge -> 1280x720, same ratio
    _check("16:9", cc.choose_declared(1920, 1080), (1280, 720))
    # already small -> unchanged
    _check("small", cc.choose_declared(1000, 700), (1000, 700))
    # already-small portrait window stays unchanged (under the 1280 cap)
    _check("portrait-small", cc.choose_declared(600, 1200), (600, 1200))
    # tall window over the cap -> cap the height, scale width to keep ratio
    _check("portrait-cap", cc.choose_declared(600, 1600), (480, 1280))


def test_choose_declared_no_distortion_roundtrip():
    # with a matched declared aspect, x and y share one scale factor
    dw, dh = cc.choose_declared(1920, 1080)  # 1280x720
    # a point at declared center maps to live center, both axes consistent
    _check("center-x", cc.map_point(dw / 2, dh / 2, 1920, 1080, dw, dh), (960, 540))


def test_map_region_normalizes_and_maps():
    # region in declared space -> live CSS px, corners normalized
    got = cc.map_region([100, 100, 300, 200], 1280, 800, 1280, 800)
    _check("region", got, (100, 100, 300, 200))
    # reversed corners get normalized
    got2 = cc.map_region([300, 200, 100, 100], 640, 400, 1280, 800)
    _check("region-rev", got2, (50, 50, 150, 100))


def test_bad_inputs():
    try:
        cc.map_point(1, 1, 100, 100, 0, 100)
        assert False, "expected ValueError on zero declared width"
    except ValueError:
        pass
    try:
        cc.map_region([1, 2, 3], 100, 100)
        assert False, "expected ValueError on 3-element region"
    except ValueError:
        pass


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  ok  {fn.__name__}")
    print(f"\n{passed}/{len(fns)} passed")
