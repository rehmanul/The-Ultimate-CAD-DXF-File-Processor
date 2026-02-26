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
        "checks": checks,
        "passed": passed,
    }

    print(json.dumps(report, indent=2))

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)

    raise SystemExit(0 if passed else 1)


if __name__ == "__main__":
    main()
