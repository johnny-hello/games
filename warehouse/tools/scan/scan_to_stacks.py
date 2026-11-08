"""Turn a Stray Scanner recording into floor stacks for layout.js.

    python3 warehouse/tools/scan/scan_to_stacks.py RECORDING_FOLDER ANCHORS.json [OUT_FOLDER]

RECORDING_FOLDER is an unzipped Stray Scanner recording (rgb.mp4, depth/,
confidence/, odometry.csv, camera_matrix.csv). ANCHORS.json says where three
points of the walk are on the layout, in meters:

    { "anchors": [ { "frame": "start", "at": [249, 14] },
                   { "frame": "corner", "at": [238.5, 44] },
                   { "frame": "end", "at": [221, 45] } ],
      "avoid": [[x, y, w, h], ...] }

"frame" is "start", "end", "corner" (the point of the walk farthest from the
start-end line) or a frame number. "avoid" lists areas (offices, dock lanes)
where nothing should be added: their walls show up in the scan too.

Prints a `stacks` list to paste into layout.js and writes a top-down check
image (map.png) to OUT_FOLDER. Needs numpy and Pillow. Not accurate to the
centimeter: the phone only sees the faces of stacks it walks past, so each
stack is extended 1.4 m (about one pallet) away from the walk.
"""

import csv
import glob
import json
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw


def quat_to_matrix(qx, qy, qz, qw):
    return np.array([
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
        [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
        [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ])


def point_cloud(folder):
    """Points as (x, height above floor, z) in the phone's world frame, and the walk."""
    rows = list(csv.reader(open(f'{folder}/odometry.csv')))[1:]
    K = np.loadtxt(f'{folder}/camera_matrix.csv', delimiter=',')
    first = np.asarray(Image.open(sorted(glob.glob(f'{folder}/depth/*.png'))[0]))
    dh, dw = first.shape
    s = dw / (2 * K[0, 2])  # depth image is a scaled-down copy of the video frame
    fx, fy, cx, cy = K[0, 0] * s, K[1, 1] * s, K[0, 2] * s, K[1, 2] * s
    uu, vv = np.meshgrid(np.arange(dw), np.arange(dh))
    pts, walk = [], []
    for r in rows:
        f = r[1].strip()
        x, y, z, qx, qy, qz, qw = map(float, r[2:9])
        t = np.array([x, y, z])
        walk.append(t)
        try:
            depth = np.asarray(Image.open(f'{folder}/depth/{f}.png'), dtype=np.float32) / 1000
            conf = np.asarray(Image.open(f'{folder}/confidence/{f}.png'))
        except FileNotFoundError:
            continue
        m = (conf >= 2) & (depth > 0.3) & (depth < 6)
        d = depth[m]
        # Stray Scanner poses use the computer-vision camera frame: x right, y down, z forward.
        cam = np.stack([(uu[m] - cx) / fx * d, (vv[m] - cy) / fy * d, d], 1)
        P = cam @ quat_to_matrix(qx, qy, qz, qw).T + t
        # The floor is the most common level 0.6-2.1 m below the phone (per frame, so drift does not matter).
        hist, edges = np.histogram(t[1] - P[:, 1], bins=60, range=(0.6, 2.1))
        if hist.max() < 200:
            continue
        floor = t[1] - (edges[np.argmax(hist)] + (edges[1] - edges[0]) / 2)
        pts.append(np.c_[P[:, 0], P[:, 1] - floor, P[:, 2]][::2])
    return np.concatenate(pts), np.array(walk)[:, [0, 2]]


def fit(walk, anchors):
    """Rotation + shift (no scale) from the phone's floor (x, z) to the layout (x, y)."""
    a, b = walk[0], walk[-1]
    v, w = b - a, walk - a
    corner = np.abs(v[0] * w[:, 1] - v[1] * w[:, 0]).argmax()
    named = {'start': 0, 'end': len(walk) - 1, 'corner': corner}
    src = np.array([walk[named[p['frame']] if isinstance(p['frame'], str) else p['frame']] for p in anchors])
    dst = np.array([p['at'] for p in anchors], float)
    sc, dc = src.mean(0), dst.mean(0)
    U, _, Vt = np.linalg.svd((src - sc).T @ (dst - dc))
    D = np.diag([1, np.sign(np.linalg.det(Vt.T @ U.T))])
    R = Vt.T @ D @ U.T
    t = dc - R @ sc
    err = np.linalg.norm(src @ R.T + t - dst, axis=1)
    return (lambda q: q @ R.T + t), err


def stacks(points, walk, avoid, cell=0.25, depth=1.4):
    seen_h = points[:, 1]
    ob = points[(seen_h > 0.3) & (seen_h < 2.2)][:, [0, 2]]
    origin = ob.min(0) - 1
    ij = ((ob - origin) / cell).astype(int)
    W, H = ij.max(0) + 2
    cnt = np.zeros((W, H), int)
    np.add.at(cnt, (ij[:, 0], ij[:, 1]), 1)
    occ = cnt >= 30
    seen = np.zeros_like(occ)
    out = []
    for i, j in zip(*np.nonzero(occ)):
        if seen[i, j]:
            continue
        q, cells = deque([(i, j)]), []
        seen[i, j] = True
        while q:
            a, b = q.popleft()
            cells.append((a, b))
            for da in (-1, 0, 1):
                for db in (-1, 0, 1):
                    c, d = a + da, b + db
                    if 0 <= c < W and 0 <= d < H and occ[c, d] and not seen[c, d]:
                        seen[c, d] = True
                        q.append((c, d))
        if len(cells) < 6:
            continue
        c = np.array(cells) * cell + origin
        x0, y0 = c.min(0)
        x1, y1 = c.max(0) + cell
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if any(ax <= cx <= ax + aw and ay <= cy <= ay + ah for ax, ay, aw, ah in avoid):
            continue
        n = walk[np.argmin(np.hypot(walk[:, 0] - cx, walk[:, 1] - cy))]
        if x1 - x0 < y1 - y0:          # a face running north-south
            if n[0] < cx: x1 = max(x1, x0 + depth)
            else: x0 = min(x0, x1 - depth)
        else:                           # a face running east-west
            if n[1] < cy: y1 = max(y1, y0 + depth)
            else: y0 = min(y0, y1 - depth)
        if any(not (x1 <= ax or x0 >= ax + aw or y1 <= ay or y0 >= ay + ah) for ax, ay, aw, ah in avoid):
            continue
        out.append([round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1)])
    return out


def draw(path, pts, walk, boxes):
    x0, y0 = walk.min(0) - 8
    x1, y1 = walk.max(0) + 8
    k = 12
    im = Image.new('RGB', (int((x1 - x0) * k), int((y1 - y0) * k)), 'white')
    dr = ImageDraw.Draw(im)
    px = lambda x, y: ((x - x0) * k, (y - y0) * k)
    for q in pts[::6]:
        dr.point(px(*q), fill=(200, 90, 30))
    for bx, by, bw, bh in boxes:
        dr.rectangle([px(bx, by), px(bx + bw, by + bh)], outline=(40, 70, 180), width=2)
    dr.line([px(*q) for q in walk], fill=(220, 30, 30), width=3)
    im.save(path)


if __name__ == '__main__':
    folder, anchors_file = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else '.'
    cfg = json.load(open(anchors_file))
    P, walk = point_cloud(folder)
    to_layout, err = fit(walk, cfg['anchors'])
    print(f'// anchors fit within {", ".join(f"{e:.1f}" for e in err)} m; walk {np.sum(np.linalg.norm(np.diff(walk, axis=0), axis=1)):.0f} m')
    pts_l = np.c_[to_layout(P[:, [0, 2]]), P[:, 1]]
    walk_l = to_layout(walk)
    boxes = stacks(pts_l[:, [0, 2, 1]], walk_l, cfg.get('avoid', []))
    draw(f'{out}/map.png', to_layout(P[(P[:, 1] > 0.3) & (P[:, 1] < 2.2)][:, [0, 2]]), walk_l, boxes)
    print('stacks: [')
    for b in boxes:
        print(f'  {{ x: {b[0]}, y: {b[1]}, w: {b[2]}, h: {b[3]} }},')
    print('],')
