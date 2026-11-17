import math
import re
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np

import xmas_tree as xt

ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
HERE = Path(__file__).parent
LETTERS = set("MERYCHISTA")          # "MERRY CHRISTMAS" 에 쓰인 글자
GROWN = xt.GROW_SECONDS + 4.0        # 다 자라고 장식이 붙은 뒤의 시각


def view(grid):
    return grid.chars[: grid.height - xt.HUD_ROWS]


class ZBuffer(unittest.TestCase):
    def test_nearest_point_wins_per_cell(self):
        keys = np.array([5, 5, 5, 9])
        z = np.array([0.3, -0.2, 0.1, 0.0])
        self.assertEqual(sorted(xt.zbuffer_pick(keys, z).tolist()), [1, 3])

    def test_result_does_not_depend_on_input_order(self):
        rng = np.random.default_rng(0)
        keys = rng.integers(0, 20, 200)
        z = rng.uniform(-1, 1, 200)
        base = {(int(keys[i]), float(z[i])) for i in xt.zbuffer_pick(keys, z)}
        for _ in range(5):
            perm = rng.permutation(200)
            shuffled = {(int(keys[perm][i]), float(z[perm][i])) for i in xt.zbuffer_pick(keys[perm], z[perm])}
            self.assertEqual(base, shuffled)

    def test_empty_input(self):
        self.assertEqual(xt.zbuffer_pick(np.array([], dtype=np.int64), np.array([])).size, 0)


class Allocate(unittest.TestCase):
    def test_sums_exactly_and_every_share_is_at_least_one(self):
        w = np.array([0.1, 0.5, 0.9, 0.3, 0.7])
        for total in (5, 6, 100, 8500):
            a = xt.allocate(total, w)
            self.assertEqual(int(a.sum()), total)
            self.assertTrue((a >= 1).all())

    def test_longer_branches_get_more_letters(self):
        a = xt.allocate(1000, np.array([0.2, 0.4, 0.8]))
        self.assertTrue(a[0] < a[1] < a[2])

    def test_rejects_too_few_letters(self):
        with self.assertRaises(ValueError):
            xt.allocate(3, np.ones(5))


class Geometry(unittest.TestCase):
    def test_rotation_preserves_distance_from_axis_and_wraps_at_360(self):
        pts = np.random.default_rng(1).uniform(-1, 1, (50, 3))
        rot = xt.rotate_y(pts, 1.234)
        self.assertTrue(np.allclose(np.hypot(pts[:, 0], pts[:, 2]), np.hypot(rot[:, 0], rot[:, 2])))
        self.assertTrue(np.allclose(rot[:, 1], pts[:, 1]))
        self.assertTrue(np.allclose(xt.rotate_y(pts, 2 * math.pi), pts))

    def test_quarter_turn_moves_x_axis_onto_z_axis(self):
        r = xt.rotate_y(np.array([[1.0, 0.0, 0.0]]), math.pi / 2)
        self.assertTrue(np.allclose(r, [[0.0, 0.0, -1.0]], atol=1e-12))

    def test_projection_is_periodic_in_360_degrees(self):
        s = xt.Scene(100, 40)
        for u, v in zip(s.project(s.foliage, 37.0), s.project(s.foliage, 397.0)):
            self.assertTrue(np.array_equal(u, v) if u.dtype.kind == "i" else np.allclose(u, v))

    def test_horizontal_is_stretched_by_the_character_aspect_ratio(self):
        # 월드에서 같은 길이(0.9)가 가로로는 세로의 ASPECT 배 칸을 차지해야 둥글게 보인다
        s = xt.Scene(300, 120)
        cx, cy, _ = s.project(np.array([[0.9, 0.0, 0.0], [0.0, 0.9, 0.0], [0.0, 0.0, 0.0]]), 0.0)
        dx, dy = cx[0] - cx[2], cy[2] - cy[1]
        self.assertGreater(dy, 25)                # 반올림 오차(±1칸)가 비율에 크게 안 끼치도록
        self.assertAlmostEqual(dx / dy, xt.ASPECT, delta=0.1)

    def test_nearer_points_look_bigger(self):
        s = xt.Scene(300, 120)
        near = s.project(np.array([[0.5, 0.0, -0.5]]), 0.0)[0][0] - s.cx
        far = s.project(np.array([[0.5, 0.0, 0.5]]), 0.0)[0][0] - s.cx
        self.assertGreater(near, far)

    def test_every_letter_stays_on_screen_at_every_angle_and_size(self):
        for w, h in [(40, 20), (80, 24), (100, 40), (200, 60)]:
            s = xt.Scene(w, h)
            pts = np.vstack([s.foliage, s.ornaments, s.garland])
            for angle in range(0, 360, 15):
                cx, cy, _ = s.project(pts, angle)
                self.assertTrue(((cx >= 0) & (cx < s.width)).all(), f"{w}x{h} @{angle} 가로 밖")
                self.assertTrue(((cy >= 0) & (cy < s.view_rows)).all(), f"{w}x{h} @{angle} 세로 밖")


class SceneContent(unittest.TestCase):
    def test_letter_count_and_alphabet(self):
        s = xt.Scene(100, 40)
        self.assertEqual(len(s.foliage), 8500)
        self.assertTrue(set(s.foliage_chars) <= LETTERS)
        self.assertEqual(len(xt.Scene(100, 40, letters=1000).foliage), 1000)
        self.assertEqual(len(xt.Scene(100, 40, letters=xt.MIN_LETTERS).foliage), xt.MIN_LETTERS)

    def test_invalid_arguments(self):
        with self.assertRaises(ValueError):
            xt.Scene(100, 40, letters=xt.MIN_LETTERS - 1)
        with self.assertRaises(ValueError):
            xt.Scene(100, 40, text="   ")

    def test_position_along_branch_matches_distance_from_the_trunk(self):
        s = xt.Scene(100, 40)
        dist = np.hypot(s.foliage[:, 0], s.foliage[:, 2])
        self.assertGreater(np.corrcoef(s.foliage_s, dist)[0, 1], 0.7)       # 끝쪽(s 큼)일수록 줄기에서 멀다
        inner, outer = s.foliage_s < 0.3, s.foliage_s > 0.9
        self.assertGreater(dist[outer].mean(), 2.0 * dist[inner].mean())

    def test_branch_tips_hang_lower_than_their_roots_in_every_tier(self):
        s = xt.Scene(100, 40)
        for tier in range(xt.TIERS):
            in_tier = s.foliage_tier == tier
            root = s.foliage[in_tier & (s.foliage_s < 0.2)][:, 1].mean()
            tip = s.foliage[in_tier & (s.foliage_s > 0.8)][:, 1].mean()
            self.assertLess(tip, root - 0.05, f"{tier}번째 층: 끝 {tip:.3f} 이 뿌리 {root:.3f} 보다 충분히 낮아야 함")

    def test_growth_starts_at_453_and_is_monotonic_until_complete(self):
        s = xt.Scene(100, 40)
        self.assertEqual(s.visible_letters(0.0), 453)
        counts = [s.visible_letters(t / 10) for t in range(0, 200)]
        self.assertEqual(counts, sorted(counts))
        self.assertEqual(s.visible_letters(xt.GROW_SECONDS), 8500)
        self.assertEqual(s.visible_letters(999.0), 8500)
        self.assertEqual(xt.Scene(100, 40, letters=xt.MIN_LETTERS).visible_letters(0.0), xt.MIN_LETTERS)  # 453 보다 적으면 전부

    def test_lights_ramp_up_after_growth_starts_and_never_exceed_total(self):
        s = xt.Scene(100, 40, lights=170)
        self.assertEqual(s.lit_lights(0.0), 0)
        self.assertEqual(s.lit_lights(xt.LIGHT_START - 0.01), 0)
        self.assertEqual(s.lit_lights(xt.LIGHT_START), 1)
        counts = [s.lit_lights(t / 10) for t in range(0, 400)]
        self.assertEqual(counts, sorted(counts))
        self.assertEqual(max(counts), 170)
        self.assertEqual(xt.Scene(100, 40, lights=0).lit_lights(99), 0)
        self.assertEqual(xt.Scene(100, 40, lights=10**6).light_count, 8500)   # 잎 글자 수로 제한

    def test_ornaments_wait_for_their_branch_to_grow(self):
        s = xt.Scene(100, 40)
        self.assertEqual(s.ornament_count, 26)
        self.assertTrue((s.ornament_at > 453).all())                           # t=0 엔 하나도 안 보인다
        self.assertTrue((s.ornament_at <= 8500).all())                         # 다 자라면 모두 보인다
        self.assertEqual(xt.Scene(100, 40, ornaments=10**6).ornament_count, s.branch_count)

    def test_hud_text(self):
        s = xt.Scene(100, 40)
        top, lines = s.hud_lines(0.0, 0)
        self.assertEqual(top, "t 00:00s")
        self.assertEqual(lines[0], "rotation 000.00\N{DEGREE SIGN}     lights 0")
        self.assertEqual(lines[1], "letters 453")
        self.assertEqual(s.hud_lines(12.0, 3)[1][1], "letters 8,500")        # 천 단위 쉼표
        self.assertEqual(s.hud_lines(75.0, 3)[0], "t 01:15s")
        self.assertIn("rotation 090.00", s.hud_lines(6.0, 0)[1][0])         # 15°/초 × 6초
        self.assertIn("rotation 000.00", s.hud_lines(24.0, 0)[1][0])        # 360° 는 0° 로 접힌다


class Frames(unittest.TestCase):
    def test_deterministic_for_same_seed_and_time(self):
        a, b = xt.Scene(80, 30, seed=3).frame(4.2), xt.Scene(80, 30, seed=3).frame(4.2)
        self.assertTrue(np.array_equal(a.chars, b.chars))
        self.assertTrue(np.array_equal(a.colors, b.colors))

    def test_changes_over_time_and_with_seed(self):
        s = xt.Scene(80, 30)
        self.assertFalse(np.array_equal(s.frame(14.0).chars, s.frame(14.4).chars))
        self.assertFalse(np.array_equal(xt.Scene(80, 30, seed=1).frame(14.0).chars, xt.Scene(80, 30, seed=2).frame(14.0).chars))

    def test_grid_shape_and_no_crash_for_many_times_and_sizes(self):
        for w, h in [(20, 10), (30, 12), (80, 24), (250, 70)]:
            s = xt.Scene(w, h)
            for t in (0.0, 0.5, 1.0, 3.3, 9.9, 14.0, 59.9, 3600.0):
                g = s.frame(t)
                self.assertEqual((g.height, g.width), (s.height, s.width))
                self.assertEqual(g.colors.shape, (s.height, s.width, 3))

    def test_tree_grows_from_a_few_letters_to_a_full_tree(self):
        s = xt.Scene(100, 40)
        count = lambda t: int(np.isin(view(s.frame(t)), list(LETTERS)).sum())
        c0, c5, c10 = count(0.0), count(5.0), count(xt.GROW_SECONDS)
        self.assertLess(c0, c5)
        self.assertLess(c5, c10)
        self.assertLess(c0 * 4, c10)             # 실측 81 → 519칸. 8,500 글자가 겹쳐도 칸은 수백 개 채워진다
        self.assertGreater(count(GROWN), 300)    # 다 자란 뒤엔 황금 줄·전구가 글자 일부를 덮는다(실측 467)

    def test_decorations_appear_only_after_the_tree_is_grown(self):
        s = xt.Scene(100, 40)
        g0, g1 = view(s.frame(0.0)), view(s.frame(GROWN))
        self.assertEqual(int((g0 == "*").sum()), 0)            # 황금 줄·별 중심
        self.assertEqual(int((g0 == "|").sum()), 0)            # 별 광선
        self.assertEqual(int((g0 == "O").sum()), 0)            # 장식 공·밝은 전구
        self.assertGreater(int((g1 == "*").sum()), 50)
        self.assertGreater(int((g1 == "|").sum()), 0)
        self.assertGreater(int((g1 == "O").sum()), 0)

    def test_garland_winds_down_gradually_from_the_top(self):
        s = xt.Scene(100, 40)
        total = len(s.garland_u)
        n = lambda t: int(s.garland_mask(t).sum())
        self.assertEqual(n(0.0), 0)
        self.assertEqual(n(0.7 * xt.GROW_SECONDS), 0)
        counts = [n(t / 10) for t in range(0, 250)]
        self.assertEqual(counts, sorted(counts))                  # 줄어들지 않는다
        self.assertEqual(n(GROWN), total)                         # 끝에는 전부 감긴다
        mid = n(0.95 * xt.GROW_SECONDS)
        self.assertTrue(0 < mid < total, f"중간 시점에 일부만 감겨야 함({mid}/{total})")
        mask = s.garland_mask(0.95 * xt.GROW_SECONDS)
        self.assertLessEqual(s.garland_u[mask].max(), s.garland_u[~mask].min())   # 보이는 점은 항상 위쪽(u 작은 쪽)

    def test_star_rays_never_cover_tree_letters_but_the_center_does(self):
        s = xt.Scene(100, 40)
        full = np.full((s.height, s.width), "X", dtype="<U1")
        colors = np.zeros((s.height, s.width, 3), dtype=np.uint8)
        s._draw_star(full, colors, GROWN)
        self.assertEqual(int((full != "X").sum()), 1)             # 가운데 '*' 한 칸만 덮는다
        empty = np.full((s.height, s.width), " ", dtype="<U1")
        s._draw_star(empty, colors.copy(), GROWN)
        self.assertGreater(int((empty != " ").sum()), 20)         # 빈 하늘에는 광선이 길게 그려진다

    def test_lights_twinkle_between_small_and_bright(self):
        s = xt.Scene(100, 40, ornaments=0)                        # 'O' 가 전구 말고는 없게
        counts = [int((view(s.frame(t)) == "O").sum()) for t in np.linspace(GROWN, GROWN + 6, 40)]
        self.assertGreater(max(counts), 0)                        # 밝게 켜진 순간이 있고
        self.assertGreater(len(set(counts)), 1)                   # 시간에 따라 변한다

    def test_star_rays_are_above_the_tree_and_centered(self):
        g = xt.Scene(100, 40).frame(GROWN)
        ys, xs = np.nonzero(view(g) == "|")
        self.assertTrue(len(ys))
        self.assertLess(ys.min(), 8)
        self.assertTrue(all(abs(int(x) - 49) <= 2 for x in xs))

    def test_depth_shading_makes_far_letters_darker(self):
        s = xt.Scene(100, 40, lights=0, ornaments=0)
        s.foliage_light[:] = 1.0                 # 안쪽/바깥 명암과 난수 편차를 없애 깊이 음영만 남긴다
        s.foliage_glint[:] = False
        g = s.frame(GROWN)
        mask = np.isin(view(g), list(LETTERS))
        green = g.colors[: g.height - xt.HUD_ROWS][..., 1][mask]
        self.assertGreater(int(green.max()) - int(green.min()), 50)

    def test_inner_parts_are_darker_than_branch_tips(self):
        s = xt.Scene(100, 40)
        inner, outer = s.foliage_s < 0.2, s.foliage_s > 0.8
        self.assertLess(s.foliage_light[inner].mean() * 1.5, s.foliage_light[outer].mean())

    def test_hud_rows_contain_only_the_hud_text(self):
        s = xt.Scene(100, 40)
        for t in (0.0, 5.0, GROWN):
            g = s.frame(t)
            _, lines = s.hud_lines(t, s.lit_lights(t))
            for k, expected in enumerate(lines):
                row = "".join(g.chars[g.height - xt.HUD_ROWS + k]).rstrip()
                self.assertEqual(row, " " + expected, f"t={t} HUD {k}번째 줄에 다른 글자가 섞임")

    def test_floor_is_below_the_tree_and_inside_the_view(self):
        s = xt.Scene(100, 40)
        g = s.frame(GROWN)
        rows = [y for y in range(s.view_rows) if "-" in "".join(g.chars[y]) and int(np.isin(g.chars[y], list("-")).sum()) > 20]
        self.assertGreaterEqual(len(rows), 2)
        self.assertTrue(all(y < s.view_rows for y in rows))

    def test_snow_falls_down_and_stays_on_screen(self):
        sc = xt.Scene(100, 40)
        total_fall = np.zeros(len(sc.snow_y))
        for t in np.arange(0.0, 5.0, 0.1):
            x0, y0 = sc.snow_at(t)
            x1, y1 = sc.snow_at(t + 0.1)
            self.assertTrue(((x1 >= 0) & (x1 < sc.width) & (y1 >= 0) & (y1 < sc.view_rows)).all())
            step = (y1 - y0) % sc.view_rows              # 위로 올라가면 view_rows 에 가까운 큰 값이 나온다
            self.assertTrue((step <= 1).all(), f"t={t:.1f} 한 번에 {step.max()}칸 이동(≤1 이어야 아래로 천천히 낙하)")
            total_fall += step
        self.assertTrue((total_fall > 0).all())          # 모든 눈송이가 실제로 내려온다


class Output(unittest.TestCase):
    def test_plain_has_no_escape_codes_and_matches_ansi_text(self):
        g = xt.Scene(60, 24).frame(GROWN)
        plain, ansi = xt.to_plain(g), xt.to_ansi(g)
        self.assertNotIn("\x1b", plain)
        self.assertIn("\x1b[38;2;", ansi)
        self.assertTrue(all(line.endswith("\x1b[0m") for line in ansi.split("\n")))
        stripped = "\n".join(line.rstrip() for line in ANSI.sub("", ansi).split("\n"))
        self.assertEqual(stripped, plain)

    def test_ansi_merges_runs_of_same_color(self):
        g = xt.Grid(np.full((1, 6), "A", dtype="<U1"), np.tile(np.array([10, 20, 30], dtype=np.uint8), (1, 6, 1)))
        self.assertEqual(xt.to_ansi(g).count("\x1b[38;2;"), 1)

    def test_a_full_frame_fits_the_30fps_budget(self):
        import time
        s = xt.Scene(100, 40)
        s.frame(GROWN)                              # 예열
        t0 = time.perf_counter()
        for i in range(10):
            xt.to_ansi(s.frame(GROWN + i / 30))
        per_frame = (time.perf_counter() - t0) / 10
        self.assertLess(per_frame, 1 / 30, f"프레임당 {per_frame * 1000:.1f}ms")


class CommandLine(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run([sys.executable, "-I", str(HERE / "xmas_tree.py"), *args], capture_output=True, text=True, timeout=60)

    def test_frames_mode_prints_requested_number_of_frames(self):
        r = self.run_cli("--frames", "3", "--plain", "--width", "60", "--height", "24", "--start", "12")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.count("letters 8,500"), 3)
        self.assertNotIn("\x1b", r.stdout)

    def test_custom_letters_option(self):
        r = self.run_cli("--frames", "1", "--plain", "--width", "60", "--height", "24", "--start", "12", "--letters", "2000")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("letters 2,000", r.stdout)

    def test_bad_arguments_exit_with_usage_error(self):
        self.assertEqual(self.run_cli("--letters", str(xt.MIN_LETTERS - 1)).returncode, 2)
        self.assertEqual(self.run_cli("--fps", "0").returncode, 2)


if __name__ == "__main__":
    unittest.main()
