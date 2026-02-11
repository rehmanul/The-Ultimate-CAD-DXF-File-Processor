/**
 * VisionZoneDetector - AI Vision-Based Zone Detection
 * 
 * Uses vision AI (Gemini or OpenAI) to analyze floor plan images
 * and detect room boundaries, including incomplete walls.
 */

const fs = require('fs');
const path = require('path');

class VisionZoneDetector {
    constructor(options = {}) {
        this.apiProvider = options.apiProvider || process.env.VISION_API_PROVIDER || 'gemini';
        this.apiKey = options.apiKey || process.env.VISION_API_KEY || process.env.GEMINI_API_KEY || process.env.VERTEX_AI_API_KEY || process.env.OPENAI_API_KEY;
        this.vertexProject = options.vertexProject || process.env.VERTEX_AI_PROJECT;
        this.vertexLocation = options.vertexLocation || process.env.VERTEX_AI_LOCATION || 'us-central1';
        this.debugMode = options.debug || false;

        if (!this.apiKey && !this.vertexProject) {
            console.warn('[VisionZoneDetector] No API key or Vertex project. Set VISION_API_KEY or VERTEX_AI_PROJECT.');
        }
    }

    /**
     * Detect zones from a floor plan image
     * @param {Buffer|string} imageData - PNG buffer or base64 string
     * @param {Object} bounds - Floor plan bounds {minX, minY, maxX, maxY}
     * @returns {Promise<Array>} Array of detected zones
     */
    async detectZones(imageData, bounds) {
        console.log('[VisionZoneDetector] Starting vision-based zone detection...');

        if (!this.apiKey) {
            console.warn('[VisionZoneDetector] No API key, returning empty zones');
            return [];
        }

        try {
            // Convert to base64 if buffer
            const base64Image = Buffer.isBuffer(imageData)
                ? imageData.toString('base64')
                : imageData;

            // Call vision API based on provider
            let zones;
            if (this.apiProvider === 'openai') {
                zones = await this._callOpenAI(base64Image, bounds);
            } else {
                zones = await this._callGemini(base64Image, bounds);
            }

            console.log(`[VisionZoneDetector] Detected ${zones.length} zones via vision`);
            return zones;

        } catch (error) {
            console.error('[VisionZoneDetector] Vision API error:', error.message);
            return [];
        }
    }

    /**
     * Call Gemini Vision API (tries @google/genai, then @google/generative-ai)
     */
    async _callGemini(base64Image, bounds) {
        const prompt = this._buildPrompt(bounds);

        // Try @google/genai (Google AI Studio or Vertex AI)
        try {
            const { GoogleGenAI } = require('@google/genai');
            const opts = this.vertexProject
                ? { vertexai: true, project: this.vertexProject, location: this.vertexLocation }
                : (this.apiKey ? { apiKey: this.apiKey } : {});
            const ai = new GoogleGenAI(opts);
            const resp = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: [{
                    role: 'user',
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: 'image/png', data: base64Image } }
                    ]
                }]
            });
            const text = resp.text || (resp.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
            if (text) return this._parseResponse(text, bounds);
        } catch (e) {
            if (this.debugMode) console.warn('[VisionZoneDetector] @google/genai failed:', e.message);
        }

        // Fallback to @google/generative-ai (if installed)
        try {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(this.apiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
            const result = await model.generateContent([
                prompt,
                { inlineData: { mimeType: 'image/png', data: base64Image } }
            ]);
            const response = await result.response;
            const text = response.text();
            return this._parseResponse(text, bounds);
        } catch (e) {
            console.warn('[VisionZoneDetector] Gemini fallback failed:', e.message);
            return [];
        }
    }

    /**
     * Call OpenAI Vision API
     */
    async _callOpenAI(base64Image, bounds) {
        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey: this.apiKey });

        const prompt = this._buildPrompt(bounds);

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/png;base64,${base64Image}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: 2000
        });

        const text = response.choices[0].message.content;
        return this._parseResponse(text, bounds);
    }

    /**
     * Build the vision prompt for zone detection
     */
    _buildPrompt(bounds) {
        return `Analyze this architectural floor plan image. Identify ALL distinct rooms/zones.
Black lines = walls. Orange = forbidden (stairs, elevators). Look for rectangular storage areas.

CRITICAL: Many walls may be INCOMPLETE (gaps, missing segments). Identify zones even when boundaries have gaps.
For zones with incomplete walls, set has_incomplete_walls: true and optionally add gap_completion_points.

Output this JSON:
{
  "zones": [
    {
      "id": "zone_1",
      "type": "storage",
      "bounds_percent": { "minX": 0.1, "minY": 0.2, "maxX": 0.4, "maxY": 0.6 },
      "has_incomplete_walls": true,
      "estimated_area_percent": 0.15,
      "gap_completion_points": [
        { "x_percent": 0.25, "y_percent": 0.2, "connect_to": "north" }
      ]
    }
  ]
}

Rules:
- bounds_percent: 0-1, percentage of image width/height
- type: storage (for boxes), office, utility, corridor, bathroom, stairs
- Only "storage" zones get boxes. Include all storage areas >8% of floor
- has_incomplete_walls: true when you see open ends, gaps, or missing wall segments
- gap_completion_points: optional, where walls should connect to close the zone

Return ONLY valid JSON.`;
    }

    /**
     * Parse vision API response and convert to zone objects
     */
    _parseResponse(responseText, bounds) {
        try {
            // Extract JSON from response (handle markdown code blocks)
            let jsonStr = responseText;
            if (responseText.includes('```')) {
                const match = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (match) jsonStr = match[1];
            }

            const data = JSON.parse(jsonStr.trim());
            const zones = data.zones || [];

            // Convert percentage bounds to actual coordinates
            const width = bounds.maxX - bounds.minX;
            const height = bounds.maxY - bounds.minY;

            return zones.map((z, idx) => {
                const bp = z.bounds_percent;
                const zoneBounds = {
                    minX: bounds.minX + bp.minX * width,
                    minY: bounds.minY + bp.minY * height,
                    maxX: bounds.minX + bp.maxX * width,
                    maxY: bounds.minY + bp.maxY * height
                };

                const zoneWidth = zoneBounds.maxX - zoneBounds.minX;
                const zoneHeight = zoneBounds.maxY - zoneBounds.minY;

                return {
                    id: z.id || `vision_zone_${idx + 1}`,
                    type: z.type || 'storage',
                    bounds: zoneBounds,
                    area: zoneWidth * zoneHeight,
                    polygon: [
                        { x: zoneBounds.minX, y: zoneBounds.minY },
                        { x: zoneBounds.maxX, y: zoneBounds.minY },
                        { x: zoneBounds.maxX, y: zoneBounds.maxY },
                        { x: zoneBounds.minX, y: zoneBounds.maxY }
                    ],
                    hasIncompleteWalls: z.has_incomplete_walls || false,
                    gapCompletionPoints: z.gap_completion_points || [],
                    source: 'vision'
                };
            });

        } catch (error) {
            console.error('[VisionZoneDetector] Failed to parse response:', error.message);
            if (this.debugMode) {
                console.log('[VisionZoneDetector] Raw response:', responseText);
            }
            return [];
        }
    }

    /**
     * Render floor plan to PNG for vision analysis.
     * Uses walls (preferred) and/or entities. Falls back to SVG+sharp if canvas unavailable.
     * @param {Object} floorPlan - Parsed floor plan with walls, entities, bounds
     * @returns {Promise<Buffer>} PNG image buffer
     */
    static async renderToPNG(floorPlan, options = {}) {
        const width = options.width || 1200;
        const height = options.height || 900;
        const padding = options.padding || 50;

        const bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const planWidth = Math.max(0.1, bounds.maxX - bounds.minX);
        const planHeight = Math.max(0.1, bounds.maxY - bounds.minY);
        const scaleX = (width - 2 * padding) / planWidth;
        const scaleY = (height - 2 * padding) / planHeight;
        const scale = Math.min(scaleX, scaleY);

        const toCanvas = (x, y) => ({
            x: padding + (x - bounds.minX) * scale,
            y: height - padding - (y - bounds.minY) * scale
        });

        // Collect line segments from walls and entities
        const segments = [];

        // 1. Walls (preferred - already processed)
        const walls = floorPlan.walls || [];
        for (const wall of walls) {
            let x1, y1, x2, y2;
            if (wall.start && wall.end) {
                x1 = wall.start.x; y1 = wall.start.y;
                x2 = wall.end.x;   y2 = wall.end.y;
            } else if (wall.polygon && Array.isArray(wall.polygon)) {
                const p = wall.polygon;
                for (let i = 0; i < p.length - 1; i++) {
                    const a = Array.isArray(p[i]) ? p[i] : [p[i].x, p[i].y];
                    const b = Array.isArray(p[i + 1]) ? p[i + 1] : [p[i + 1].x, p[i + 1].y];
                    segments.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
                }
                continue;
            } else continue;
            segments.push({ x1, y1, x2, y2 });
        }

        // 2. Entities (raw DXF/DWG)
        const entities = floorPlan.entities || [];
        for (const entity of entities) {
            if (entity.type === 'LINE') {
                const start = entity.vertices ? entity.vertices[0] : entity.start;
                const end   = entity.vertices ? entity.vertices[1] : entity.end;
                if (start && end) segments.push({
                    x1: start.x, y1: start.y, x2: end.x, y2: end.y
                });
            } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                const vertices = entity.vertices || [];
                for (let i = 0; i < vertices.length - 1; i++) {
                    const a = vertices[i], b = vertices[i + 1];
                    segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
                }
                if (entity.closed || entity.shape) {
                    const a = vertices[vertices.length - 1], b = vertices[0];
                    segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
                }
            }
        }

        // Build SVG
        const svgLines = segments.map(s => {
            const p1 = toCanvas(s.x1, s.y1);
            const p2 = toCanvas(s.x2, s.y2);
            return `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#000" stroke-width="2"/>`;
        }).join('\n');

        // Forbidden zones: draw as segments (lines) or polygon outline
        let forbiddenSvg = '';
        for (const z of (floorPlan.forbiddenZones || [])) {
            if (z.start && z.end) {
                const p1 = toCanvas(z.start.x, z.start.y);
                const p2 = toCanvas(z.end.x, z.end.y);
                forbiddenSvg += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#ff8c00" stroke-width="2"/>`;
            } else if (z.polygon && Array.isArray(z.polygon)) {
                const pts = z.polygon.map(p => {
                    const [px, py] = Array.isArray(p) ? p : [p.x, p.y];
                    const c = toCanvas(px, py);
                    return `${c.x},${c.y}`;
                }).join(' ');
                forbiddenSvg += `<polygon points="${pts}" fill="rgba(255,165,0,0.2)" stroke="#ff8c00"/>`;
            }
        }

        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${svgLines}
  ${forbiddenSvg}
</svg>`;

        // Convert SVG to PNG via sharp
        try {
            const sharp = require('sharp');
            return await sharp(Buffer.from(svg))
                .png()
                .toBuffer();
        } catch (err) {
            console.warn('[VisionZoneDetector] Sharp SVG conversion failed:', err.message);
            // Fallback: try canvas if available
            try {
                const { createCanvas } = require('canvas');
                const canvas = createCanvas(width, height);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 2;
                for (const s of segments) {
                    const p1 = toCanvas(s.x1, s.y1);
                    const p2 = toCanvas(s.x2, s.y2);
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
                return canvas.toBuffer('image/png');
            } catch (canvasErr) {
                throw new Error('PNG rendering requires sharp or canvas. Run: npm install sharp');
            }
        }
    }
}

module.exports = VisionZoneDetector;
