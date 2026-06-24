#!/usr/bin/env python3
import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request


DEFAULT_BASE_URL = "http://localhost:3000"


# --- Readability tuning ----------------------------------------------------
# These constants drive auto-sizing and the layout engine. They exist so that
# callers (usually an LLM agent) never have to do pixel math by hand, which is
# the main source of overlapping / unreadable diagrams.
CHAR_WIDTH = 8.5        # approx px per character at tldraw's default font size
H_PADDING = 32          # horizontal text padding inside a shape
V_PADDING = 28          # vertical text padding inside a shape
LINE_HEIGHT = 22        # px per wrapped line of text
MIN_WIDTH = 140
MAX_WIDTH = 300
MIN_HEIGHT = 60

# Allowed tldraw style values, mirrored from the API schema in
# lib/diagramApiTypes.ts so the CLI rejects bad values before hitting the server.
SHAPE_COLORS = [
    "black", "grey", "light-violet", "violet", "blue", "light-blue",
    "yellow", "orange", "green", "light-green", "light-red", "red", "white",
]
SHAPE_FILLS = ["none", "semi", "solid", "pattern"]
CONNECTION_ANCHORS = ["top", "bottom", "left", "right", "center"]

LAYOUT_DEFAULTS = {
    "originX": 80,
    "originY": 120,
    "colGap": 80,        # horizontal gap between shapes in a lane
    "rowPitch": 180,     # vertical distance between lane baselines
    "annotationGap": 60,  # extra vertical gap before the annotation band
    "annotationType": "box",  # annotations are sized boxes, NOT notes (see LIMITATIONS.md)
}


def request(method, path, body=None):
    base_url = os.environ.get("DIAGRAMTALK_URL", DEFAULT_BASE_URL).rstrip("/")
    data = None
    headers = {}

    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        headers=headers,
        method=method,
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8")
        raise SystemExit(f"HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise SystemExit(f"Could not reach DiagramTalk: {error}") from error


def print_json(value):
    try:
        print(json.dumps(value, indent=2, sort_keys=True))
    except BrokenPipeError:
        try:
            sys.stdout.close()
        finally:
            raise SystemExit(0)


# --- Auto-sizing -----------------------------------------------------------

def estimate_label_size(label, max_width=MAX_WIDTH):
    """Estimate a width/height (px) that comfortably fits `label`.

    Keeps single-word labels on one line and wraps longer ones, so text stays
    inside the shape instead of overflowing. Honors explicit newlines.
    """
    label = label or ""
    lines = label.split("\n")
    longest = max((len(line) for line in lines), default=0)

    ideal_width = longest * CHAR_WIDTH + H_PADDING
    width = max(MIN_WIDTH, min(ideal_width, max_width))

    chars_per_line = max(1, int((width - H_PADDING) / CHAR_WIDTH))
    wrapped_lines = 0
    for line in lines:
        wrapped_lines += max(1, math.ceil(len(line) / chars_per_line))
    wrapped_lines = max(1, wrapped_lines)

    height = max(MIN_HEIGHT, wrapped_lines * LINE_HEIGHT + V_PADDING)
    return int(round(width)), int(round(height))


# --- Commands --------------------------------------------------------------

def cmd_context(_args):
    print_json(request("GET", "/api/diagram/context"))


def cmd_snapshot(_args):
    print_json(request("GET", "/api/diagram/snapshot"))


def cmd_commands(args):
    path = "/api/diagram/commands"
    if args.status:
        path += f"?status={args.status}"
    print_json(request("GET", path))


def build_shape_payload(
    shape_id, shape_type, label, x, y, w=None, h=None, color=None, fill=None
):
    """Build a createShape input, auto-sizing when w/h are not supplied."""
    auto_w, auto_h = estimate_label_size(label or "")
    input_payload = {
        "type": shape_type,
        "label": label or "",
        "x": x,
        "y": y,
    }
    if shape_id:
        input_payload["id"] = shape_id
    # note shapes ignore w/h in the bridge today (see LIMITATIONS.md), so only
    # attach sizing for sizable shapes.
    if shape_type != "note":
        input_payload["w"] = w if w is not None else auto_w
        input_payload["h"] = h if h is not None else auto_h
    if color:
        input_payload["color"] = color
    if fill:
        input_payload["fill"] = fill
    return input_payload


def cmd_shape(args):
    input_payload = build_shape_payload(
        args.id, args.type, args.label, args.x, args.y, args.w, args.h,
        args.color, args.fill,
    )
    print_json(
        request(
            "POST",
            "/api/diagram/commands",
            {"type": "createShape", "input": input_payload},
        )
    )


def cmd_connect(args):
    input_payload = {
        "fromShapeId": args.from_shape,
        "toShapeId": args.to_shape,
        "label": args.label,
        "directional": not args.undirected,
    }
    if args.id:
        input_payload["id"] = args.id
    if args.from_anchor:
        input_payload["fromAnchor"] = args.from_anchor
    if args.to_anchor:
        input_payload["toAnchor"] = args.to_anchor
    if args.color:
        input_payload["color"] = args.color

    print_json(
        request(
            "POST",
            "/api/diagram/commands",
            {"type": "createConnection", "input": input_payload},
        )
    )


def cmd_ask(args):
    print_json(request("POST", "/api/diagram/ask", {"question": args.question}))


def cmd_wait(args):
    deadline = time.time() + args.timeout

    while True:
        response = request("GET", "/api/diagram/commands?status=pending")
        pending = response.get("commands", [])
        if not pending:
            print_json({"ok": True, "pending": 0})
            return
        if time.time() >= deadline:
            print_json({"ok": False, "pending": len(pending), "commands": pending})
            raise SystemExit(1)
        time.sleep(args.interval)


# --- Layout engine ---------------------------------------------------------

def _resolve_lane_nodes(lanes):
    """Attach an estimated size to every node and return an id->node index."""
    by_id = {}
    for lane in lanes:
        for node in lane.get("nodes", []):
            auto_w, auto_h = estimate_label_size(node.get("label", ""))
            node["_w"] = node.get("w") or auto_w
            node["_h"] = node.get("h") or auto_h
            by_id[node["id"]] = node
    return by_id


def _grid_columns(lanes, cfg):
    """Compute shared column centers from the lane flagged `grid` (or longest).

    Nodes in other lanes can set `"col": <index>` to align under a grid column.
    """
    grid_lane = next((l for l in lanes if l.get("grid")), None)
    if grid_lane is None and lanes:
        grid_lane = max(lanes, key=lambda l: len(l.get("nodes", [])))

    centers = []
    if grid_lane:
        cursor = cfg["originX"]
        for node in grid_lane.get("nodes", []):
            centers.append(cursor + node["_w"] / 2)
            cursor += node["_w"] + cfg["colGap"]
    return centers


def _place_lane(nodes, lane_y, centers, cfg):
    cursor = cfg["originX"]
    for node in nodes:
        col = node.get("col")
        if col is not None and 0 <= col < len(centers):
            x = centers[col] - node["_w"] / 2
        else:
            x = cursor
        x = max(x, cursor)  # never overlap the previous node in this lane
        node["_x"] = x
        node["_y"] = lane_y
        cursor = x + node["_w"] + cfg["colGap"]


def _center(shape):
    return (shape["_x"] + shape["_w"] / 2, shape["_y"] + shape["_h"] / 2)


def derive_anchors(src, dst):
    """Pick exit/entry sides from geometry: horizontal edges leave the right and
    enter the left; vertical edges leave the bottom/top. Keeps arrows in the
    gaps between shapes instead of cutting across box interiors."""
    sx, sy = _center(src)
    dx, dy = _center(dst)
    if abs(dx - sx) >= abs(dy - sy):
        return ("right", "left") if dx >= sx else ("left", "right")
    return ("bottom", "top") if dy >= sy else ("top", "bottom")


def _overlaps(a, b, margin=0):
    return not (
        a["_x"] + a["_w"] + margin <= b["_x"]
        or b["_x"] + b["_w"] + margin <= a["_x"]
        or a["_y"] + a["_h"] + margin <= b["_y"]
        or b["_y"] + b["_h"] + margin <= a["_y"]
    )


def compute_layout(spec):
    """Turn a declarative spec into positioned/sized shapes + edges.

    Returns (shapes, edges) where each shape carries _x/_y/_w/_h. Lanes are
    stacked vertically (no inter-lane overlap when rowPitch > shape height) and
    nodes flow left-to-right with a running cursor (no intra-lane overlap).
    Annotations get their own reserved band so they never cover the diagram.
    """
    cfg = {**LAYOUT_DEFAULTS, **spec.get("config", {})}
    lanes = spec.get("lanes", [])
    by_id = _resolve_lane_nodes(lanes)
    centers = _grid_columns(lanes, cfg)

    shapes = []
    shapes_by_id = {}
    for lane_index, lane in enumerate(lanes):
        lane_y = cfg["originY"] + lane_index * cfg["rowPitch"]
        nodes = lane.get("nodes", [])
        _place_lane(nodes, lane_y, centers, cfg)
        default_type = lane.get("type", "box")
        for node in nodes:
            shape = {
                "id": node["id"],
                "type": node.get("type", default_type),
                "label": node.get("label", ""),
                "_x": node["_x"],
                "_y": node["_y"],
                "_w": node["_w"],
                "_h": node["_h"],
                "color": node.get("color", lane.get("color")),
                "fill": node.get("fill", lane.get("fill")),
            }
            shapes.append(shape)
            shapes_by_id[shape["id"]] = shape

    annotations = spec.get("annotations", [])
    if annotations:
        band_y = cfg["originY"] + len(lanes) * cfg["rowPitch"] + cfg["annotationGap"]
        cursor = cfg["originX"]
        for ann in annotations:
            w, h = estimate_label_size(ann.get("label", ""))
            w = ann.get("w") or w
            h = ann.get("h") or h
            ann_shape = {
                "id": ann["id"],
                "type": ann.get("type", cfg["annotationType"]),
                "label": ann.get("label", ""),
                "_x": cursor,
                "_y": band_y,
                "_w": w,
                "_h": h,
                "color": ann.get("color"),
                "fill": ann.get("fill"),
            }
            shapes.append(ann_shape)
            shapes_by_id[ann_shape["id"]] = ann_shape
            cursor += w + cfg["colGap"]

    edges = spec.get("edges", [])
    # Auto-assign anchor sides from geometry unless the edge specifies them.
    for edge in edges:
        src = shapes_by_id.get(edge["from"])
        dst = shapes_by_id.get(edge["to"])
        if src and dst:
            auto_from, auto_to = derive_anchors(src, dst)
            edge["_fromAnchor"] = edge.get("fromAnchor", auto_from)
            edge["_toAnchor"] = edge.get("toAnchor", auto_to)
    return shapes, edges


def find_overlaps(shapes, margin=8):
    hits = []
    for i in range(len(shapes)):
        for j in range(i + 1, len(shapes)):
            if _overlaps(shapes[i], shapes[j], margin):
                hits.append((shapes[i]["id"], shapes[j]["id"]))
    return hits


_ANCHOR_FRACTIONS = {
    "top": (0.5, 0.0),
    "bottom": (0.5, 1.0),
    "left": (0.0, 0.5),
    "right": (1.0, 0.5),
    "center": (0.5, 0.5),
}


def _anchor_point(shape, side):
    fx, fy = _ANCHOR_FRACTIONS.get(side or "center", (0.5, 0.5))
    return (shape["_x"] + shape["_w"] * fx, shape["_y"] + shape["_h"] * fy)


def _segment_hits_rect(p1, p2, rect, pad=-1.0):
    """Liang-Barsky: does the segment p1->p2 cross the (optionally inset) rect?

    A negative pad shrinks the box so an arrow merely grazing a box edge along a
    gap is not counted — only real penetration is."""
    x1, y1 = p1
    x2, y2 = p2
    rx = rect["_x"] - pad
    ry = rect["_y"] - pad
    rw = rect["_w"] + 2 * pad
    rh = rect["_h"] + 2 * pad
    if rw <= 0 or rh <= 0:
        return False
    dx = x2 - x1
    dy = y2 - y1
    p = (-dx, dx, -dy, dy)
    q = (x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1)
    u1, u2 = 0.0, 1.0
    for pi, qi in zip(p, q):
        if pi == 0:
            if qi < 0:
                return False
        else:
            t = qi / pi
            if pi < 0:
                if t > u2:
                    return False
                u1 = max(u1, t)
            else:
                if t < u1:
                    return False
                u2 = min(u2, t)
    return u1 <= u2


def find_arrow_crossings(shapes, edges):
    """Report every arrow whose straight path passes through a box it is not
    connected to. This is the physical check that coordinate-only box-overlap
    detection misses."""
    by_id = {s["id"]: s for s in shapes}
    crossings = []
    for edge in edges:
        src = by_id.get(edge["from"])
        dst = by_id.get(edge["to"])
        if not src or not dst:
            continue
        p1 = _anchor_point(src, edge.get("_fromAnchor"))
        p2 = _anchor_point(dst, edge.get("_toAnchor"))
        hit = []
        for shape in shapes:
            if shape["id"] in (edge["from"], edge["to"]):
                continue
            if shape["type"] == "text":
                continue
            if _segment_hits_rect(p1, p2, shape):
                hit.append(shape["id"])
        if hit:
            crossings.append({"edge": edge.get("id") or f'{edge["from"]}->{edge["to"]}', "crosses": hit})
    return crossings


def cmd_layout(args):
    with open(args.spec, "r", encoding="utf-8") as handle:
        spec = json.load(handle)

    shapes, edges = compute_layout(spec)
    overlaps = find_overlaps(shapes)
    arrow_crossings = find_arrow_crossings(shapes, edges)

    if args.dry_run or not args.post:
        report = {
            "shapes": [
                {
                    "id": s["id"],
                    "type": s["type"],
                    "label": s["label"],
                    "x": round(s["_x"]),
                    "y": round(s["_y"]),
                    "w": round(s["_w"]),
                    "h": round(s["_h"]),
                    "color": s.get("color"),
                    "fill": s.get("fill"),
                }
                for s in shapes
            ],
            "edges": [
                {
                    "id": e.get("id"),
                    "from": e["from"],
                    "to": e["to"],
                    "label": e.get("label", ""),
                    "fromAnchor": e.get("_fromAnchor"),
                    "toAnchor": e.get("_toAnchor"),
                    "color": e.get("color"),
                }
                for e in edges
            ],
            "overlaps": overlaps,
            "arrowCrossings": arrow_crossings,
            "ok": not overlaps and not arrow_crossings,
        }
        print_json(report)
        # Box overlaps are a hard failure (the engine guarantees against them).
        # Arrow crossings are reported as warnings: until elbow routing exists
        # some long-range edges can't avoid every box, so they don't fail here.
        if overlaps:
            raise SystemExit(1)
        return

    # Post all shapes first, then edges (edges fail if endpoints are missing).
    results = {"shapes": [], "edges": []}
    for s in shapes:
        payload = build_shape_payload(
            s["id"], s["type"], s["label"], round(s["_x"]), round(s["_y"]),
            round(s["_w"]), round(s["_h"]), s.get("color"), s.get("fill"),
        )
        results["shapes"].append(
            request("POST", "/api/diagram/commands", {"type": "createShape", "input": payload})
        )
    for e in edges:
        payload = {
            "fromShapeId": e["from"],
            "toShapeId": e["to"],
            "label": e.get("label", ""),
            "directional": not e.get("undirected", False),
        }
        if e.get("id"):
            payload["id"] = e["id"]
        if e.get("_fromAnchor"):
            payload["fromAnchor"] = e["_fromAnchor"]
        if e.get("_toAnchor"):
            payload["toAnchor"] = e["_toAnchor"]
        if e.get("color"):
            payload["color"] = e["color"]
        results["edges"].append(
            request("POST", "/api/diagram/commands", {"type": "createConnection", "input": payload})
        )
    print_json({"ok": True, "posted": {"shapes": len(shapes), "edges": len(edges)}})


def build_parser():
    parser = argparse.ArgumentParser(description="Interact with a local DiagramTalk app.")
    subparsers = parser.add_subparsers(required=True)

    context = subparsers.add_parser("context", help="Get latest normalized diagram context.")
    context.set_defaults(func=cmd_context)

    snapshot = subparsers.add_parser("snapshot", help="Get saved tldraw snapshot.")
    snapshot.set_defaults(func=cmd_snapshot)

    commands = subparsers.add_parser("commands", help="List diagram commands.")
    commands.add_argument("--status", choices=["pending", "applied", "failed"])
    commands.set_defaults(func=cmd_commands)

    shape = subparsers.add_parser(
        "shape", help="Queue a createShape command (auto-sizes to the label when --w/--h omitted)."
    )
    shape.add_argument("--id")
    shape.add_argument("--type", required=True, choices=["box", "ellipse", "text", "note"])
    shape.add_argument("--label", default="")
    shape.add_argument("--x", required=True, type=float)
    shape.add_argument("--y", required=True, type=float)
    shape.add_argument("--w", type=float)
    shape.add_argument("--h", type=float)
    shape.add_argument("--color", choices=SHAPE_COLORS)
    shape.add_argument("--fill", choices=SHAPE_FILLS)
    shape.set_defaults(func=cmd_shape)

    connect = subparsers.add_parser("connect", help="Queue a createConnection command.")
    connect.add_argument("--id")
    connect.add_argument("--from", required=True, dest="from_shape")
    connect.add_argument("--to", required=True, dest="to_shape")
    connect.add_argument("--label", default="")
    connect.add_argument("--undirected", action="store_true")
    connect.add_argument("--from-anchor", dest="from_anchor", choices=CONNECTION_ANCHORS)
    connect.add_argument("--to-anchor", dest="to_anchor", choices=CONNECTION_ANCHORS)
    connect.add_argument("--color", choices=SHAPE_COLORS)
    connect.set_defaults(func=cmd_connect)

    layout = subparsers.add_parser(
        "layout",
        help="Lay out a whole diagram from a JSON spec with collision-free coordinates.",
    )
    layout.add_argument("spec", help="Path to a layout spec JSON file.")
    layout.add_argument(
        "--post", action="store_true",
        help="Queue the computed shapes/edges to the app (default is dry-run preview).",
    )
    layout.add_argument(
        "--dry-run", action="store_true",
        help="Force preview only: print computed coordinates and an overlap report.",
    )
    layout.set_defaults(func=cmd_layout)

    ask = subparsers.add_parser("ask", help="Ask about the latest diagram context.")
    ask.add_argument("question")
    ask.set_defaults(func=cmd_ask)

    wait = subparsers.add_parser("wait", help="Wait until no commands are pending.")
    wait.add_argument("--timeout", type=float, default=30)
    wait.add_argument("--interval", type=float, default=1)
    wait.set_defaults(func=cmd_wait)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
