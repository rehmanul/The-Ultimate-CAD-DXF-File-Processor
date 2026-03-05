#!/usr/bin/env python3
import argparse
import json
import math
import os
import fitz


def render_page(doc_path, target_w=900, target_h=1200):
    doc = fitz.open(doc_path)
    page_count = len(doc)
    if page_count == 0:
        raise RuntimeError(f"No pages in PDF: {doc_path}")
    page = doc[0]
    page_width = float(page.rect.width)
    page_height = float(page.rect.height)
    aspect_ratio = page_width / page_height
    sx = target_w / page_width
    sy = target_h / page_height
    pix = page.get_pixmap(matrix=fitz.Matrix(sx, sy), alpha=False)
    data = bytes(pix.samples)
    doc.close()
    return {
        "page_count": page_count,
        "width": pix.width,
        "height": pix.height,
        "aspect_ratio": aspect_ratio,
        "samples": data,
    }


def classify_colors(samples, pixel_count):
    c = {
        "green": 0,
        "blue": 0,
        "red": 0,
        "black": 0,
        "white": 0,
        "non_white": 0,
    }
    for i in range(0, pixel_count * 3, 3):
        r = samples[i]
        g = samples[i + 1]
        b = samples[i + 2]

        if g > 130 and r < 140 and b < 140:
            c["green"] += 1
        if b > 130 and r < 140 and g < 160:
            c["blue"] += 1
        if r > 140 and g < 120 and b < 120:
            c["red"] += 1
        if r < 80 and g < 80 and b < 80:
            c["black"] += 1
        if r > 230 and g > 230 and b > 230:
            c["white"] += 1
        else:
            c["non_white"] += 1

    ratios = {}
    total = float(pixel_count)
    for k, v in c.items():
        ratios[k + "_ratio"] = v / total if total > 0 else 0.0
    return c, ratios


def _luma_at(samples, idx):
    # Integer approximation of Rec.601 luma; fast and deterministic.
    return (77 * int(samples[idx]) + 150 * int(samples[idx + 1]) + 29 * int(samples[idx + 2])) >> 8


def estimate_edge_density(samples, width, height, step=2, edge_threshold=28):
    if width <= step or height <= step:
        return 0.0

    stride = width * 3
    edges = 0
    comparisons = 0

    for y in range(0, height - step, step):
        row_off = y * stride
        row_off_down = (y + step) * stride
        for x in range(0, width - step, step):
            idx = row_off + (x * 3)
            idx_right = row_off + ((x + step) * 3)
            idx_down = row_off_down + (x * 3)

            here = _luma_at(samples, idx)
            right = _luma_at(samples, idx_right)
            down = _luma_at(samples, idx_down)

            if abs(here - right) > edge_threshold or abs(here - down) > edge_threshold:
                edges += 1
            comparisons += 1

    return (edges / float(comparisons)) if comparisons > 0 else 0.0


def normalized_region_to_px(width, height, region):
    x0 = max(0, min(width - 1, int(region["x0"] * width)))
    y0 = max(0, min(height - 1, int(region["y0"] * height)))
    x1 = max(x0 + 1, min(width, int(region["x1"] * width)))
    y1 = max(y0 + 1, min(height, int(region["y1"] * height)))
    return x0, y0, x1, y1


def extract_region(samples, width, height, region):
    x0, y0, x1, y1 = normalized_region_to_px(width, height, region)
    region_w = x1 - x0
    region_h = y1 - y0
    stride = width * 3
    out = bytearray(region_w * region_h * 3)
    out_idx = 0

    for y in range(y0, y1):
        row_start = y * stride + x0 * 3
        row_end = y * stride + x1 * 3
        row = samples[row_start:row_end]
        row_len = len(row)
        out[out_idx:out_idx + row_len] = row
        out_idx += row_len

    return bytes(out), {
        "x0": x0,
        "y0": y0,
        "x1": x1,
        "y1": y1,
        "width": region_w,
        "height": region_h,
        "pixel_count": region_w * region_h,
        "normalized": region,
    }


def analyze_region(gen_samples, ref_samples, width, height, region):
    gen_region, bounds = extract_region(gen_samples, width, height, region)
    ref_region, _ = extract_region(ref_samples, width, height, region)
    px = bounds["pixel_count"]

    gen_counts, gen_ratios = classify_colors(gen_region, px)
    ref_counts, ref_ratios = classify_colors(ref_region, px)

    gen_edge_density = estimate_edge_density(gen_region, bounds["width"], bounds["height"])
    ref_edge_density = estimate_edge_density(ref_region, bounds["width"], bounds["height"])

    return {
        "bounds": bounds,
        "generated": {
            "color_counts": gen_counts,
            "color_ratios": gen_ratios,
            "edge_density": gen_edge_density,
        },
        "reference": {
            "color_counts": ref_counts,
            "color_ratios": ref_ratios,
            "edge_density": ref_edge_density,
        },
    }


def build_structural_analysis(gen_samples, ref_samples, width, height):
    # Reference-sheet regions are normalized so checks remain deterministic across output sizes.
    # Thresholds are reference-relative + absolute floors to avoid brittle exact-pixel coupling.
    regions = {
        "title_block": {"x0": 0.72, "y0": 0.77, "x1": 0.995, "y1": 0.995},
        "legend": {"x0": 0.70, "y0": 0.20, "x1": 0.995, "y1": 0.77},
        "drawing_context": {"x0": 0.02, "y0": 0.04, "x1": 0.70, "y1": 0.97},
    }
    border_regions = {
        "top": {"x0": 0.00, "y0": 0.00, "x1": 1.00, "y1": 0.022},
        "bottom": {"x0": 0.00, "y0": 0.978, "x1": 1.00, "y1": 1.00},
        "left": {"x0": 0.00, "y0": 0.00, "x1": 0.022, "y1": 1.00},
        "right": {"x0": 0.978, "y0": 0.00, "x1": 1.00, "y1": 1.00},
    }

    region_metrics = {name: analyze_region(gen_samples, ref_samples, width, height, spec) for name, spec in regions.items()}
    border_metrics = {name: analyze_region(gen_samples, ref_samples, width, height, spec) for name, spec in border_regions.items()}

    # Border presence: require 3/4 sides with non-white content and a minimal green-line signal.
    side_thresholds = {}
    side_results = {}
    side_detected = 0
    gen_green_sum = 0.0
    ref_green_sum = 0.0
    for side, metric in border_metrics.items():
        gen_ratios = metric["generated"]["color_ratios"]
        ref_ratios = metric["reference"]["color_ratios"]
        min_non_white = max(0.0015, ref_ratios["non_white_ratio"] * 0.40)
        pass_side = gen_ratios["non_white_ratio"] >= min_non_white
        if pass_side:
            side_detected += 1
        gen_green_sum += gen_ratios["green_ratio"]
        ref_green_sum += ref_ratios["green_ratio"]
        side_thresholds[side] = {"non_white_min": min_non_white}
        side_results[side] = {
            "pass": pass_side,
            "generated_non_white_ratio": gen_ratios["non_white_ratio"],
            "reference_non_white_ratio": ref_ratios["non_white_ratio"],
            "generated_green_ratio": gen_ratios["green_ratio"],
            "reference_green_ratio": ref_ratios["green_ratio"],
        }

    avg_gen_border_green = gen_green_sum / 4.0
    avg_ref_border_green = ref_green_sum / 4.0
    border_green_min = max(0.00005, avg_ref_border_green * 0.35)
    border_presence_pass = side_detected >= 3 and avg_gen_border_green >= border_green_min

    title_metric = region_metrics["title_block"]
    title_gen = title_metric["generated"]["color_ratios"]
    title_ref = title_metric["reference"]["color_ratios"]
    title_non_white_min = max(0.018, title_ref["non_white_ratio"] * 0.45)
    # Keep low absolute floors so reference-vs-reference always passes even if linework is light.
    title_black_min = max(0.0004, title_ref["black_ratio"] * 0.35)
    title_block_pass = (
        title_gen["non_white_ratio"] >= title_non_white_min
        and title_gen["black_ratio"] >= title_black_min
    )

    legend_metric = region_metrics["legend"]
    legend_gen = legend_metric["generated"]["color_ratios"]
    legend_ref = legend_metric["reference"]["color_ratios"]
    legend_non_white_min = max(0.025, legend_ref["non_white_ratio"] * 0.45)
    legend_black_min = max(0.00035, legend_ref["black_ratio"] * 0.35)
    legend_occupancy_pass = (
        legend_gen["non_white_ratio"] >= legend_non_white_min
        and legend_gen["black_ratio"] >= legend_black_min
    )

    context_metric = region_metrics["drawing_context"]
    context_gen = context_metric["generated"]["color_ratios"]
    context_ref = context_metric["reference"]["color_ratios"]
    context_gen_edge = context_metric["generated"]["edge_density"]
    context_ref_edge = context_metric["reference"]["edge_density"]

    context_non_white_min = max(0.050, context_ref["non_white_ratio"] * 0.55)
    context_black_min = max(0.0006, context_ref["black_ratio"] * 0.35)
    context_edge_min = max(0.010, context_ref_edge * 0.45)
    wall_context_pass = (
        context_gen["non_white_ratio"] >= context_non_white_min
        and context_gen["black_ratio"] >= context_black_min
        and context_gen_edge >= context_edge_min
    )

    checks = {
        "border_presence": {
            "pass": border_presence_pass,
            "required_sides": 3,
            "sides_detected": side_detected,
            "avg_border_green_ratio": avg_gen_border_green,
            "avg_border_green_min": border_green_min,
            "side_thresholds": side_thresholds,
            "side_results": side_results,
        },
        "title_block_occupancy": {
            "pass": title_block_pass,
            "generated_non_white_ratio": title_gen["non_white_ratio"],
            "generated_black_ratio": title_gen["black_ratio"],
            "non_white_min": title_non_white_min,
            "black_min": title_black_min,
        },
        "legend_region_occupancy": {
            "pass": legend_occupancy_pass,
            "generated_non_white_ratio": legend_gen["non_white_ratio"],
            "generated_black_ratio": legend_gen["black_ratio"],
            "non_white_min": legend_non_white_min,
            "black_min": legend_black_min,
        },
        "wall_context_presence": {
            "pass": wall_context_pass,
            "generated_non_white_ratio": context_gen["non_white_ratio"],
            "generated_black_ratio": context_gen["black_ratio"],
            "generated_edge_density": context_gen_edge,
            "non_white_min": context_non_white_min,
            "black_min": context_black_min,
            "edge_density_min": context_edge_min,
        },
    }

    failed = [name for name, detail in checks.items() if not detail["pass"]]
    aggregate = {
        "passed": len(failed) == 0,
        "total": len(checks),
        "passed_count": len(checks) - len(failed),
        "failed_checks": failed,
    }

    return {
        "regions": {
            **region_metrics,
            "border_sides": border_metrics,
        },
        "checks": checks,
        "aggregate": aggregate,
    }


def compare_pixels(gen_samples, ref_samples, width, height):
    total = width * height
    abs_sum = 0
    sq_sum = 0

    for i in range(0, total * 3, 3):
        dr = int(gen_samples[i]) - int(ref_samples[i])
        dg = int(gen_samples[i + 1]) - int(ref_samples[i + 1])
        db = int(gen_samples[i + 2]) - int(ref_samples[i + 2])
        abs_sum += abs(dr) + abs(dg) + abs(db)
        sq_sum += dr * dr + dg * dg + db * db

    mae = abs_sum / float(total * 3)
    rmse = math.sqrt(sq_sum / float(total * 3))
    similarity = max(0.0, 1.0 - (mae / 255.0))
    return {
        "mae": mae,
        "rmse": rmse,
        "similarity": similarity,
    }


def main():
    parser = argparse.ArgumentParser(description="Validate generated COSTO PDF against reference quality metrics")
    parser.add_argument("--generated", required=True, help="Generated PDF path")
    parser.add_argument("--reference", required=True, help="Reference PDF path")
    parser.add_argument("--output", default="", help="Optional JSON report output path")
    parser.add_argument("--target-width", type=int, default=900)
    parser.add_argument("--target-height", type=int, default=1200)
    args = parser.parse_args()

    if not os.path.exists(args.generated):
        raise FileNotFoundError(f"Generated PDF not found: {args.generated}")
    if not os.path.exists(args.reference):
        raise FileNotFoundError(f"Reference PDF not found: {args.reference}")

    gen = render_page(args.generated, args.target_width, args.target_height)
    ref = render_page(args.reference, args.target_width, args.target_height)

    cmp_w = min(gen["width"], ref["width"])
    cmp_h = min(gen["height"], ref["height"])
    cmp_px = cmp_w * cmp_h

    gen_stride = gen["width"] * 3
    ref_stride = ref["width"] * 3

    gen_crop = bytearray(cmp_px * 3)
    ref_crop = bytearray(cmp_px * 3)

    out_idx = 0
    for y in range(cmp_h):
        g_off = y * gen_stride
        r_off = y * ref_stride
        for x in range(cmp_w * 3):
            gen_crop[out_idx] = gen["samples"][g_off + x]
            ref_crop[out_idx] = ref["samples"][r_off + x]
            out_idx += 1

    pixel_metrics = compare_pixels(gen_crop, ref_crop, cmp_w, cmp_h)
    gen_color_counts, gen_ratios = classify_colors(gen_crop, cmp_px)
    ref_color_counts, ref_ratios = classify_colors(ref_crop, cmp_px)

    aspect_diff = abs(gen["aspect_ratio"] - ref["aspect_ratio"])
    red_presence_threshold = max(0.00001, ref_ratios["red_ratio"] * 0.15)
    ratio_deltas = {
        "green_ratio_delta": abs(gen_ratios["green_ratio"] - ref_ratios["green_ratio"]),
        "blue_ratio_delta": abs(gen_ratios["blue_ratio"] - ref_ratios["blue_ratio"]),
        "red_ratio_delta": abs(gen_ratios["red_ratio"] - ref_ratios["red_ratio"]),
        "black_ratio_delta": abs(gen_ratios["black_ratio"] - ref_ratios["black_ratio"]),
        "non_white_ratio_delta": abs(gen_ratios["non_white_ratio"] - ref_ratios["non_white_ratio"]),
    }
    structural = build_structural_analysis(gen_crop, ref_crop, cmp_w, cmp_h)

    checks = {
        "page_count_match": gen["page_count"] == ref["page_count"],
        "aspect_ratio_close": aspect_diff <= 0.12,
        "similarity_minimum": pixel_metrics["similarity"] >= 0.82,
        "mae_within_limit": pixel_metrics["mae"] <= 85.0,
        "rmse_within_limit": pixel_metrics["rmse"] <= 110.0,
        "blue_ratio_delta_within_limit": ratio_deltas["blue_ratio_delta"] <= 0.03,
        "non_white_ratio_delta_within_limit": ratio_deltas["non_white_ratio_delta"] <= 0.30,
        "has_blue_structure": gen_ratios["blue_ratio"] >= 0.0010,
        "has_red_radiators": gen_ratios["red_ratio"] >= red_presence_threshold,
        "has_green_border": gen_ratios["green_ratio"] >= 0.00002,
        "has_nonwhite_content": gen_ratios["non_white_ratio"] >= 0.03,
        "structural_border_presence": structural["checks"]["border_presence"]["pass"],
        "structural_title_block_occupancy": structural["checks"]["title_block_occupancy"]["pass"],
        "structural_legend_region_occupancy": structural["checks"]["legend_region_occupancy"]["pass"],
        "structural_wall_context_presence": structural["checks"]["wall_context_presence"]["pass"],
        "structural_checks_pass": structural["aggregate"]["passed"],
    }

    passed = all(checks.values())

    report = {
        "generated": {
            "path": os.path.abspath(args.generated),
            "page_count": gen["page_count"],
            "width": gen["width"],
            "height": gen["height"],
            "aspect_ratio": gen["aspect_ratio"],
            "color_counts": gen_color_counts,
            "color_ratios": gen_ratios,
        },
        "reference": {
            "path": os.path.abspath(args.reference),
            "page_count": ref["page_count"],
            "width": ref["width"],
            "height": ref["height"],
            "aspect_ratio": ref["aspect_ratio"],
            "color_counts": ref_color_counts,
            "color_ratios": ref_ratios,
        },
        "comparison": {
            "compare_width": cmp_w,
            "compare_height": cmp_h,
            "aspect_ratio_diff": aspect_diff,
            "red_presence_threshold": red_presence_threshold,
            **pixel_metrics,
            **ratio_deltas,
        },
        "structural_checks": structural["checks"],
        "structural_regions": structural["regions"],
        "structural_aggregate": structural["aggregate"],
        "checks": checks,
        "aggregate_decision": {
            "pixel_and_color_checks_passed": all(
                checks[k] for k in checks.keys() if not k.startswith("structural_")
            ),
            "structural_checks_passed": structural["aggregate"]["passed"],
            "overall_passed": passed,
        },
        "passed": passed,
    }

    print(json.dumps(report, indent=2))

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)

    raise SystemExit(0 if passed else 1)


if __name__ == "__main__":
    main()
