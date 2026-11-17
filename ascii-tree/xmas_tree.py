#!/usr/bin/env python3
"""회전하는 ASCII 크리스마스 트리 (터미널, NumPy).

나무는 층(tier)마다 가지(branch)를 방사형으로 뻗고, 가지마다 글자 수백 개를 뿌려 만든다.
줄기에서 바깥으로 자라고(letters 가 늘어남), 다 자라면 황금 전구 줄·장식 공·반짝이는 전구·별이 붙는다.
3D 회전 → 원근 투영 → z-버퍼(가까운 글자가 이김) → 24비트 ANSI 색으로 그린다.

사용:  python3 xmas_tree.py                         # Ctrl-C 로 종료
       python3 xmas_tree.py --frames 1 --start 14 --plain   # 다 자란 모습을 글자로 한 장 출력
"""
from __future__ import annotations

import argparse
import math
import shutil
import sys
import time
from dataclasses import dataclass

import numpy as np

TAU = 2.0 * math.pi
ASPECT = 2.0            # 터미널 글자 칸은 가로:세로 ≈ 1:2 라서 가로를 두 배로 늘린다
CAMERA = 4.5            # 카메라까지의 거리(월드 단위)
TREE_TOP, TREE_BOTTOM, TRUNK_BOTTOM = 1.0, -0.45, -1.1
RADIUS = 0.85           # 맨 아래 층의 가지 길이
TIERS = 9               # 가지 층 수(적을수록 층 사이 물결 윤곽이 뚜렷)
HUD_ROWS = 3            # 화면 아래 HUD 줄 수
GROW_SECONDS = 10.0     # 나무가 자라는 시간
INITIAL_LETTERS = 453   # t=0 에 이미 보이는 글자 수
LIGHT_START = 0.6 * GROW_SECONDS
LIGHT_INTERVAL = 0.04   # 전구가 하나씩 켜지는 간격(초)
GOLDEN = 0.618
DROOP = 0.42            # 가지 끝이 처지는 정도
ORNAMENT_COLORS = np.array([[225, 45, 55], [240, 190, 60], [90, 140, 235], [225, 225, 235]], dtype=np.float64)
LIGHT_COLORS = np.array([[255, 235, 170], [255, 200, 90], [255, 90, 90], [120, 170, 255], [255, 255, 255]], dtype=np.float64)
GARLAND_COLOR = np.array([245.0, 190.0, 70.0])


def tier_layout() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """층의 (높이, 꼭대기로부터의 비율 0..1, 가지 수). 아래층일수록 가지가 많다."""
    ys = np.linspace(TREE_TOP - 0.12, TREE_BOTTOM + 0.05, TIERS)
    frac = (TREE_TOP - ys) / (TREE_TOP - TREE_BOTTOM)
    return ys, frac, (6 + 10 * frac).astype(int)


MIN_LETTERS = int(tier_layout()[2].sum())   # 가지마다 글자가 하나는 있어야 한다


@dataclass
class Grid:
    """한 프레임: 글자 격자와 글자별 RGB."""

    chars: np.ndarray   # (H, W) 유니코드 한 글자
    colors: np.ndarray  # (H, W, 3) uint8

    @property
    def height(self) -> int:
        return self.chars.shape[0]

    @property
    def width(self) -> int:
        return self.chars.shape[1]


def smoothstep(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3.0 - 2.0 * x)


def zbuffer_pick(keys: np.ndarray, z: np.ndarray) -> np.ndarray:
    """같은 칸(keys)에 겹친 점 중 z 가 가장 작은(가장 가까운) 점의 인덱스만 돌려준다. 결정적.

    NumPy 의 중복 인덱스 대입은 마지막 값이 이긴다고 보장하지 않으므로, 정렬로 직접 고른다.
    """
    if keys.size == 0:
        return np.empty(0, dtype=np.int64)
    order = np.lexsort((z, keys))              # keys 순, 같은 keys 안에서는 z 오름차순
    sk = keys[order]
    first = np.concatenate(([True], sk[1:] != sk[:-1]))
    return order[first]


def rotate_y(points: np.ndarray, angle: float) -> np.ndarray:
    """y 축 둘레로 angle(라디안) 만큼 회전."""
    c, s = math.cos(angle), math.sin(angle)
    x = points[:, 0] * c + points[:, 2] * s
    z = -points[:, 0] * s + points[:, 2] * c
    return np.stack([x, points[:, 1], z], axis=1)


def allocate(total: int, weights: np.ndarray) -> np.ndarray:
    """total 을 weights 비율로 나눠 정수 합이 정확히 total 이 되게 한다(최대 잔여법). 각 몫은 1 이상."""
    n = len(weights)
    if total < n:
        raise ValueError(f"글자 수({total})가 가지 수({n})보다 적을 수 없음")
    share = weights / weights.sum() * (total - n)
    base = np.floor(share).astype(np.int64)
    rest = total - n - int(base.sum())
    if rest:
        base[np.argsort(-(share - base), kind="stable")[:rest]] += 1
    return base + 1


class Scene:
    def __init__(self, width: int, height: int, letters: int = 8500, text: str = "MERRY CHRISTMAS",
                 lights: int = 170, ornaments: int = 26, seed: int = 7,
                 degrees_per_sec: float = 15.0, fps: int = 30):
        if not any(ch.strip() for ch in text):
            raise ValueError("text 에 글자가 하나는 있어야 함")
        if letters < MIN_LETTERS:
            raise ValueError(f"letters 는 {MIN_LETTERS} 이상이어야 함(가지마다 글자가 1개 이상 필요)")
        self.letter_total = letters
        self.deg_per_sec = degrees_per_sec
        self.fps = fps
        self.seed = seed
        self._build_world(letters, text, max(0, lights), max(0, ornaments))
        self.resize(width, height)

    # ---- 월드 -----------------------------------------------------------
    def _build_world(self, total: int, text: str, n_lights: int, n_ornaments: int) -> None:
        rng = np.random.default_rng(self.seed)
        ys, frac, per_tier = tier_layout()
        tier_len = 0.12 + (RADIUS - 0.12) * frac                               # 층별 가지 길이(원뿔)

        br_tier, br_angle, br_len = [], [], []
        for ti in range(TIERS):
            for b in range(per_tier[ti]):
                br_tier.append(ti)
                br_angle.append(TAU * b / per_tier[ti] + ti * GOLDEN * TAU + rng.normal(0, 0.12))
                br_len.append(tier_len[ti] * rng.uniform(0.85, 1.08))
        br_tier, br_angle, br_len = np.array(br_tier), np.array(br_angle), np.array(br_len)
        self.branch_count = len(br_tier)
        counts = allocate(total, br_len)

        owner = np.repeat(np.arange(self.branch_count), counts)               # 점마다 가지 번호
        n = len(owner)
        s = rng.random(n) ** 0.65                                              # 가지 따라 위치(끝쪽에 몰림)
        a, L, ti = br_angle[owner], br_len[owner], br_tier[owner]
        rad = s * L
        spread = (0.03 + 0.10 * s) * rng.normal(size=n)                        # 가지 옆으로 퍼짐
        droop = DROOP * s ** 1.7 * (L / RADIUS + 0.35)                         # 수평으로 뻗다가 끝에서 처짐
        x = np.cos(a) * rad - np.sin(a) * spread
        z = np.sin(a) * rad + np.cos(a) * spread
        y = ys[ti] - droop + rng.normal(0, 0.025, size=n)
        self.foliage = np.stack([x, y, z], axis=1)
        self.foliage_s = s
        self.foliage_tier = ti
        tint = rng.uniform(0.75, 1.0, size=n) * rng.uniform(0.9, 1.0, size=self.branch_count)[owner]
        self.foliage_tint = tint
        self.foliage_light = tint * (0.30 + 0.70 * s ** 0.8)                   # 안쪽(줄기 쪽)은 어둡고 가지 끝은 밝다
        self.foliage_glint = rng.random(n) < 0.025                             # 군데군데 반짝이는 잎
        pool = [c for c in text if c.strip()]
        self.foliage_chars = np.array(pool)[rng.integers(0, len(pool), size=n)]

        # 자라는 순서: 줄기 가까운 곳·꼭대기부터 바깥·아래로
        key = 0.75 * s + 0.25 * frac[ti] + rng.normal(0, 0.03, size=n)
        self.rank = np.argsort(np.argsort(key, kind="stable"), kind="stable")  # 점마다 몇 번째로 자라나
        self._sorted_key = np.sort(key)

        ring = np.linspace(0, TAU, 8, endpoint=False)
        ty = np.linspace(TREE_BOTTOM + 0.2, TRUNK_BOTTOM, 8)
        self.trunk = np.array([[0.09 * math.cos(r), yy, 0.09 * math.sin(r)] for yy in ty for r in ring])

        # 장식 공: 가지 끝에, 그 가지가 자란 뒤에 나타난다
        k = min(n_ornaments, self.branch_count)
        pick = rng.choice(self.branch_count, size=k, replace=False)
        tip_droop = DROOP * (br_len[pick] / RADIUS + 0.35)
        self.ornaments = np.stack([
            np.cos(br_angle[pick]) * br_len[pick] * 1.0,
            ys[br_tier[pick]] - tip_droop + 0.02,
            np.sin(br_angle[pick]) * br_len[pick] * 1.0,
        ], axis=1)
        self.ornament_rgb = ORNAMENT_COLORS[rng.integers(0, len(ORNAMENT_COLORS), size=k)]
        tip_key = 0.75 + 0.25 * frac[br_tier[pick]]
        self.ornament_at = np.searchsorted(self._sorted_key, tip_key)          # 이만큼 자라면 보인다
        self.ornament_count = k

        # 전구: 잎 위의 점 몇 개를 골라 살짝 바깥에 둔다
        m = min(n_lights, n)
        idx = rng.choice(n, size=m, replace=False)
        self.lights = self.foliage[idx] * np.array([1.06, 1.0, 1.06])
        self.light_phase = rng.uniform(0, TAU, size=m)
        self.light_rgb = LIGHT_COLORS[rng.integers(0, len(LIGHT_COLORS), size=m)]
        self.light_count = m

        # 황금 전구 줄: 원뿔을 감는 나선(출렁임 포함)
        g = np.linspace(0.04, 0.93, 360)
        gy = (TREE_TOP - 0.2) - g * ((TREE_TOP - 0.2) - (TREE_BOTTOM + 0.12)) + 0.025 * np.sin(g * TAU * 38)
        gf = (TREE_TOP - gy) / (TREE_TOP - TREE_BOTTOM)
        gr = (0.12 + (RADIUS - 0.12) * gf) * 0.95
        self.garland_u = g
        self.garland = np.stack([gr * np.cos(g * TAU * 5.0), gy, gr * np.sin(g * TAU * 5.0)], axis=1)

    def resize(self, width: int, height: int) -> None:
        self.width, self.height = max(20, width), max(10, height)
        rng = np.random.default_rng(self.seed + 1)
        view_rows = self.height - HUD_ROWS
        self.view_rows = view_rows
        count = self.width * self.height // 45
        self.star_x = rng.integers(0, self.width, size=count)
        self.star_y = rng.integers(0, max(1, view_rows), size=count)
        self.star_ch = rng.choice(np.array(list(".. ,+`")), size=count)
        self.star_phase = rng.uniform(0, TAU, size=count)
        self.star_rate = rng.uniform(0.8, 3.0, size=count)
        snow = max(1, self.width * self.height // 160)
        self.snow_x = rng.uniform(0, self.width, size=snow)
        self.snow_y = rng.uniform(0, view_rows, size=snow)
        self.snow_speed = rng.uniform(1.5, 4.0, size=snow)
        self.snow_phase = rng.uniform(0, TAU, size=snow)
        self.cx = (self.width - 1) / 2
        self.cy = (view_rows - 1) / 2 - 0.5
        self.yc = (TREE_TOP + TRUNK_BOTTOM) / 2
        by_height = 0.66 * view_rows * CAMERA / (TREE_TOP - TRUNK_BOTTOM)
        by_width = 0.47 * self.width * (CAMERA - RADIUS * 1.2) / (RADIUS * 1.25 * ASPECT)
        self.focal = min(by_height, by_width)

    # ---- 상태 -----------------------------------------------------------
    def angle_deg(self, t: float) -> float:
        return (self.deg_per_sec * t) % 360.0

    def visible_letters(self, t: float) -> int:
        """t 초에 보이는 잎 글자 수. t=0 에 453, GROW_SECONDS 뒤 전부."""
        n0 = min(INITIAL_LETTERS, self.letter_total)
        return int(n0 + (self.letter_total - n0) * smoothstep(t / GROW_SECONDS))

    def garland_mask(self, t: float) -> np.ndarray:
        """t 초에 감겨 있는 황금 줄 점들. 나무가 거의 자란 뒤 위(u 작음)에서부터 아래로 감긴다."""
        reach = smoothstep((t - 0.7 * GROW_SECONDS) / (0.5 * GROW_SECONDS))
        if reach <= 0:
            return np.zeros(len(self.garland_u), dtype=bool)
        return self.garland_u <= 0.04 + 0.89 * reach

    def lit_lights(self, t: float) -> int:
        """t 초에 켜진 전구 수. 나무가 거의 자란 뒤 하나씩 켜진다(t=0 이면 0)."""
        if t < LIGHT_START or self.light_count == 0:
            return 0
        return int(min(self.light_count, 1 + (t - LIGHT_START) // LIGHT_INTERVAL))

    # ---- 투영 -----------------------------------------------------------
    def project(self, points: np.ndarray, angle_deg: float):
        """월드 점 → (열, 행, 깊이z). z 가 작을수록 카메라에 가깝다."""
        p = rotate_y(points, math.radians(angle_deg))
        k = self.focal / (CAMERA + p[:, 2])
        sx = self.cx + p[:, 0] * k * ASPECT
        sy = self.cy - (p[:, 1] - self.yc) * k
        return np.rint(sx).astype(np.int64), np.rint(sy).astype(np.int64), p[:, 2]

    # ---- 프레임 ---------------------------------------------------------
    def frame(self, t: float) -> Grid:
        H, W = self.height, self.width
        chars = np.full((H, W), " ", dtype="<U1")
        colors = np.zeros((H, W, 3), dtype=np.uint8)
        self._draw_background(chars, colors, t)

        angle = self.angle_deg(t)
        vis = self.visible_letters(t)
        xy, zs, cs, rgb = [], [], [], []

        def put(points, z_bias, ch, color):
            if len(points) == 0:
                return
            cx, cy, z = self.project(points, angle)
            xy.append((cx, cy)); zs.append(z + z_bias); cs.append(ch); rgb.append(color)
            return z

        # 잎(글자): 깊이가 깊을수록 어둡고, 가지 끝일수록 살짝 노랗게
        m = self.rank < vis
        fx, fy, fz = self.project(self.foliage[m], angle)
        depth = np.clip(1.0 - 0.55 * (fz + RADIUS) / (2 * RADIUS), 0.35, 1.0)
        shade = depth * self.foliage_light[m]
        tip = self.foliage_s[m]
        green = np.stack([18 + 40 * shade + 40 * tip * shade, 55 + 185 * shade, 32 + 40 * shade], axis=1)
        glint = self.foliage_glint[m]
        green[glint] = np.array([205.0, 245.0, 150.0]) * np.clip(depth[glint] + 0.1, 0.4, 1.0)[:, None]
        xy.append((fx, fy)); zs.append(fz); cs.append(self.foliage_chars[m]); rgb.append(green)

        put(self.trunk, 0.0, np.full(len(self.trunk), "#"), np.tile([115.0, 78.0, 45.0], (len(self.trunk), 1)))

        # 장식 공(가지가 자란 뒤에), 가까운 것이 더 밝다
        om = self.ornament_at <= vis
        if om.any():
            pts = self.ornaments[om]
            cx, cy, z = self.project(pts, angle)
            glow = np.clip(1.0 - 0.4 * (z + RADIUS) / (2 * RADIUS), 0.55, 1.0)
            xy.append((cx, cy)); zs.append(z - 0.08); cs.append(np.full(len(pts), "O"))
            rgb.append(self.ornament_rgb[om] * glow[:, None])

        # 황금 줄: 나무가 거의 다 자란 뒤 위에서부터 감긴다
        gm = self.garland_mask(t)
        if gm.any():
            put(self.garland[gm], -0.03, np.full(int(gm.sum()), "*"), np.tile(GARLAND_COLOR, (int(gm.sum()), 1)))

        # 전구(켜진 것만, 깜빡임)
        lit = self.lit_lights(t)
        if lit:
            lx, ly, lz = self.project(self.lights[:lit], angle)
            tw = 0.6 + 0.4 * np.sin(t * 3.0 + self.light_phase[:lit])
            xy.append((lx, ly)); zs.append(lz - 0.05)
            cs.append(np.where(tw > 0.85, "O", "o"))
            rgb.append(self.light_rgb[:lit] * tw[:, None])

        xs = np.concatenate([p[0] for p in xy]); ys = np.concatenate([p[1] for p in xy])
        z_all, c_all, rgb_all = np.concatenate(zs), np.concatenate(cs), np.concatenate(rgb)
        ok = (xs >= 0) & (xs < W) & (ys >= 0) & (ys < self.view_rows)
        xs, ys, z_all, c_all, rgb_all = xs[ok], ys[ok], z_all[ok], c_all[ok], rgb_all[ok]
        pick = zbuffer_pick(ys * W + xs, z_all)
        chars[ys[pick], xs[pick]] = c_all[pick]
        colors[ys[pick], xs[pick]] = np.clip(rgb_all[pick], 0, 255).astype(np.uint8)

        self._draw_star(chars, colors, t)
        self._draw_hud(chars, colors, t, lit, vis)
        return Grid(chars, colors)

    def snow_at(self, t: float) -> tuple[np.ndarray, np.ndarray]:
        """t 초의 눈송이 위치(열, 행). 아래로 떨어지며 좌우로 살랑이고, 끝까지 가면 위에서 다시 나온다."""
        y = ((self.snow_y + self.snow_speed * t) % self.view_rows).astype(np.int64)
        x = ((self.snow_x + 1.2 * np.sin(t * 0.7 + self.snow_phase)) % self.width).astype(np.int64)
        return x, y

    def _draw_background(self, chars, colors, t) -> None:
        # 반짝이는 별
        glow = 0.35 + 0.65 * (0.5 + 0.5 * np.sin(t * self.star_rate + self.star_phase))
        chars[self.star_y, self.star_x] = self.star_ch
        colors[self.star_y, self.star_x] = np.outer(glow, [190, 200, 235]).astype(np.uint8)
        # 내리는 눈(시간의 함수라 결정적)
        sx, sy = self.snow_at(t)
        chars[sy, sx] = "."
        colors[sy, sx] = (225, 230, 245)
        # 바닥: 줄기 아래로 퍼지는 가로줄
        _, row, _ = self.project(np.array([[0.0, TRUNK_BOTTOM, -0.55 * RADIUS]]), 0.0)   # 나무 앞쪽 지면
        for k in range(6):
            y = int(row[0]) + 1 + k
            if y >= self.view_rows:
                break
            half = int(0.55 * self.width * (0.35 + 0.65 * (k + 1) / 6))
            x0, x1 = max(0, int(self.cx) - half), min(self.width, int(self.cx) + half)
            cols = np.arange(x0, x1)
            cols = cols[(cols + k) % 2 == 0]
            chars[y, cols] = "-" if k % 2 == 0 else "."
            colors[y, cols] = (np.array([150, 170, 205]) * (0.6 - 0.07 * k)).astype(np.uint8)

    def _draw_star(self, chars, colors, t) -> None:
        """꼭대기 별: 가운데 '*' 와 사방으로 퍼지는 광선(화면을 향하므로 회전하지 않는다)."""
        appear = smoothstep((t - 0.9 * GROW_SECONDS) / 1.0)
        if appear <= 0:
            return
        cx, cy, _ = self.project(np.array([[0.0, TREE_TOP + 0.03, 0.0]]), 0.0)
        cx, cy = int(cx[0]), int(cy[0])
        pulse = (0.8 + 0.2 * math.sin(t * 4.0)) * appear
        arms = [(1, 0, "-", 9), (-1, 0, "-", 9), (0, 1, "|", 4), (0, -1, "|", 4),
                (2, 1, "\\", 2), (-2, -1, "\\", 2), (2, -1, "/", 2), (-2, 1, "/", 2)]
        for dx, dy, ch, length in arms:
            for k in range(1, length + 1):
                x, y = cx + dx * k, cy + dy * k
                if 0 <= x < self.width and 0 <= y < self.view_rows and chars[y, x] in (" ", ".", ",", "+", "`"):
                    chars[y, x] = ch
                    colors[y, x] = (np.array([255.0, 225.0, 120.0]) * pulse * (1.0 - 0.8 * (k - 1) / length)).astype(np.uint8)
        if 0 <= cx < self.width and 0 <= cy < self.view_rows:
            chars[cy, cx] = "*"
            colors[cy, cx] = (np.array([255.0, 240.0, 170.0]) * pulse).astype(np.uint8)

    def hud_lines(self, t: float, lit: int, letters: int | None = None) -> tuple[str, list[str]]:
        mm, ss = divmod(int(t), 60)
        shown = self.visible_letters(t) if letters is None else letters
        return f"t {mm:02d}:{ss:02d}s", [
            f"rotation {self.angle_deg(t):06.2f}\N{DEGREE SIGN}     lights {lit}",
            f"letters {shown:,}",
            f"running - {self.fps} fps",
        ]

    def _draw_hud(self, chars, colors, t, lit, letters) -> None:
        H, W = chars.shape
        top, lines = self.hud_lines(t, lit, letters)
        for col, ch in enumerate(top):
            x = W - len(top) - 1 + col
            if 0 <= x < W:
                chars[0, x] = ch
                colors[0, x] = (235, 90, 90)
        for r, line in enumerate(lines):
            y = H - HUD_ROWS + r
            for col, ch in enumerate(line[: W - 2]):
                chars[y, 1 + col] = ch
                colors[y, 1 + col] = (150, 160, 170)


# ---- 출력 -----------------------------------------------------------------
def to_plain(grid: Grid) -> str:
    return "\n".join("".join(row).rstrip() for row in grid.chars)


def to_ansi(grid: Grid) -> str:
    """24비트 색 ANSI. 같은 색이 이어지면 이스케이프를 한 번만 쓴다."""
    out: list[str] = []
    for y in range(grid.height):
        cur = None
        row: list[str] = []
        for x in range(grid.width):
            ch = grid.chars[y, x]
            if ch == " ":
                row.append(" ")
                continue
            rgb = tuple(int(v) for v in grid.colors[y, x])
            if rgb != cur:
                row.append(f"\x1b[38;2;{rgb[0]};{rgb[1]};{rgb[2]}m")
                cur = rgb
            row.append(str(ch))
        out.append("".join(row) + "\x1b[0m")
    return "\n".join(out)


def terminal_size() -> tuple[int, int]:
    s = shutil.get_terminal_size(fallback=(100, 40))
    return s.columns, s.lines


def run(args: argparse.Namespace) -> int:
    cols, rows = (args.width or terminal_size()[0]), (args.height or terminal_size()[1])
    scene = Scene(cols, rows, letters=args.letters, text=args.text, lights=args.lights,
                  ornaments=args.ornaments, seed=args.seed, degrees_per_sec=args.spin, fps=args.fps)
    render = to_plain if args.plain else to_ansi
    dt = 1.0 / args.fps

    if args.frames is not None:                 # 파일/테스트용: 시간을 고정 간격으로 흘리며 N 프레임 출력
        for n in range(args.frames):
            sys.stdout.write(render(scene.frame(args.start + n * dt)) + ("\n" if args.plain else "\x1b[0m\n"))
        return 0

    interactive = sys.stdout.isatty()
    if interactive:
        sys.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J")   # 대체 화면, 커서 숨김
    started = time.perf_counter()
    try:
        while True:
            frame_start = time.perf_counter()
            t = frame_start - started
            if args.duration and t > args.duration:
                break
            if not args.width and not args.height:
                c, r = terminal_size()
                if (c, r) != (scene.width, scene.height):
                    scene.resize(c, r)
                    sys.stdout.write("\x1b[2J")
            sys.stdout.write("\x1b[H" + render(scene.frame(t)))
            sys.stdout.flush()
            time.sleep(max(0.0, dt - (time.perf_counter() - frame_start)))
    except KeyboardInterrupt:
        pass
    finally:
        if interactive:
            sys.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l")  # 화면·커서 복원
            sys.stdout.flush()
    return 0


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="회전하는 ASCII 크리스마스 트리")
    p.add_argument("--letters", type=int, default=8500, help="나무를 이루는 글자 수 (기본 8500)")
    p.add_argument("--text", default="MERRY CHRISTMAS", help="나무에 쓸 글자")
    p.add_argument("--lights", type=int, default=170, help="전구 수")
    p.add_argument("--ornaments", type=int, default=26, help="장식 공 수")
    p.add_argument("--spin", type=float, default=15.0, help="초당 회전 각도(도)")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--width", type=int, help="가로 칸 수(기본: 터미널 크기)")
    p.add_argument("--height", type=int, help="세로 줄 수(기본: 터미널 크기)")
    p.add_argument("--duration", type=float, help="이 시간(초) 뒤 종료")
    p.add_argument("--frames", type=int, help="N 프레임만 출력하고 종료(시간은 가상)")
    p.add_argument("--start", type=float, default=0.0, help="--frames 의 시작 시각(초)")
    p.add_argument("--plain", action="store_true", help="색 없이 글자만")
    a = p.parse_args(argv)
    if a.fps < 1:
        p.error("--fps 는 1 이상이어야 합니다")
    if a.letters < MIN_LETTERS:
        p.error(f"--letters 는 {MIN_LETTERS} 이상이어야 합니다(가지마다 글자가 1개 이상 필요)")
    return a


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
